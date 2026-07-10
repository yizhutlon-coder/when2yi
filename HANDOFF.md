# When2Yi — handoff record

**From:** Cowork session 2026-07-09 (Phase 1) → Claude Code session 2026-07-09
(Phase 2 web-app half)
**For:** the next Claude Code session (and future Yi)

## 1. Where things stand

- `FEATURE_SPEC.md` v0.4 is the contract. Every build-blocking decision is
  resolved and recorded in its §8 decisions log. Highlights: name **When2Yi**;
  **simple site, smart consumers** (no alert scheduling in core — bots do it);
  fixed 15-min slots; per-person commitment; composition rules editable
  mid-poll (re-arm + viability-diff guardrails); ICS-paste calendar overlay
  before Google OAuth; hosting deferred (must run standalone: one container,
  SQLite inside).
- **Phase 1 complete and verified** (see §3).
- **Phase 2 web-app half complete and verified** (see §8, added this session):
  composition-viability engine (bipartite matching), heatmap viability
  outline + tag filter + organizer composition editor, and outbound webhooks
  with `slot.viable`/`slot.unviable` re-arm. Remaining Phase 2 item is the
  ThatYiBot `/meet` plugin (separate repo). Not-yet-built webhook types:
  `deadline.passed` (needs the croner chore) and `event.finalized` (Phase 3).
- **Env note:** dev now runs on Node 24 via `better-sqlite3@^12` (the v11 pin
  had no Node 24 prebuild). Committed.
- **ThatYiBot does not exist yet** — C:\ThatYiBot holds only its own feature
  spec. The When2Yi "ThatYiBot plugin" work lands in that project once the bot
  is scaffolded; until then, webhooks + `/summary` polling are the integration
  surface, both now live.

## 2. What Phase 1 delivered

Next.js 15 (App Router) + TypeScript + Drizzle + better-sqlite3, ~35 files:

- Events: create (dates or days-of-week, description, deadline, expected
  roster, tag-group dropdowns), **edit after creation** (non-destructive),
  delete; share link + one-time organizer link.
- Respondents: name + optional PIN sign-in (case-insensitive rejoin),
  Yes/Conditional commitment, tag chips (multi/single-select enforced),
  organizer moderation (rename/remove), private edit tokens.
- Grid: click/touch-drag painting, Available + If-needed tiers, white→blue
  colorblind-safe heatmap with on-cell counts, hover who's-free panel,
  SSE live updates across viewers.
- API: full REST under `/api/v1` (OpenAPI at `/api/docs`, Swagger UI at
  `/api/docs?ui`), server API keys via `npm run apikey`, CSV export,
  SSE stream endpoint. UI consumes only these endpoints.
- Summary endpoint: top slots ranked (firm yes > conditional > if-needed),
  names per bucket, missing-roster list.

## 3. Verification performed (this session)

- `tsc --noEmit` and `next build` clean.
- Live API smoke test: event create (both modes) → tag validation →
  sign-in with PIN → paint → wrong-token 403 → invalid-slot 400 →
  case-insensitive rejoin with right/wrong PIN → organizer PATCH +
  respondent delete → no-auth PATCH 403 → API-key event creation →
  summary bucket correctness (conditional respondent counted as
  `conditionalYes`, roster diff right) → CSV shape → SSE delivered
  `respondent.created` live.
- DST check: dates-mode slots on 2026-11-01/02 (America/New_York fall-back
  weekend) land at UTC-5 correctly; slot count = days × slots/day.
- No automated tests exist yet — worth adding vitest around
  `src/lib/slots.ts` and `src/lib/eventData.ts` before Phase 2 logic lands.

## 4. Known gaps / TODOs (deliberate, not bugs)

- Dates-mode grid renders in the **event** timezone, not each viewer's
  (spec §3.2 wants per-viewer). `slots.ts` already has the conversion
  helpers; this is UI work.
- No keyboard painting path yet (spec §3.2).
- Mobile drag works but ergonomics untuned (scroll-vs-paint tension).
- No rate limiting.
- OpenAPI doc is hand-maintained (`src/lib/openapi.ts`) — spec wants it
  generated from the zod schemas in `src/lib/validate.ts` eventually.
- `webhooks` table, `compositionJson`, `finalizedJson` exist in schema but
  nothing reads them — they are Phase 2/3 anchors, don't delete them.

## 5. Phase 2 build order (from spec §3.6–§3.8, §7)

1. ✅ **Composition-viability engine** — `src/lib/composition.ts`. DONE (§8).
2. ✅ **Outbound webhooks** — `src/lib/webhooks.ts` + routes. DONE (§8) except
   `deadline.passed` (needs the croner chore) and `event.finalized` (Phase 3).
3. ⏳ **ThatYiBot `/meet` plugin** (in the bot repo, once the bot exists):
   create/status/finalize commands + the alert-rule engine (threshold,
   look-ahead, conditional-fill pings, deadline nags) — all bot-side. The
   integration surface it consumes (webhooks incl. conditional-fill
   `neededNames`, `/summary`) is live.

## 6. Repo / environment notes

- Target remote: `https://github.com/yizhutlon-coder/when2yi.git`.
  **Cowork cloud sessions cannot push to it** (egress proxy allowlists
  GitHub repos per session; no add_repo mechanism in Cowork). Yi pushes
  from the local machine; a Claude Code on the web session started with
  this repo connected CAN push directly.
- A fine-grained GitHub PAT was pasted into the Cowork chat on 2026-07-09
  during push attempts. It was never successfully used. **Confirm it has
  been revoked** (github.com → Settings → Developer settings →
  Fine-grained tokens).
