import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { newId, newSlug, newToken } from "@/lib/ids";
import { createEventInput } from "@/lib/validate";
import { getEventRow, loadEventPayload } from "@/lib/eventData";
import { enforceRateLimit } from "@/lib/rateLimit";

export async function POST(req: Request) {
  const limited = enforceRateLimit(req, "create-event", 20, 3_600_000); // 20 / hour / IP
  if (limited) return limited;

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

  // Map (groupIndex, optionLabel) → tagId so a creation-time composition can
  // reference role options that only get IDs here.
  const tagIdByKey = new Map<string, string>();
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
      const tagId = newId();
      db.insert(schema.tags).values({ id: tagId, groupId, label, sortOrder: ti }).run();
      tagIdByKey.set(`${gi}::${label}`, tagId);
    }
  }

  if (input.composition?.length) {
    const requirements: { tagId: string | null; min: number }[] = [];
    for (const r of input.composition) {
      if (r.group !== null && r.option !== null) {
        const tagId = tagIdByKey.get(`${r.group}::${r.option}`);
        if (!tagId) {
          db.delete(schema.events).where(eq(schema.events.id, id)).run();
          return NextResponse.json({ error: `composition references unknown role option: ${r.option}` }, { status: 400 });
        }
        requirements.push({ tagId, min: r.min });
      } else {
        requirements.push({ tagId: null, min: r.min });
      }
    }
    db.update(schema.events)
      .set({ compositionJson: JSON.stringify({ requirements, allowRosterShift: input.allowRosterShift ?? true }) })
      .where(eq(schema.events.id, id))
      .run();
  }

  const payload = loadEventPayload(getEventRow(slug)!);
  return NextResponse.json({ ...payload, organizerToken }, { status: 201 });
}
