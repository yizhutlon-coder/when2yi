import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import * as schema from "./schema";

const dbPath = process.env.DATABASE_PATH ?? "./data/when2yi.db";

function createDb() {
  fs.mkdirSync(path.dirname(path.resolve(dbPath)), { recursive: true });
  const sqlite = new Database(dbPath);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  bootstrap(sqlite);
  return drizzle(sqlite, { schema });
}

/**
 * Minimal bootstrap so `npm run dev` works with zero setup.
 * (drizzle-kit push does the same from schema.ts; this keeps first run friction-free.)
 */
function bootstrap(sqlite: Database.Database) {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS events (
      id TEXT PRIMARY KEY, slug TEXT NOT NULL UNIQUE, name TEXT NOT NULL, description TEXT,
      mode TEXT NOT NULL, days_json TEXT NOT NULL, start_min INTEGER NOT NULL, end_min INTEGER NOT NULL,
      timezone TEXT NOT NULL, deadline INTEGER, finalized_json TEXT, composition_json TEXT,
      roster_json TEXT, organizer_token TEXT NOT NULL, created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS tag_groups (
      id TEXT PRIMARY KEY, event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
      name TEXT NOT NULL, multi_select INTEGER NOT NULL DEFAULT 1,
      required INTEGER NOT NULL DEFAULT 0, sort_order INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS tag_groups_event_idx ON tag_groups(event_id);
    CREATE TABLE IF NOT EXISTS tags (
      id TEXT PRIMARY KEY, group_id TEXT NOT NULL REFERENCES tag_groups(id) ON DELETE CASCADE,
      label TEXT NOT NULL, sort_order INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS tags_group_idx ON tags(group_id);
    CREATE TABLE IF NOT EXISTS respondents (
      id TEXT PRIMARY KEY, event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
      name TEXT NOT NULL, pin_hash TEXT, edit_token TEXT NOT NULL,
      commitment TEXT NOT NULL DEFAULT 'yes', discord_handle TEXT, created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS respondents_event_idx ON respondents(event_id);
    CREATE TABLE IF NOT EXISTS respondent_tags (
      respondent_id TEXT NOT NULL REFERENCES respondents(id) ON DELETE CASCADE,
      tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
      PRIMARY KEY (respondent_id, tag_id)
    );
    CREATE TABLE IF NOT EXISTS availability (
      respondent_id TEXT NOT NULL REFERENCES respondents(id) ON DELETE CASCADE,
      slot_key INTEGER NOT NULL, tier TEXT NOT NULL,
      PRIMARY KEY (respondent_id, slot_key)
    );
    CREATE INDEX IF NOT EXISTS availability_slot_idx ON availability(slot_key);
    CREATE TABLE IF NOT EXISTS webhooks (
      id TEXT PRIMARY KEY, event_id TEXT REFERENCES events(id) ON DELETE CASCADE,
      url TEXT NOT NULL, secret TEXT NOT NULL, event_types_json TEXT, fired_keys_json TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS api_keys (
      id TEXT PRIMARY KEY, key_hash TEXT NOT NULL UNIQUE, label TEXT NOT NULL, created_at INTEGER NOT NULL
    );
  `);
}

/** Survive Next.js dev-mode hot reloads without leaking connections. */
const globalForDb = globalThis as unknown as { __when2yi_db?: ReturnType<typeof createDb> };
export const db = globalForDb.__when2yi_db ?? (globalForDb.__when2yi_db = createDb());
export { schema };
