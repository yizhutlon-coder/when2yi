/**
 * Composition-viability engine (spec §3.7).
 *
 * A composition rule is a list of requirements like "≥1 Tank, ≥1 Healer, ≥4 total".
 * A slot is *viable* when the people available at that slot can simultaneously
 * satisfy every requirement. The subtlety the spec calls out: a person who checked
 * both Tank AND Healer satisfies either requirement but only ONE at a time, so this
 * is a bipartite MATCHING problem, not counting — greedy tag counts overpromise.
 *
 * Two kinds of requirement, handled differently:
 *  - TAG requirements ("≥1 Tank") are DISJOINT SEATS — a person fills at most one,
 *    so a multi-role person can't cover two. We solve these as a max-flow / bipartite
 *    matching (Hall's theorem): source → one node per tag requirement (capacity = its
 *    `min`) → one node per eligible person (capacity 1 to the sink, so nobody fills two
 *    seats). Satisfiable iff max-flow equals the sum of the tag minimums.
 *  - A TOTAL floor ("≥4 total", `tagId: null`) is inclusive HEADCOUNT — the tank and
 *    healer count toward it too — so it's just `attendees ≥ N`, NOT part of the matching.
 *
 * Sizes are tiny (≤~20 people, ≤~20 reqs), so a plain Edmonds-Karp is microseconds per
 * slot. Dependency-free; shared server+client.
 */

import type { EventPayload } from "./eventData";
import { dayColumns, zonedEpoch, SLOT_MINUTES } from "./slots";

/** A single requirement. `tagId: null` means "any respondent" (a total-count floor). */
export interface Requirement {
  tagId: string | null;
  min: number;
}
export interface Composition {
  requirements: Requirement[];
  /**
   * May different people cover different parts of one meeting? Default true (lax).
   * When false, a time only counts if a SINGLE roster staffs the whole block —
   * "no swapping members during the event."
   */
  allowRosterShift?: boolean;
}

/** none = no rule defined; viable = firm attendees suffice; viable_if = only with
 *  soft attendees (conditional-commitment or "if needed" tier); unviable = impossible. */
export type ViabilityStatus = "none" | "viable" | "viable_if" | "unviable";

export interface SlotViability {
  status: ViabilityStatus;
  /** For viable_if: the soft attendees whose presence tips the slot into viability. */
  neededNames: string[];
}

interface Person {
  id: string;
  name: string;
  tagIds: string[];
}

/**
 * Feasibility of covering every requirement with distinct people (unit capacity each).
 * Returns whether it's satisfiable and which people ended up matched to a seat.
 */
function feasible(reqs: Requirement[], people: Person[]): { ok: boolean; used: Set<string> } {
  const R = reqs.length;
  const P = people.length;
  const N = R + P + 2;
  const S = 0;
  const T = N - 1;
  // Residual capacity matrix (small N, so a dense matrix is simplest and fast enough).
  const cap: number[][] = Array.from({ length: N }, () => new Array(N).fill(0));

  let need = 0;
  for (let i = 0; i < R; i++) {
    cap[S][1 + i] = reqs[i].min;
    need += reqs[i].min;
  }
  for (let j = 0; j < P; j++) cap[R + 1 + j][T] = 1;
  for (let i = 0; i < R; i++) {
    const req = reqs[i];
    for (let j = 0; j < P; j++) {
      if (req.tagId === null || people[j].tagIds.includes(req.tagId)) cap[1 + i][R + 1 + j] = 1;
    }
  }

  let flow = 0;
  for (;;) {
    const parent = new Array<number>(N).fill(-1);
    parent[S] = S;
    const queue = [S];
    while (queue.length) {
      const u = queue.shift()!;
      for (let v = 0; v < N; v++) {
        if (parent[v] === -1 && cap[u][v] > 0) {
          parent[v] = u;
          queue.push(v);
        }
      }
    }
    if (parent[T] === -1) break;
    let bottleneck = Infinity;
    for (let v = T; v !== S; v = parent[v]) bottleneck = Math.min(bottleneck, cap[parent[v]][v]);
    for (let v = T; v !== S; v = parent[v]) {
      cap[parent[v]][v] -= bottleneck;
      cap[v][parent[v]] += bottleneck;
    }
    flow += bottleneck;
  }

  const used = new Set<string>();
  for (let j = 0; j < P; j++) if (cap[R + 1 + j][T] === 0) used.add(people[j].id);
  return { ok: flow === need, used };
}

