/**
 * Light per-IP rate limiting (spec §3.5). In-memory fixed-window counters kept on
 * globalThis — single-process by design, same as the SSE bus. It's a courtesy guard
 * against a leaked share link getting hammered; a reverse proxy / Cloudflare should
 * still sit in front for real DDoS protection.
 *
 * Trusted server API keys (x-api-key) are exempt so bots like ThatYiBot aren't throttled.
 */

import { NextResponse } from "next/server";
import { hasValidApiKey } from "./auth";

type Entry = { count: number; resetAt: number };

const g = globalThis as unknown as { __when2yi_rl?: Map<string, Entry> };
const buckets = g.__when2yi_rl ?? (g.__when2yi_rl = new Map<string, Entry>());

/** Best-effort client IP: Cloudflare / proxy headers, else "unknown" (shared bucket). */
export function clientIp(req: Request): string {
  const h = req.headers;
  return (
    h.get("cf-connecting-ip") ||
    h.get("x-real-ip") ||
    h.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    "unknown"
  );
}

function hit(key: string, limit: number, windowMs: number): { ok: boolean; retryAfter: number } {
  const now = Date.now();
  let e = buckets.get(key);
  if (!e || now > e.resetAt) {
    e = { count: 0, resetAt: now + windowMs };
    buckets.set(key, e);
  }
  e.count++;
  // Opportunistic sweep so the map can't grow unbounded from one-off IPs.
  if (buckets.size > 5000) {
    for (const [k, v] of buckets) if (now > v.resetAt) buckets.delete(k);
  }
  if (e.count > limit) return { ok: false, retryAfter: Math.ceil((e.resetAt - now) / 1000) };
  return { ok: true, retryAfter: 0 };
}

/** Returns a 429 response if the caller is over `limit` in `windowMs`, else null. */
export function enforceRateLimit(
  req: Request,
  name: string,
  limit: number,
  windowMs: number
): NextResponse | null {
  if (hasValidApiKey(req)) return null;
  const { ok, retryAfter } = hit(`${name}:${clientIp(req)}`, limit, windowMs);
  if (ok) return null;
  return NextResponse.json(
    { error: "Too many requests — please slow down." },
    { status: 429, headers: { "retry-after": String(retryAfter) } }
  );
}
