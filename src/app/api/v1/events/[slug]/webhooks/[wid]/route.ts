import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { isOrganizer } from "@/lib/auth";
import { getEventRow } from "@/lib/eventData";

type Ctx = { params: Promise<{ slug: string; wid: string }> };

export async function DELETE(req: Request, ctx: Ctx) {
  const { slug, wid } = await ctx.params;
  const ev = getEventRow(slug);
  if (!ev) return NextResponse.json({ error: "event not found" }, { status: 404 });
  if (!isOrganizer(req, ev)) return NextResponse.json({ error: "organizer token required" }, { status: 403 });

  const row = db
    .select()
    .from(schema.webhooks)
    .where(and(eq(schema.webhooks.id, wid), eq(schema.webhooks.eventId, ev.id)))
    .get();
  if (!row) return NextResponse.json({ error: "webhook not found" }, { status: 404 });

  db.delete(schema.webhooks).where(eq(schema.webhooks.id, wid)).run();
  return NextResponse.json({ ok: true });
}
