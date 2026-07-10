# When2Yi — project context for Claude Code

When2Meet clone with the thing When2Meet lacks: a real API. Locked design
philosophy: **simple site, smart consumers** — the core computes truth
(heatmap, summaries, viability) and announces changes (webhooks/SSE);
consumers (ThatYiBot, scripts) schedule, decide, and ping. Do not add
notification/alert scheduling logic to this codebase; it belongs in API
consumers.

Read before building anything: `FEATURE_SPEC.md` (v0.4 — §8 is the
decisions log; all build-blocking decisions are resolved). Session-by-session
state lives in `HANDOFF.md`.

## Commands

- `npm run dev` — dev server; SQLite auto-creates at `./data/when2yi.db` (no migration step needed; `src/db/index.ts` bootstraps tables)
- `npm run build && npm start` — production (single Node process, by design)
- `npm run typecheck` — tsc, must stay clean
- `npm run apikey -- "label"` — mint a server-level API key (sha256 stored)
- No test framework yet — verify via the API smoke flow in README.md

## Architecture invariants

- The web UI is a client of `/api/v1` — never let UI features bypass the API.
- Fixed 15-minute slots. `slotKey`: "dates" mode = epoch seconds UTC of slot
  start; "days" mode = `dayOfWeek*1440 + minuteOfDay`, timezone-naive on purpose.
  All slot math in `src/lib/slots.ts` (shared server+client; DST-correct — keep it dependency-free).
- Auth: no accounts, ever. Respondent `editToken` / event `organizerToken` /
  server API keys (`x-api-key`). PINs are optional per-event (When2Meet trust model).
- Event edits are non-destructive: availability outside a shrunk range is kept.
- Commitment (`yes`/`conditional`) is per-person per-event; "if_needed" tier is
  per-slot. They are different axes — never merge them.
- SSE bus (`src/lib/sse.ts`) is in-memory, single-process. Don't introduce
  multi-process deployment without replacing it.
- Update `src/lib/openapi.ts` whenever an endpoint changes.

## Current phase

Phase 1 (poll core) and the Phase 2 web-app half are DONE and verified:
composition-viability engine (`src/lib/composition.ts`), heatmap viability
outline + tag filter + composition editor, and outbound webhooks
(`src/lib/webhooks.ts`) incl. `slot.viable`/`slot.unviable` with per-webhook
re-arm. See §3.7/§3.6.

Composition correctness (important, cost a real bug once): tag requirements
are DISJOINT SEATS solved by bipartite max-flow — a multi-role person fills
one seat, never two (greedy counting overpromises). A `tagId:null` "total"
requirement is INCLUSIVE HEADCOUNT (`attendees ≥ N`), NOT part of the
matching — the tank and healer count toward the total. `slotViability`
returns viable (firm attendees suffice) / viable_if (only with conditional
or if-needed people; `neededNames` lists them) / unviable.

Webhook `emitChange(ev, type, extra)` is called from every mutation route
after the DB write; delivery is fire-and-forget HMAC-signed JSON (fine
because we're one long-lived process). Re-arm state is per-webhook
`firedKeysJson` = the viable set last announced to that subscriber.

Still Phase 2/3 and NOT built: `deadline.passed` (needs the croner chore)
and `event.finalized` (Phase 3 finalization) webhook types — reserved in
`WEBHOOK_EVENT_TYPES`' spirit but not emitted. The ThatYiBot `/meet` plugin
lives in the separate C:\ThatYiBot repo (still spec-only). `finalizedJson`
column still unused (Phase 3).
