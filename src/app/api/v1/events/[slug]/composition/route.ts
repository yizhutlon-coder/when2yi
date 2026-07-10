import { NextResponse } from "next/server";
import { eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db";
import { isOrganizer } from "@/lib/auth";
import { getEventRow, loadEventPayload } from "@/lib/eventData";
import { viabilityBySlot, type Composition } from "@/lib/composition";
import { compositionInput } from "@/lib/validate";
import { publish } from "@/lib/sse";
import { emitChange } from "@/lib/webhooks";

type Ctx = { params: Promise<{ slug: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const ev = getEventRow(slug);
  if (!ev) return NextResponse.json({ error: "event not found" }, { status: 404 });
  const composition: Composition | null = ev.compositionJson ? JSON.parse(ev.compositionJson) : null;
  return NextResponse.json({ composition });
}

/** Set/replace the composition rule (§3.7, editable mid-poll). Empty requirements clears it. */
export async function PUT(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const ev = getEventRow(slug);
  if (!ev) return NextResponse.json({ error: "event not found" }, { status: 404 });
  if (!isOrganizer(req, ev)) return NextResponse.json({ error: "organizer token required" }, { status: 403 });

  const body = await req.json().catch(() => null);
  const parsed = compositionInput.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  // Validate that every non-null tagId belongs to this event.
  const referenced = parsed.data.requirements.map((r) => r.tagId).filter((t): t is string => t !== null);
  if (referenced.length) {
    const groups = db.select().from(schema.tagGroups).where(eq(schema.tagGroups.eventId, ev.id)).all();
    const validIds = new Set(
      groups.length
        ? db.select().from(schema.tags).where(inArray(schema.tags.groupId, groups.map((g) => g.id))).all().map((t) => t.id)
        : []
    );
    for (const id of referenced) {
      if (!validIds.has(id)) return NextResponse.json({ error: `unknown tag id: ${id}` }, { status: 400 });
    }
  }

  const composition: Composition | null = parsed.data.requirements.length
    ? { requirements: parsed.data.requirements, allowRosterShift: parsed.data.allowRosterShift ?? true }
    : null;

  // Diff viability so the organizer sees "rule changed, N slots changed viability".
  const before = viabilityBySlot(loadEventPayload(ev), ev.compositionJson ? JSON.parse(ev.compositionJson) : null);

  db.update(schema.events)
    .set({ compositionJson: composition ? JSON.stringify(composition) : null })
    .where(eq(schema.events.id, ev.id))
    .run();

  const updatedRow = getEventRow(slug)!;
  const after = viabilityBySlot(loadEventPayload(updatedRow), composition);
  let changedSlots = 0;
  for (const [k, v] of after) if ((before.get(k)?.status ?? "none") !== v.status) changedSlots++;

  publish(slug, "event.updated");
  emitChange(updatedRow, "composition.updated", { changedSlots });

  return NextResponse.json({ composition, changedSlots });
}
