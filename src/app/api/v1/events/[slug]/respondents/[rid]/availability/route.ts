import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { editTokenFrom, isOrganizer } from "@/lib/auth";
import { getEventRow, slotSpec } from "@/lib/eventData";
import { validSlotKeySet } from "@/lib/slots";
import { putAvailabilityInput } from "@/lib/validate";
import { publish } from "@/lib/sse";
import { emitChange } from "@/lib/webhooks";
import { enforceRateLimit } from "@/lib/rateLimit";

type Ctx = { params: Promise<{ slug: string; rid: string }> };

/** Full-replacement PUT — the autosave model (§3.2: no submit button). */
export async function PUT(req: Request, ctx: Ctx) {
  const limited = enforceRateLimit(req, "availability", 90, 60_000); // 90 / min / IP
  if (limited) return limited;

  const { slug, rid } = await ctx.params;
  const ev = getEventRow(slug);
  if (!ev) return NextResponse.json({ error: "event not found" }, { status: 404 });
  const r = db
    .select()
    .from(schema.respondents)
    .where(and(eq(schema.respondents.id, rid), eq(schema.respondents.eventId, ev.id)))
    .get();
  if (!r) return NextResponse.json({ error: "respondent not found" }, { status: 404 });
  if (editTokenFrom(req) !== r.editToken && !isOrganizer(req, ev)) {
    return NextResponse.json({ error: "edit token required" }, { status: 403 });
  }
  if (ev.deadline && Date.now() / 1000 > ev.deadline) {
    return NextResponse.json({ error: "response deadline has passed" }, { status: 409 });
  }

  const body = await req.json().catch(() => null);
  const parsed = putAvailabilityInput.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const valid = validSlotKeySet(slotSpec(ev));
  for (const s of parsed.data.slots) {
    if (!valid.has(s.slotKey)) {
      return NextResponse.json({ error: `slotKey ${s.slotKey} is not a slot of this event` }, { status: 400 });
    }
  }

  // Replace-all in one transaction; last tier wins on duplicate keys.
  const dedup = new Map<number, "yes" | "if_needed">();
  for (const s of parsed.data.slots) dedup.set(s.slotKey, s.tier);

  db.transaction((tx) => {
    tx.delete(schema.availability).where(eq(schema.availability.respondentId, r.id)).run();
    for (const [slotKey, tier] of dedup) {
      tx.insert(schema.availability).values({ respondentId: r.id, slotKey, tier }).run();
    }
  });

  publish(slug, "availability.updated", { respondentId: r.id, count: dedup.size });
  emitChange(ev, "availability.updated", { respondentId: r.id });
  return NextResponse.json({ ok: true, saved: dedup.size });
}
