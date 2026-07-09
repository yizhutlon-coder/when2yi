/**
 * OpenAPI 3.1 document for /api/v1 (spec §3.5: documented API served at /api/docs).
 * Hand-maintained for Phase 1; TODO(phase2): generate from the zod schemas in validate.ts.
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
      "API keys can do anything (create events, edit any event).",
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
          "Computed summary: top slots (firm yes / conditional yes / if-needed counts + names), missing roster. Phase 2 adds composition viability.",
      },
    },
    "/api/v1/events/{slug}/export": {
      get: { summary: "CSV export (rows=slots, cols=respondents)." },
    },
    "/api/v1/events/{slug}/stream": {
      get: {
        summary:
          "SSE stream of change events: respondent.created, availability.updated, event.updated, respondent.updated, respondent.deleted. Phase 2 adds slot.viable/slot.unviable and outbound webhooks.",
      },
    },
  },
} as const;
