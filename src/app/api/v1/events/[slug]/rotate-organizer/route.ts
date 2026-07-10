import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { isOrganizer } from "@/lib/auth";
import { getEventRow } from "@/lib/eventData";
import { newToken } from "@/lib/ids";

type Ctx = { params: Promise<{ slug: string }> };

/**
 * Rotate the organizer token — invalidates a leaked admin link. Requires the
 * current organizer token (or a server API key). Returns the new token so the
 * organizer can save the fresh link.
 */
export async function POST(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const ev = getEventRow(slug);
  if (!ev) return NextResponse.json({ error: "event not found" }, { status: 404 });
  if (!isOrganizer(req, ev)) return NextResponse.json({ error: "organizer token required" }, { status: 403 });

  const organizerToken = newToken();
  db.update(schema.events).set({ organizerToken }).where(eq(schema.events.id, ev.id)).run();
  return NextResponse.json({ organizerToken });
}