/** Largest inclusive-headcount floor among the `tagId: null` requirements (0 if none). */
function totalFloor(reqs: Requirement[]): number {
  let m = 0;
  for (const r of reqs) if (r.tagId === null) m = Math.max(m, r.min);
  return m;
}

/** Can `people` satisfy the rule? Tag reqs → disjoint matching; total floor → headcount. */
export function satisfiable(reqs: Requirement[], people: Person[]): { ok: boolean; used: Set<string> } {
  if (people.length < totalFloor(reqs)) return { ok: false, used: new Set() };
  return feasible(reqs.filter((r) => r.tagId !== null), people);
}

/**
 * Classify one slot given the firm attendees (commitment "yes" painted "yes") and
 * the soft ones (conditional commitment, or painted "if needed"). Firm people are
 * offered first so the reported `neededNames` are genuinely the soft attendees the
 * slot leans on — those filling a role seat firm couldn't, plus any needed purely to
 * reach the headcount floor.
 */
export function slotViability(reqs: Requirement[], firm: Person[], soft: Person[]): SlotViability {
  if (!reqs.length) return { status: "none", neededNames: [] };
  if (satisfiable(reqs, firm).ok) return { status: "viable", neededNames: [] };
  const all = satisfiable(reqs, [...firm, ...soft]);
  if (!all.ok) return { status: "unviable", neededNames: [] };

  const neededIds = new Set<string>();
  const neededNames: string[] = [];
  for (const p of soft) {
    if (all.used.has(p.id)) {
      neededIds.add(p.id);
      neededNames.push(p.name);
    }
  }
  // Fill any remaining headcount shortfall with more soft attendees.
  let headcount = firm.length + neededIds.size;
  const floor = totalFloor(reqs);
  for (const p of soft) {
    if (headcount >= floor) break;
    if (!neededIds.has(p.id)) {
      neededIds.add(p.id);
      neededNames.push(p.name);
      headcount++;
    }
  }
  return { status: "viable_if", neededNames };
}

/** Viability of every slot in the event under `composition`. */
export function viabilityBySlot(
  payload: EventPayload,
  composition: Composition | null
): Map<number, SlotViability> {
  const out = new Map<number, SlotViability>();
  const reqs = composition?.requirements ?? [];
  for (const slot of payload.slots) {
    if (!reqs.length) {
      out.set(slot, { status: "none", neededNames: [] });
      continue;
    }
    const firm: Person[] = [];
    const soft: Person[] = [];
    for (const r of payload.respondents) {
      const tier = r.availability[String(slot)];
      if (!tier) continue;
      const person: Person = { id: r.id, name: r.name, tagIds: r.tagIds };
      if (r.commitment === "yes" && tier === "yes") firm.push(person);
      else soft.push(person);
    }
    out.set(slot, slotViability(reqs, firm, soft));
  }
  return out;
}

/** Slot keys that are firmly viable (the `slot.viable` webhook trigger set). */
export function viableSlotKeys(payload: EventPayload, composition: Composition | null): number[] {
  if (!composition?.requirements.length) return [];
  const map = viabilityBySlot(payload, composition);
  const keys: number[] = [];
  for (const [k, v] of map) if (v.status === "viable") keys.push(k);
  return keys.sort((a, b) => a - b);
}

// ---- Best-times blocks: contiguous viable runs + swappability (§3.11) ----

export interface RoleDetail {
  label: string;
  available: number; // firm people with this tag available the whole block
  min: number;
  swappable: boolean; // more available than the minimum → spare capacity
}
export interface Attendee {
  name: string;
  handle: string | null;
}
export interface ViableBlock {
  startKey: number;
  endKey: number; // last viable slot's start
  slotCount: number;
  minutes: number; // total contiguous length
  /** A single firm roster covers the ENTIRE block (not just each slot separately). */
  wholeBlockStaffable: boolean;
  totalMin: number;
  totalAvailable: number; // firm people available the whole block
  roles: RoleDetail[];
  /** People required for the whole block — removing any one breaks the composition. */
  locked: string[];
  /** Available the whole block but redundant — interchangeable / can drop out. */
  swappable: string[];
  /** Everyone available for the whole block (for tagging) — name + optional handle. */
  attendees: Attendee[];
}

