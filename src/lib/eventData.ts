import { eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db";
import { allSlotKeys, type SlotSpec } from "./slots";
import { viabilityBySlot, type Composition, type SlotViability } from "./composition";

export type EventRow = typeof schema.events.$inferSelect;

export interface PublicTag {
  id: string;
  label: string;
}
export interface PublicTagGroup {
  id: string;
  name: string;
  multiSelect: boolean;
  required: boolean;
  tags: PublicTag[];
}
export interface PublicRespondent {
  id: string;
  name: string;
  commitment: "yes" | "conditional";
  hasPin: boolean;
  discordHandle: string | null;
  tagIds: string[];
  /** slotKey -> tier */
  availability: Record<string, "yes" | "if_needed">;
}
export interface PublicEvent {
  slug: string;
  name: string;
  description: string | null;
  mode: "dates" | "days";
  days: (string | number)[];
  startMin: number;
  endMin: number;
  timezone: string;
  deadline: number | null;
  roster: string[] | null;
  finalizedSlots: number[] | null;
  composition: Composition | null;
  createdAt: number;
}
export interface EventPayload {
  event: PublicEvent;
  slots: number[];
  tagGroups: PublicTagGroup[];
  respondents: PublicRespondent[];
}

export function getEventRow(slug: string): EventRow | undefined {
  return db.select().from(schema.events).where(eq(schema.events.slug, slug)).get();
}

export function slotSpec(ev: EventRow): SlotSpec {
  return {
    mode: ev.mode,
    days: JSON.parse(ev.daysJson),
    startMin: ev.startMin,
    endMin: ev.endMin,
    timezone: ev.timezone,
  };
}

/** Full public payload — tokens and PIN hashes stripped. */
export function loadEventPayload(ev: EventRow): EventPayload {
  const groups = db
    .select()
    .from(schema.tagGroups)
    .where(eq(schema.tagGroups.eventId, ev.id))
    .all()
    .sort((a, b) => a.sortOrder - b.sortOrder);
  const groupIds = groups.map((g) => g.id);
  const tagRows = groupIds.length
    ? db.select().from(schema.tags).where(inArray(schema.tags.groupId, groupIds)).all()
    : [];

  const respondents = db
    .select()
    .from(schema.respondents)
    .where(eq(schema.respondents.eventId, ev.id))
    .all()
    .sort((a, b) => a.createdAt - b.createdAt);
  const respIds = respondents.map((r) => r.id);
  const availRows = respIds.length
    ? db.select().from(schema.availability).where(inArray(schema.availability.respondentId, respIds)).all()
    : [];
  const rtRows = respIds.length
    ? db
        .select()
        .from(schema.respondentTags)
        .where(inArray(schema.respondentTags.respondentId, respIds))
        .all()
    : [];

  const availByResp = new Map<string, Record<string, "yes" | "if_needed">>();
  for (const a of availRows) {
    let rec = availByResp.get(a.respondentId);
    if (!rec) availByResp.set(a.respondentId, (rec = {}));
    rec[String(a.slotKey)] = a.tier;
  }
  const tagsByResp = new Map<string, string[]>();
  for (const rt of rtRows) {
    const list = tagsByResp.get(rt.respondentId) ?? [];
    list.push(rt.tagId);
    tagsByResp.set(rt.respondentId, list);
  }

  return {
    event: {
      slug: ev.slug,
      name: ev.name,
      description: ev.description,
      mode: ev.mode,
      days: JSON.parse(ev.daysJson),
      startMin: ev.startMin,
      endMin: ev.endMin,
      timezone: ev.timezone,
      deadline: ev.deadline,
      roster: ev.rosterJson ? JSON.parse(ev.rosterJson) : null,
      finalizedSlots: ev.finalizedJson ? JSON.parse(ev.finalizedJson) : null,
      composition: ev.compositionJson ? (JSON.parse(ev.compositionJson) as Composition) : null,
      createdAt: ev.createdAt,
    },
    slots: allSlotKeys(slotSpec(ev)),
    tagGroups: groups.map((g) => ({
      id: g.id,
      name: g.name,
      multiSelect: g.multiSelect,
      required: g.required,
      tags: tagRows
        .filter((t) => t.groupId === g.id)
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((t) => ({ id: t.id, label: t.label })),
    })),
    respondents: respondents.map((r) => ({
      id: r.id,
      name: r.name,
      commitment: r.commitment,
      hasPin: !!r.pinHash,
      discordHandle: r.discordHandle,
      tagIds: tagsByResp.get(r.id) ?? [],
      availability: availByResp.get(r.id) ?? {},
    })),
  };
}

export interface SlotSummary {
  slotKey: number;
  /** firm (commitment=yes) painted "yes" */
  yes: number;
  /** any commitment, painted "if_needed" */
  ifNeeded: number;
  /** conditional folks painted "yes" — the "ping me if needed" pool */
  conditionalYes: number;
  names: { yes: string[]; ifNeeded: string[]; conditionalYes: string[] };
  /** Composition viability under the event's rule (status "none" when no rule). */
  viability: SlotViability;
}

export interface Summary {
  respondentCount: number;
  topSlots: SlotSummary[];
  missingRoster: string[];
  composition: Composition | null;
  /** Slots firmly viable under the composition rule (0 when no rule). */
  viableCount: number;
}

const VIABILITY_RANK: Record<SlotViability["status"], number> = {
  viable: 0,
  viable_if: 1,
  none: 2,
  unviable: 3,
};

export function computeSummary(payload: EventPayload, topN = 10): Summary {
  const composition = payload.event.composition;
  const viability = viabilityBySlot(payload, composition);
  const bySlot = new Map<number, SlotSummary>();
  for (const key of payload.slots) {
    bySlot.set(key, {
      slotKey: key,
      yes: 0,
      ifNeeded: 0,
      conditionalYes: 0,
      names: { yes: [], ifNeeded: [], conditionalYes: [] },
      viability: viability.get(key) ?? { status: "none", neededNames: [] },
    });
  }
  for (const r of payload.respondents) {
    for (const [k, tier] of Object.entries(r.availability)) {
      const s = bySlot.get(Number(k));
      if (!s) continue;
      if (tier === "if_needed") {
        s.ifNeeded++;
        s.names.ifNeeded.push(r.name);
      } else if (r.commitment === "conditional") {
        s.conditionalYes++;
        s.names.conditionalYes.push(r.name);
      } else {
        s.yes++;
        s.names.yes.push(r.name);
      }
    }
  }
  // Composition-viable slots rank first (spec §3.7), then by firm/soft counts.
  const ranked = [...bySlot.values()]
    .filter((s) => s.yes + s.ifNeeded + s.conditionalYes > 0)
    .sort(
      (a, b) =>
        VIABILITY_RANK[a.viability.status] - VIABILITY_RANK[b.viability.status] ||
        b.yes - a.yes ||
        b.conditionalYes - a.conditionalYes ||
        b.ifNeeded - a.ifNeeded ||
        a.slotKey - b.slotKey
    )
    .slice(0, topN);

  const respondedNames = new Set(payload.respondents.map((r) => r.name.toLowerCase()));
  const missingRoster = (payload.event.roster ?? []).filter((n) => !respondedNames.has(n.toLowerCase()));

  let viableCount = 0;
  for (const v of viability.values()) if (v.status === "viable") viableCount++;

  return {
    respondentCount: payload.respondents.length,
    topSlots: ranked,
    missingRoster,
    composition,
    viableCount,
  };
}