- Local source of truth: `C:\WhenToYi\when2yi` (this folder). The Cowork
  container's copy had one commit on `main` ("Phase 1: When2Meet-style
  polls with a real API"); if the local folder was pushed separately,
  histories may differ — the *files* are identical as of this handoff.
- Windows dev: better-sqlite3 needs a prebuilt binary or build tools;
  Node 20/22 LTS recommended. DB auto-creates on first `npm run dev` —
  there is no separate migrate step (bootstrap SQL in `src/db/index.ts`
  mirrors `src/db/schema.ts`; keep them in sync when changing schema,
  or switch to real drizzle-kit migrations as part of Phase 2).

## 7. Research corpus (for context, all in FEATURE_SPEC.md sources)

When2Meet feature/complaint inventory, competitor deltas (Crab Fit,
Timeful/ex-Schej, LettuceMeet, Rallly, Cal.com), and calendar-API
feasibility (Google sensitive-scope verification, Graph MSA limitations,
ICS-feed staleness, add-to-calendar links) were researched 2026-07-09.
Net: nobody in the grid-poll space ships a documented public API +
webhooks — that's this project's lane.

## 8. Phase 2 web-app half — built & verified (2026-07-09)

New files: `src/lib/composition.ts`, `src/lib/webhooks.ts`, routes
`…/composition`, `…/webhooks`, `…/webhooks/[wid]`. Touched: `eventData.ts`
(composition on payload; viability in summary + viable-first ranking),
`validate.ts` (composition/webhook zod), `AvailabilityGrid.tsx` (outline +
tag filter + dim toggle + hover viability), `EventClient.tsx` (organizer
composition editor + best-times Composition column), `globals.css`,
`openapi.ts`. `emitChange` wired into all mutation routes.

**Composition engine correctness (cost a real bug, now covered by 10 asserts
in scratchpad `test_matching.mjs`):** tag requirements are DISJOINT SEATS via
bipartite max-flow (multi-role person fills one seat — greedy overpromises);
a `tagId:null` "total" is INCLUSIVE HEADCOUNT (`attendees ≥ N`), NOT part of
the matching. First implementation wrongly modeled total as N extra distinct
seats and called `≥1T ≥1H ≥3total` with {T,H,X} unviable — fixed. Statuses:
viable (firm attendees suffice) / viable_if (only with conditional/if-needed;
`neededNames` lists who) / unviable.

**Webhooks:** HMAC-SHA256 in `x-when2yi-signature`, type in `x-when2yi-event`,
every payload embeds the summary block. `slot.viable`/`slot.unviable` re-arm
per subscriber via `firedKeysJson` (seeded with currently-viable slots at
subscribe so a fresh sub isn't flooded). Verified end-to-end (scratchpad
`test_webhooks.mjs`): flip a slot viable→unviable→viable fires
slot.viable→slot.unviable→slot.viable, HMAC valid each time, already-viable
slots never re-fire on unrelated edits.

**UI verified** via accessibility snapshot + computed-style inspection (the
browser-pane screenshot tool was stuck this session — SSE/renderer, not a
code fault; every server request returned 200): 12 viable cells render a
solid green inset ring, 4 viable_if cells an amber ring; composition editor,
tag filter, dim toggle, and "N viable" best-times all present. `tsc` clean.

**Follow-up polish (2026-07-10):** host-only config now lives on the CREATE
page in collapsible `<details>` (Sign-up dropdowns / Composition rule /
Extras, collapsed by default); composition can be set at creation, referencing
role options by `{group index, option label}` which the create route resolves
to tagIds after inserting tags (see `compositionRefInput`). The organizer
editor on the event page is also collapsed now (still there for mid-poll
edits). Viable cells got a bold white+green double-ring + glow. Best-times, when
a composition exists, now shows contiguous **viable blocks** (expandable) with
duration, per-role available/min (spare vs locked), and must-attend vs swappable
people — `viableBlocks()` in composition.ts, whole-block staffability via the
same matching. Verified live: create-time composition resolves, blocks/roles/
swappability correct, sections collapsed.

**Roster-shift + copy (2026-07-10):** composition gained `allowRosterShift`
(default true). Lax = Best-times blocks are per-slot-viable runs (may show
"roster shifts"); strict (`false`) = `viableBlocks` segments into maximal
SINGLE-ROSTER runs so every shown block is staffable throughout. Toggle "Is
swapping members during the event allowed?" lives in the composition-rule
section (create page + organizer editor); stored in compositionJson via both
create route and PUT. Note it only affects block segmentation, not per-slot
viability/heatmap/webhooks (a single 15-min slot has no "shift"). Each block
has a **Copy roster** button → clipboard text: time+duration, role mins
("Tank 1, Healer 1 · 2+ total"), then `@handle`-or-`@name` per whole-block
attendee (uses `discordHandle` when set) for pasting into Discord/Chat.
Multi-role people ("willing to do either") are already handled by the
bipartite matching — one seat at a time, any valid assignment. All verified
live (lax→1 shifting block, strict→2 staffable blocks, copy text exact).

**Gaps to close next:** (a) no test framework in-repo yet — port the two
scratchpad test scripts to vitest (they caught the matching bug); (b)
`deadline.passed`/`event.finalized` webhooks; (c) `PUT /tag-groups` (tag
groups are still create-time only), so composition can only reference tags
defined at creation; (d) viable_if cell ring is solid amber not dashed
(box-shadow can't dash) — only the legend swatch is dashed.