interface BlockPerson {
  id: string;
  name: string;
  tagIds: string[];
  handle: string | null;
}

/** Firm attendees (commitment yes, painted "yes") available for EVERY slot in the run. */
function firmWholeFor(run: number[], payload: EventPayload): BlockPerson[] {
  return payload.respondents
    .filter((r) => r.commitment === "yes" && run.every((k) => r.availability[String(k)] === "yes"))
    .map((r) => ({ id: r.id, name: r.name, tagIds: r.tagIds, handle: r.discordHandle }));
}

function orderedColumns(payload: EventPayload): number[][] {
  const mins = dayColumns(payload.event);
  if (payload.event.mode === "days") {
    return (payload.event.days as number[]).map((d) => mins.map((m) => d * 1440 + m));
  }
  return (payload.event.days as string[]).map((dateStr) =>
    mins.map((m) => zonedEpoch(dateStr, m, payload.event.timezone))
  );
}

function buildBlock(
  run: number[],
  payload: EventPayload,
  composition: Composition,
  tagLabel: (id: string) => string
): ViableBlock {
  const reqs = composition.requirements;
  const firmWhole = firmWholeFor(run, payload);

  const roles: RoleDetail[] = reqs
    .filter((req) => req.tagId !== null)
    .map((req) => {
      const available = firmWhole.filter((p) => p.tagIds.includes(req.tagId!)).length;
      return { label: tagLabel(req.tagId!), available, min: req.min, swappable: available > req.min };
    });

  const wholeBlockStaffable = satisfiable(reqs, firmWhole).ok;
  const locked: string[] = [];
  const swappable: string[] = [];
  if (wholeBlockStaffable) {
    for (const p of firmWhole) {
      const without = firmWhole.filter((q) => q.id !== p.id);
      (satisfiable(reqs, without).ok ? swappable : locked).push(p.name);
    }
  }

  return {
    startKey: run[0],
    endKey: run[run.length - 1],
    slotCount: run.length,
    minutes: run.length * SLOT_MINUTES,
    wholeBlockStaffable,
    totalMin: totalFloor(reqs),
    totalAvailable: firmWhole.length,
    roles,
    locked,
    swappable,
    attendees: firmWhole.map((p) => ({ name: p.name, handle: p.handle })),
  };
}

/**
 * Maximal contiguous runs of firmly-viable slots, each with duration and a
 * swappability read-out (which roles have spare capacity, which people are
 * load-bearing) — role minimums are respected throughout. Ranked longest-first.
 */
export function viableBlocks(
  payload: EventPayload,
  composition: Composition | null,
  tagLabel: (id: string) => string
): ViableBlock[] {
  if (!composition?.requirements.length) return [];
  const allowShift = composition.allowRosterShift ?? true;
  const reqs = composition.requirements;
  const viab = viabilityBySlot(payload, composition);
  const isViable = (k: number) => viab.get(k)?.status === "viable";
  const blocks: ViableBlock[] = [];

  for (const keys of orderedColumns(payload)) {
    if (allowShift) {
      // Lax: maximal runs of per-slot-viable slots (people may change across the run).
      let run: number[] = [];
      const flush = () => {
        if (run.length) blocks.push(buildBlock(run, payload, composition, tagLabel));
        run = [];
      };
      for (const k of keys) {
        if (isViable(k)) run.push(k);
        else flush();
      }
      flush();
    } else {
      // Strict: maximal runs a SINGLE roster can staff the whole way through. Extend
      // only while the people available across the entire run still satisfy the rule.
      let i = 0;
      while (i < keys.length) {
        if (!isViable(keys[i])) {
          i++;
          continue;
        }
        const run = [keys[i]];
        let j = i + 1;
        while (j < keys.length && isViable(keys[j]) && satisfiable(reqs, firmWholeFor([...run, keys[j]], payload)).ok) {
          run.push(keys[j]);
          j++;
        }
        blocks.push(buildBlock(run, payload, composition, tagLabel));
        // If extension stopped at a non-viable slot, skip it; otherwise the next
        // viable slot begins a fresh (roster-change) block.
        i = j < keys.length && !isViable(keys[j]) ? j + 1 : j;
      }
    }
  }
  return blocks.sort((a, b) => b.slotCount - a.slotCount || a.startKey - b.startKey);
}
