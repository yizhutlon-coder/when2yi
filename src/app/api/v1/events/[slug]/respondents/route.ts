import { NextResponse } from "next/server";
import { and, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db";
import { hashPin, verifyPin } from "@/lib/auth";
import { getEventRow } from "@/lib/eventData";
import { newId, newToken } from "@/lib/ids";
import { signInInput } from "@/lib/validate";
import { publish } from "@/lib/sse";

type Ctx = { params: Promise<{ slug: string }> };

/**
 * Sign in (When2Meet trust model, §3.4):
 *  - unknown name → create respondent, return editToken
 *  - known name, PIN matches (or none set and none required) → return existing editToken
 *  - known name, PIN mismatch → 403
 */
export async function POST(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const ev = getEventRow(slug);
  if (!ev) return NextResponse.json({ error: "event not found" }, { status: 404 });
  if (ev.deadline && Date.now() / 1000 > ev.deadline) {
    return NextResponse.json({ error: "response deadline has passed" }, { status: 409 });
  }

  const body = await req.json().catch(() => null);
  const parsed = signInInput.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const input = parsed.data;

  const existing = db
    .select()
    .from(schema.respondents)
    .where(eq(schema.respondents.eventId, ev.id))
    .all()
    .find((r) => r.name.toLowerCase() === input.name.toLowerCase());

  if (existing) {
    if (existing.pinHash) {
      if (!input.pin || !verifyPin(input.pin, existing.pinHash)) {
        return NextResponse.json({ error: "wrong PIN for this name" }, { status: 403 });
      }
    }
    return NextResponse.json({
      respondentId: existing.id,
      editToken: existing.editToken,
      existing: true,
    });
  }

  // Validate tag selections against this event's tag groups.
  const tagIds = [...new Set(input.tagIds ?? [])];
  if (tagIds.length) {
    const groups = db.select().from(schema.tagGroups).where(eq(schema.tagGroups.eventId, ev.id)).all();
    const validTags = groups.length
      ? db
          .select()
          .from(schema.tags)
          .where(inArray(schema.tags.groupId, groups.map((g) => g.id)))
          .all()
      : [];
    const validIds = new Set(validTags.map((t) => t.id));
    for (const id of tagIds) {
      if (!validIds.has(id)) return NextResponse.json({ error: `unknown tag id: ${id}` }, { status: 400 });
    }
    // Enforce single-select groups.
    const groupOf = new Map(validTags.map((t) => [t.id, t.groupId]));
    const perGroup = new Map<string, number>();
    for (const id of tagIds) {
      const g = groupOf.get(id)!;
      perGroup.set(g, (perGroup.get(g) ?? 0) + 1);
    }
    for (const g of groups) {
      if (!g.multiSelect && (perGroup.get(g.id) ?? 0) > 1) {
        return NextResponse.json({ error: `"${g.name}" allows only one selection` }, { status: 400 });
      }
    }
  }

  const id = newId();
  const editToken = newToken();
  db.insert(schema.respondents)
    .values({
      id,
      eventId: ev.id,
      name: input.name,
      pinHash: input.pin ? hashPin(input.pin) : null,
      editToken,
      commitment: input.commitment,
      discordHandle: input.discordHandle ?? null,
      createdAt: Math.floor(Date.now() / 1000),
    })
    .run();
  for (const tagId of tagIds) {
    db.insert(schema.respondentTags).values({ respondentId: id, tagId }).run();
  }

  publish(slug, "respondent.created", { respondentId: id, name: input.name });
  return NextResponse.json({ respondentId: id, editToken, existing: false }, { status: 201 });
}
