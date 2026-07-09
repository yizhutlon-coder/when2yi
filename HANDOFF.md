# When2Yi — handoff record

**From:** Cowork session, 2026-07-09 (research → spec → Phase 1 scaffold)
**For:** the next Claude Code session (and future Yi)

## 1. Where things stand

- `FEATURE_SPEC.md` v0.4 is the contract. Every build-blocking decision is
  resolved and recorded in its §8 decisions log. Highlights: name **When2Yi**;
  **simple site, smart consumers** (no alert scheduling in core — bots do it);
  fixed 15-min slots; per-person commitment; composition rules editable
  mid-poll (re-arm + viability-diff guardrails); ICS-paste calendar overlay
  before Google OAuth; hosting deferred (must run standalone: one container,
  SQLite inside).
- **Phase 1 is complete and verified** (see §3). Phases 2–4 are specced but
  not started.
- **ThatYiBot does not exist yet** — C:\ThatYiBot holds only its own feature
  spec. The When2Yi Phase 2 "ThatYiBot plugin" work therefore lands in that
  project once the bot is scaffolded; until then, webhooks + `/summary`
  polling are the integration surface.

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

1. Composition-viability engine: rule = list of `{tagId|any, min}`;
   viability per slot via **bipartite matching** (multi-role people can't be
   double-counted — greedy is wrong). Wire into summary + heatmap outline +
   tag-filtered views.
2. Outbound webhooks: subscribe URL per event/global (table exists), HMAC
   signature, change-driven events (`respondent.created`,
   `availability.updated`, `slot.viable`/`slot.unviable` with re-arm
   semantics per decisions log #8, `event.finalized`, `deadline.passed` —
   the one timer the core keeps). Payloads embed the summary block.
3. ThatYiBot `/meet` plugin (in the bot repo, once the bot exists): create/
   status/finalize commands + the alert-rule engine (threshold, look-ahead,
   conditional-fill pings, deadline nags) — all bot-side.

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
