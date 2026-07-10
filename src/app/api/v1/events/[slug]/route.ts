import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { isOrganizer } from "@/lib/auth";
import { getEventRow, loadEventPayload } from "@/lib/eventData";
import { patchEventInput } from "@/lib/validate";
import { publish } from "@/lib/sse";
import { emitChange } from "@/lib/webhooks";

type Ctx = { params: Promise<{ slug: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const ev = getEventRow(slug);
  if (!ev) return NextResponse.json({ error: "event not found" }, { status: 404 });
  return NextResponse.json(loadEventPayload(ev));
}

export async function PATCH(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const ev = getEventRow(slug);
  if (!ev) return NextResponse.json({ error: "event not found" }, { status: 404 });
  if (!isOrganizer(req, ev)) return NextResponse.json({ error: "organizer token required" }, { status: 403 });

  const body = await req.json().catch(() => null);
  const parsed = patchEventInput.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const p = parsed.data;

  // Non-destructive edits (spec §3.1): availability rows outside a shrunk range
  // are intentionally KEPT — they reappear if the range is re-expanded.
  db.update(schema.events)
    .set({
      ...(p.name !== undefined ? { name: p.name } : {}),
      ...(p.description !== undefined ? { description: p.description } : {}),
      ...(p.startMin !== undefined ? { startMin: p.startMin } : {}),
      ...(p.endMin !== undefined ? { endMin: p.endMin } : {}),
      ...(p.deadline !== undefined ? { deadline: p.deadline } : {}),
      ...(p.roster !== undefined ? { rosterJson: p.roster?.length ? JSON.stringify(p.roster) : null } : {}),
      ...(p.dates !== undefined && ev.mode === "dates"
        ? { daysJson: JSON.stringify([...new Set(p.dates)].sort()) }
        : {}),
      ...(p.days !== undefined && ev.mode === "days"
        ? { daysJson: JSON.stringify([...new Set(p.days)].sort((a, b) => a - b)) }
        : {}),
    })
    .where(eq(schema.events.id, ev.id))
    .run();

  const updatedRow = getEventRow(slug)!;
  const updated = loadEventPayload(updatedRow);
  publish(slug, "event.updated");
  emitChange(updatedRow, "event.updated");
  return NextResponse.json(updated);
}

export async function DELETE(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const ev = getEventRow(slug);
  if (!ev) return NextResponse.json({ error: "event not found" }, { status: 404 });
  if (!isOrganizer(req, ev)) return NextResponse.json({ error: "organizer token required" }, { status: 403 });
  db.delete(schema.events).where(eq(schema.events.id, ev.id)).run();
  publish(slug, "event.deleted");
  return NextResponse.json({ ok: true });
}
