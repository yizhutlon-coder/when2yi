/**
 * OpenAPI 3.1 document for /api/v1 (spec §3.5: documented API served at /api/docs).
 * Hand-maintained; TODO: generate from the zod schemas in validate.ts.
 */
export const openapi = {
  openapi: "3.1.0",
  info: {
    title: "When2Yi API",
    version: "0.1.0",
    description:
      "When2Meet-style group availability polls, API-first. " +
      "Auth: none for reads; `x-edit-token` for a respondent's own data; " +
      "`x-organizer-token` for event admin; `x-api-key` (or Bearer) for trusted bots — " +
      "API keys can do anything (create events, edit any event). " +
      "Light per-IP rate limits apply to event creation, sign-in, and availability saves " +
      "(HTTP 429 with Retry-After); valid API keys are exempt.",
  },
  paths: {
    "/api/v1/events": {
      post: {
        summary: "Create an event",
        requestBody: {
          content: {
            "application/json": {
              example: {
                name: "Game night",
                mode: "days",
                days: [5, 6],
                startMin: 1080,
                endMin: 1380,
                timezone: "America/New_York",
                tagGroups: [
                  { name: "Role", multiSelect: true, options: ["Tank", "Healer", "DPS"] },
                ],
                roster: ["Yi", "Sam", "Priya"],
              },
            },
          },
        },
        responses: {
          "201": {
            description:
              "Created. Returns event payload plus organizerToken (shown once — store it).",
          },
        },
      },
    },
    "/api/v1/events/{slug}": {
      get: { summary: "Full event payload: event, slots, tagGroups, respondents+availability" },
      patch: { summary: "Edit event (organizer/API key). Non-destructive range shrink." },
      delete: { summary: "Delete event (organizer/API key)." },
    },
    "/api/v1/events/{slug}/rotate-organizer": {
      post: {
        summary:
          "Rotate the organizer token (organizer/API key) — invalidates a leaked admin link and returns a fresh one.",
      },
    },
    "/api/v1/events/{slug}/respondents": {
      post: {
        summary:
          "Sign in / create respondent. Same name + matching PIN returns the existing respondent's editToken (When2Meet trust model).",
      },
    },
    "/api/v1/events/{slug}/respondents/{rid}": {
      patch: { summary: "Update name/commitment/tags (edit token or organizer)." },
      delete: { summary: "Remove respondent (edit token or organizer moderation)." },
    },
    "/api/v1/events/{slug}/respondents/{rid}/availability": {
      put: {
        summary: "Full replacement of painted slots (autosave model). Requires edit token.",
        requestBody: {
          content: {
            "application/json": {
              example: { slots: [{ slotKey: 1760140800, tier: "yes" }] },
            },
          },
        },
      },
    },
    "/api/v1/events/{slug}/summary": {
      get: {
        summary:
          "Computed summary: top slots ranked (composition-viable first, then firm yes / conditional yes / if-needed counts + names), per-slot viability (viable/viable_if/unviable + neededNames), viableCount, missing roster.",
      },
    },
    "/api/v1/events/{slug}/composition": {
      get: { summary: "Current composition rule (or null)." },
      put: {
        summary:
          "Set/replace the composition rule (organizer/API key, editable mid-poll). Requirements = [{tagId|null, min}]; tagId null means an ≥N-total floor. Empty list clears the rule. Returns changedSlots (viability diff). Viability is a bipartite matching, so a multi-role person only fills one seat.",
        requestBody: {
          content: {
            "application/json": {
              example: {
                requirements: [
                  { tagId: "<tank-tag-id>", min: 1 },
                  { tagId: "<healer-tag-id>", min: 1 },
                  { tagId: null, min: 4 },
                ],
              },
            },
          },
        },
      },
    },
    "/api/v1/events/{slug}/webhooks": {
      get: { summary: "List this event's webhook subscriptions (organizer/API key; secrets not returned)." },
      post: {
        summary:
          "Subscribe a URL to change events (organizer/API key). Secret shown once. Deliveries are POSTs signed with HMAC-SHA256 in x-when2yi-signature and typed via x-when2yi-event. Every payload embeds the summary block.",
        requestBody: {
          content: {
            "application/json": {
              example: {
                url: "https://bot.example/hooks/when2yi",
                eventTypes: ["slot.viable", "slot.unviable", "respondent.created"],
              },
            },
          },
        },
        responses: {
          "201": { description: "Subscribed. Returns { id, secret, url, eventTypes }." },
        },
      },
    },
    "/api/v1/events/{slug}/webhooks/{wid}": {
      delete: { summary: "Delete a webhook subscription (organizer/API key)." },
    },
    "/api/v1/events/{slug}/export": {
      get: { summary: "CSV export (rows=slots, cols=respondents)." },
    },
    "/api/v1/events/{slug}/stream": {
      get: {
        summary:
          "SSE stream of change events for live viewers: respondent.created, availability.updated, event.updated, respondent.updated, respondent.deleted. (Outbound webhooks — incl. slot.viable/slot.unviable — are separate; see POST /webhooks.)",
      },
    },
  },
} as const;
