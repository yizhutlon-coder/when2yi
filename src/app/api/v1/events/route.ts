import { NextResponse } from "next/server";
import { db, schema } from "@/db";
import { newId, newSlug, newToken } from "@/lib/ids";
import { createEventInput } from "@/lib/validate";
import { getEventRow, loadEventPayload } from "@/lib/eventData";

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const parsed = createEventInput.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const input = parsed.data;
  const now = Math.floor(Date.now() / 1000);
  const id = newId();
  const slug = newSlug();
  const organizerToken = newToken();

  db.insert(schema.events)
    .values({
      id,
      slug,
      name: input.name,
      description: input.description ?? null,
      mode: input.mode,
      daysJson: JSON.stringify(input.mode === "dates" ? [...new Set(input.dates!)].sort() : [...new Set(input.days!)].sort((a, b) => a - b)),
      startMin: input.startMin,
      endMin: input.endMin,
      timezone: input.timezone,
      deadline: input.deadline ?? null,
      rosterJson: input.roster?.length ? JSON.stringify(input.roster) : null,
      organizerToken,
      createdAt: now,
    })
    .run();

  for (const [gi, g] of (input.tagGroups ?? []).entries()) {
    const groupId = newId();
    db.insert(schema.tagGroups)
      .values({
        id: groupId,
        eventId: id,
        name: g.name,
        multiSelect: g.multiSelect,
        required: g.required,
        sortOrder: gi,
      })
      .run();
    for (const [ti, label] of g.options.entries()) {
      db.insert(schema.tags).values({ id: newId(), groupId, label, sortOrder: ti }).run();
    }
  }

  const payload = loadEventPayload(getEventRow(slug)!);
  return NextResponse.json({ ...payload, organizerToken }, { status: 201 });
}
