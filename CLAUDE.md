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

Phase 1 (poll core, API-first) is DONE and verified. Next is Phase 2
(spec §3.6–§3.8): outbound webhooks incl. `slot.viable`/`slot.unviable`
with re-arm semantics, composition-viability engine (bipartite matching —
NOT greedy counting; see spec §3.7 correctness note), heatmap viability
outline + tag filters, then the ThatYiBot `/meet` plugin (separate project,
C:\ThatYiBot — the bot itself is still spec-only). `webhooks` table and
`compositionJson`/`finalizedJson` columns already exist in the schema.
