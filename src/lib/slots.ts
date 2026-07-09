/**
 * Slot math. Fixed 15-minute slots (decision log #4).
 *
 * slotKey semantics (see schema.ts):
 *  - "dates" mode: unix epoch seconds (UTC) of slot start
 *  - "days"  mode: dayOfWeek * 1440 + minuteOfDay (Sun=0), timezone-naive by design
 */

export const SLOT_MINUTES = 15;
export const SLOT_SECONDS = SLOT_MINUTES * 60;

export type EventMode = "dates" | "days";

export interface SlotSpec {
  mode: EventMode;
  /** "dates": YYYY-MM-DD strings; "days": 0-6 numbers (Sun=0) */
  days: (string | number)[];
  startMin: number;
  endMin: number;
  timezone: string;
}

/** Minutes-from-midnight column positions for one day. */
export function dayColumns(spec: Pick<SlotSpec, "startMin" | "endMin">): number[] {
  const out: number[] = [];
  for (let m = spec.startMin; m < spec.endMin; m += SLOT_MINUTES) out.push(m);
  return out;
}

/**
 * UTC epoch seconds for local wall-clock time `minuteOfDay` on `dateStr` in `timezone`.
 * DST-correct without dependencies: probe with Intl and adjust by the observed offset.
 */
export function zonedEpoch(dateStr: string, minuteOfDay: number, timezone: string): number {
  const [y, mo, d] = dateStr.split("-").map(Number);
  const hh = Math.floor(minuteOfDay / 60);
  const mm = minuteOfDay % 60;
  // First guess: treat the wall time as if it were UTC.
  let guess = Date.UTC(y, mo - 1, d, hh, mm, 0) / 1000;
  // Two iterations converge for any fixed-offset or DST-transition case that matters here.
  for (let i = 0; i < 2; i++) {
    const offsetMin = tzOffsetMinutes(guess, timezone);
    const corrected = Date.UTC(y, mo - 1, d, hh, mm, 0) / 1000 - offsetMin * 60;
    if (corrected === guess) break;
    guess = corrected;
  }
  return guess;
}

/** Offset (minutes east of UTC) in `timezone` at epoch seconds `t`. */
export function tzOffsetMinutes(t: number, timezone: string): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const parts = Object.fromEntries(dtf.formatToParts(new Date(t * 1000)).map((p) => [p.type, p.value]));
  const asUtc =
    Date.UTC(
      Number(parts.year),
      Number(parts.month) - 1,
      Number(parts.day),
      Number(parts.hour) % 24,
      Number(parts.minute),
      Number(parts.second)
    ) / 1000;
  return Math.round((asUtc - t) / 60);
}

/** All valid slotKeys for an event, sorted. */
export function allSlotKeys(spec: SlotSpec): number[] {
  const cols = dayColumns(spec);
  const keys: number[] = [];
  if (spec.mode === "days") {
    for (const day of spec.days as number[]) for (const m of cols) keys.push(day * 1440 + m);
  } else {
    for (const dateStr of spec.days as string[])
      for (const m of cols) keys.push(zonedEpoch(dateStr, m, spec.timezone));
  }
  return keys.sort((a, b) => a - b);
}

export function validSlotKeySet(spec: SlotSpec): Set<number> {
  return new Set(allSlotKeys(spec));
}
