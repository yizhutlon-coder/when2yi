import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { isOrganizer } from "@/lib/auth";
import { getEventRow, loadEventPayload } from "@/lib/eventData";
import { newId, newToken } from "@/lib/ids";
import { webhookInput } from "@/lib/validate";
import { viableSlotKeys } from "@/lib/composition";

type Ctx = { params: Promise<{ slug: string }> };

/** List this event's webhook subscriptions (secrets are never returned after creation). */
export async function GET(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const ev = getEventRow(slug);
  if (!ev) return NextResponse.json({ error: "event not found" }, { status: 404 });
  if (!isOrganizer(req, ev)) return NextResponse.json({ error: "organizer token required" }, { status: 403 });

  const rows = db.select().from(schema.webhooks).where(eq(schema.webhooks.eventId, ev.id)).all();
  return NextResponse.json({
    webhooks: rows.map((w) => ({
      id: w.id,
      url: w.url,
      eventTypes: w.eventTypesJson ? JSON.parse(w.eventTypesJson) : null,
      createdAt: w.createdAt,
    })),
  });
}

/** Subscribe a URL to this event's change events (§3.6). Secret is shown once here. */
export async function POST(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const ev = getEventRow(slug);
  if (!ev) return NextResponse.json({ error: "event not found" }, { status: 404 });
  if (!isOrganizer(req, ev)) return NextResponse.json({ error: "organizer token required" }, { status: 403 });

  const body = await req.json().catch(() => null);
  const parsed = webhookInput.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const id = newId();
  const secret = newToken();
  // Seed firedKeys with slots already viable, so a fresh subscription isn't flooded
  // with slot.viable for the current state — initial state comes from GET /summary.
  const payload = loadEventPayload(ev);
  const seed = viableSlotKeys(payload, payload.event.composition);

  db.insert(schema.webhooks)
    .values({
      id,
      eventId: ev.id,
      url: parsed.data.url,
      secret,
      eventTypesJson: parsed.data.eventTypes?.length ? JSON.stringify(parsed.data.eventTypes) : null,
      firedKeysJson: JSON.stringify(seed),
      createdAt: Math.floor(Date.now() / 1000),
    })
    .run();

  return NextResponse.json(
    { id, secret, url: parsed.data.url, eventTypes: parsed.data.eventTypes ?? null },
    { status: 201 }
  );
}
