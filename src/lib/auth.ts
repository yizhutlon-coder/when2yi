import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";

/** PIN hashing (When2Meet-style optional per-event password). */
export function hashPin(pin: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(pin, salt, 32).toString("hex");
  return `${salt}:${hash}`;
}

export function verifyPin(pin: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const candidate = scryptSync(pin, salt, 32);
  const expected = Buffer.from(hash, "hex");
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

/** API keys are stored as sha256(key). */
export function hashApiKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

export function bearerToken(req: Request): string | null {
  const h = req.headers.get("authorization");
  if (h?.toLowerCase().startsWith("bearer ")) return h.slice(7).trim();
  return null;
}

/** Server-level API key: full power over any event (§3.5 auth model). */
export function hasValidApiKey(req: Request): boolean {
  const key = req.headers.get("x-api-key") ?? bearerToken(req);
  if (!key) return false;
  const row = db.select().from(schema.apiKeys).where(eq(schema.apiKeys.keyHash, hashApiKey(key))).get();
  return !!row;
}

/** Organizer token from header or ?organizer= query param. */
export function organizerTokenFrom(req: Request): string | null {
  const url = new URL(req.url);
  return req.headers.get("x-organizer-token") ?? url.searchParams.get("organizer");
}

/** Respondent edit token from header or ?editToken= query param. */
export function editTokenFrom(req: Request): string | null {
  const url = new URL(req.url);
  return req.headers.get("x-edit-token") ?? url.searchParams.get("editToken");
}

export function isOrganizer(req: Request, event: { organizerToken: string }): boolean {
  if (hasValidApiKey(req)) return true;
  return organizerTokenFrom(req) === event.organizerToken;
}
