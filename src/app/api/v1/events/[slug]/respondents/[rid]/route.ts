import { NextResponse } from "next/server";
import { and, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db";
import { editTokenFrom, isOrganizer } from "@/lib/auth";
import { getEventRow } from "@/lib/eventData";
import { patchRespondentInput } from "@/lib/validate";
import { publish } from "@/lib/sse";

type Ctx = { params: Promise<{ slug: string; rid: string }> };

function getRespondent(eventId: string, rid: string) {
  return db
    .select()
    .from(schema.respondents)
    .where(and(eq(schema.respondents.id, rid), eq(schema.respondents.eventId, eventId)))
    .get();
}

/** Edit token holder, or organizer (moderation, §3.4). */
function canEdit(req: Request, ev: { organizerToken: string }, r: { editToken: string }): boolean {
  return editTokenFrom(req) === r.editToken || isOrganizer(req, ev);
}

export async function PATCH(req: Request, ctx: Ctx) {
  const { slug, rid } = await ctx.params;
  const ev = getEventRow(slug);
  if (!ev) return NextResponse.json({ error: "event not found" }, { status: 404 });
  const r = getRespondent(ev.id, rid);
  if (!r) return NextResponse.json({ error: "respondent not found" }, { status: 404 });
  if (!canEdit(req, ev, r)) return NextResponse.json({ error: "not allowed" }, { status: 403 });

  const body = await req.json().catch(() => null);
  const parsed = patchRespondentInput.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const p = parsed.data;

  if (p.name || p.commitment || p.discordHandle !== undefined) {
    db.update(schema.respondents)
      .set({
        ...(p.name ? { name: p.name } : {}),
        ...(p.commitment ? { commitment: p.commitment } : {}),
        ...(p.discordHandle !== undefined ? { discordHandle: p.discordHandle } : {}),
      })
      .where(eq(schema.respondents.id, r.id))
      .run();
  }

  if (p.tagIds) {
    const groups = db.select().from(schema.tagGroups).where(eq(schema.tagGroups.eventId, ev.id)).all();
    const validTags = groups.length
      ? db
          .select()
          .from(schema.tags)
          .where(inArray(schema.tags.groupId, groups.map((g) => g.id)))
          .all()
      : [];
    const validIds = new Set(validTags.map((t) => t.id));
    const tagIds = [...new Set(p.tagIds)];
    for (const id of tagIds) {
      if (!validIds.has(id)) return NextResponse.json({ error: `unknown tag id: ${id}` }, { status: 400 });
    }
    db.delete(schema.respondentTags).where(eq(schema.respondentTags.respondentId, r.id)).run();
    for (const tagId of tagIds) {
      db.insert(schema.respondentTags).values({ respondentId: r.id, tagId }).run();
    }
  }

  publish(slug, "respondent.updated", { respondentId: r.id });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request, ctx: Ctx) {
  const { slug, rid } = await ctx.params;
  const ev = getEventRow(slug);
  if (!ev) return NextResponse.json({ error: "event not found" }, { status: 404 });
  const r = getRespondent(ev.id, rid);
  if (!r) return NextResponse.json({ error: "respondent not found" }, { status: 404 });
  if (!canEdit(req, ev, r)) return NextResponse.json({ error: "not allowed" }, { status: 403 });

  db.delete(schema.respondents).where(eq(schema.respondents.id, r.id)).run();
  publish(slug, "respondent.deleted", { respondentId: r.id });
  return NextResponse.json({ ok: true });
}
