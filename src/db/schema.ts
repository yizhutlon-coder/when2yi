import { sqliteTable, text, integer, primaryKey, index } from "drizzle-orm/sqlite-core";

/**
 * Spec §4 data model. slotKey semantics depend on event mode:
 *  - mode "dates": unix epoch SECONDS (UTC) of the slot start
 *  - mode "days" : dayOfWeek * 1440 + minuteOfDay (timezone-naive by design, like When2Meet)
 * Slots are fixed 15 minutes (decision log #4).
 */

export const events = sqliteTable("events", {
  id: text("id").primaryKey(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  description: text("description"),
  mode: text("mode", { enum: ["dates", "days"] }).notNull(),
  /** JSON: mode "dates" → string[] of YYYY-MM-DD; mode "days" → number[] of 0-6 (Sun=0) */
  daysJson: text("days_json").notNull(),
  /** Daily window, minutes from midnight in event timezone. startMin < endMin. */
  startMin: integer("start_min").notNull(),
  endMin: integer("end_min").notNull(),
  timezone: text("timezone").notNull(),
  /** Optional response deadline, epoch seconds. Responses rejected after this. */
  deadline: integer("deadline"),
  /** JSON number[] of finalized slotKeys (Phase 3; kept in schema now). */
  finalizedJson: text("finalized_json"),
  /** JSON composition rule (Phase 2; kept in schema now). */
  compositionJson: text("composition_json"),
  /** JSON string[] of expected respondent names (roster tracking, §3.4). */
  rosterJson: text("roster_json"),
  organizerToken: text("organizer_token").notNull(),
  createdAt: integer("created_at").notNull(),
});

export const tagGroups = sqliteTable(
  "tag_groups",
  {
    id: text("id").primaryKey(),
    eventId: text("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    multiSelect: integer("multi_select", { mode: "boolean" }).notNull().default(true),
    required: integer("required", { mode: "boolean" }).notNull().default(false),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (t) => [index("tag_groups_event_idx").on(t.eventId)]
);

export const tags = sqliteTable(
  "tags",
  {
    id: text("id").primaryKey(),
    groupId: text("group_id")
      .notNull()
      .references(() => tagGroups.id, { onDelete: "cascade" }),
    label: text("label").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (t) => [index("tags_group_idx").on(t.groupId)]
);

export const respondents = sqliteTable(
  "respondents",
  {
    id: text("id").primaryKey(),
    eventId: text("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** scrypt hash "salt:hex", null = no PIN set (When2Meet trust model) */
    pinHash: text("pin_hash"),
    editToken: text("edit_token").notNull(),
    /** Decision log #7: one commitment flag per person per event. */
    commitment: text("commitment", { enum: ["yes", "conditional"] })
      .notNull()
      .default("yes"),
    discordHandle: text("discord_handle"),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [index("respondents_event_idx").on(t.eventId)]
);

export const respondentTags = sqliteTable(
  "respondent_tags",
  {
    respondentId: text("respondent_id")
      .notNull()
      .references(() => respondents.id, { onDelete: "cascade" }),
    tagId: text("tag_id")
      .notNull()
      .references(() => tags.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.respondentId, t.tagId] })]
);

export const availability = sqliteTable(
  "availability",
  {
    respondentId: text("respondent_id")
      .notNull()
      .references(() => respondents.id, { onDelete: "cascade" }),
    slotKey: integer("slot_key").notNull(),
    tier: text("tier", { enum: ["yes", "if_needed"] }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.respondentId, t.slotKey] }),
    index("availability_slot_idx").on(t.slotKey),
  ]
);

/** Phase 2 (§3.6). Table exists now so the API surface can be stubbed honestly. */
export const webhooks = sqliteTable("webhooks", {
  id: text("id").primaryKey(),
  eventId: text("event_id").references(() => events.id, { onDelete: "cascade" }),
  url: text("url").notNull(),
  secret: text("secret").notNull(),
  /** JSON string[] of event types, or null = all */
  eventTypesJson: text("event_types_json"),
  /** JSON string[] of fired keys for slot.viable re-arm semantics (decision log #8) */
  firedKeysJson: text("fired_keys_json"),
  createdAt: integer("created_at").notNull(),
});

export const apiKeys = sqliteTable("api_keys", {
  id: text("id").primaryKey(),
  /** sha256 hex of the key */
  keyHash: text("key_hash").notNull().unique(),
  label: text("label").notNull(),
  createdAt: integer("created_at").notNull(),
});
