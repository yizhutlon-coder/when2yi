/**
 * Outbound webhooks (spec §3.6). The core does exactly two things: compute truth
 * and announce changes. It never schedules notices or decides who to ping — that's
 * the consumer's job (ThatYiBot, §3.8). Deliveries are HMAC-signed generic JSON;
 * no Discord-specific formatting here.
 *
 * `slot.viable` / `slot.unviable` use RE-ARM semantics (decision log #8): each
 * subscription tracks the set of slotKeys it has been told are viable (firedKeys).
 * On every change we recompute the viable set and diff against that record — so a
 * slot going viable → unviable → viable fires again, but an unrelated edit never
 * replays events for slots whose viability didn't move.
 */

import { createHmac } from "node:crypto";
import { eq, isNull, or } from "drizzle-orm";
import { db, schema } from "@/db";
import { computeSummary, loadEventPayload, type EventRow, type Summary } from "./eventData";
import { viableSlotKeys } from "./composition";

type WebhookRow = typeof schema.webhooks.$inferSelect;

function subscribedWebhooks(eventId: string): WebhookRow[] {
  // Per-event subscriptions plus global ones (eventId IS NULL).
  return db
    .select()
    .from(schema.webhooks)
    .where(or(eq(schema.webhooks.eventId, eventId), isNull(schema.webhooks.eventId)))
    .all();
}

function wants(row: WebhookRow, type: string): boolean {
  if (!row.eventTypesJson) return true; // null = all
  try {
    const types = JSON.parse(row.eventTypesJson) as string[];
    return types.length === 0 || types.includes(type);
  } catch {
    return true;
  }
}

export function signBody(secret: string, body: string): string {
  return "sha256=" + createHmac("sha256", secret).update(body).digest("hex");
}

/** Fire-and-forget POST. We run as one long-lived process, so unawaited fetches
 *  survive past the HTTP response (unlike serverless). Failures are swallowed —
 *  webhook retry/backoff is deliberately out of scope for the core. */
function deliver(row: WebhookRow, type: string, payload: object): void {
  const body = JSON.stringify(payload);
  void fetch(row.url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-when2yi-event": type,
      "x-when2yi-signature": signBody(row.secret, body),
    },
    body,
    signal: AbortSignal.timeout(8000),
  }).catch(() => {});
}

/**
 * Announce a change to every subscriber of this event. Emits the named `type`
 * (payload embeds the summary block so consumers never need a follow-up GET),
 * then reconciles each subscription's viable-slot record and emits the resulting
 * slot.viable / slot.unviable flips.
 */
export function emitChange(ev: EventRow, type: string, extra: Record<string, unknown> = {}): void {
  const hooks = subscribedWebhooks(ev.id);
  if (!hooks.length) return;

  const payload = loadEventPayload(ev);
  const summary = computeSummary(payload, 5);
  const viableNow = viableSlotKeys(payload, payload.event.composition);
  const viableSet = new Set(viableNow);
  const at = Math.floor(Date.now() / 1000);

  const base = { type, event: ev.slug, at, summary } as Record<string, unknown>;

  for (const h of hooks) {
    if (wants(h, type)) deliver(h, type, { ...base, ...extra });

    // Re-arm diff (only meaningful once a composition rule exists).
    if (!payload.event.composition) continue;
    const fired: number[] = h.firedKeysJson ? safeParseKeys(h.firedKeysJson) : [];
    const firedSet = new Set(fired);
    const newlyViable = viableNow.filter((k) => !firedSet.has(k));
    const newlyUnviable = fired.filter((k) => !viableSet.has(k));

    for (const slotKey of newlyViable) {
      if (wants(h, "slot.viable")) {
        deliver(h, "slot.viable", { type: "slot.viable", event: ev.slug, at, slotKey, summary });
      }
    }
    for (const slotKey of newlyUnviable) {
      if (wants(h, "slot.unviable")) {
        deliver(h, "slot.unviable", { type: "slot.unviable", event: ev.slug, at, slotKey, summary });
      }
    }
    if (newlyViable.length || newlyUnviable.length) {
      db.update(schema.webhooks)
        .set({ firedKeysJson: JSON.stringify(viableNow) })
        .where(eq(schema.webhooks.id, h.id))
        .run();
    }
  }
}

function safeParseKeys(json: string): number[] {
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? v.filter((x) => typeof x === "number") : [];
  } catch {
    return [];
  }
}

export type { Summary };
