# When2Yi — Feature Spec (v0.4 — build-ready)

A self-hosted When2Meet clone with the thing When2Meet famously lacks: a real API. Polls work exactly like When2Meet (one link, no accounts, paint your availability, watch the heatmap), but everything is driven by a documented REST API with webhooks — so ThatYiBot (or anything else) can create polls, watch responses, and post "3 people can now make Friday 7pm" into a Discord channel. Design philosophy (confirmed): **the site stays simple and clean; the smarts live in API consumers.** The core computes and exposes; bots schedule, decide, and ping. Target: personal servers and friend groups, not public SaaS.

**Date:** 2026-07-09
**Status:** v0.4 — all decisions resolved (§8 decisions log). Core philosophy locked: simple site, smart consumers. Ready to build.

---

## 1. Goals & Non-Goals

**Goals**

- Keep the When2Meet magic that makes people refuse to switch: no signup, one link, click-drag painting, live group heatmap. (HN on When2Meet: "gloriously cruft-free... nobody has to make an account." Any clone that adds friction here has already lost.)
- Fix its documented pain points: no editing events after creation, unusable mobile, red/green colorblind-hostile heatmap, no notifications, no finalization step, no way to fix a respondent's mistake.
- **API-first**: the web UI is itself a client of the public REST API, so anything the site can do, a bot can do. Webhooks + a rich computed-summary API are launch features, not afterthoughts.
- **Facilitate, don't natively implement** (confirmed): notice logic like "give notice X before a slot's time if it has filled to N people" is the *consumer's* job — the core just guarantees the data and change-events exist to make it a 20-line bot feature.
- First-class **ThatYiBot integration** — a plugin folder in the bot that talks to this API (create polls from Discord, post status, run the alert rules, deliver pings).
- Near-zero monthly cost, TypeScript end-to-end, same self-hosted ethos as ThatYiBot.

**Non-Goals**

- Multi-tenant SaaS, billing, accounts, ads. Nobody logs in, ever.
- **Google OAuth app verification.** Calendar scopes are "sensitive" — verification is free but needs a hosted privacy policy, Search Console domain verification, and a demo video. Not worth it for friends-scale; we stay in Testing mode (≤100 named test users) if/when we add Google sync, and lean on ICS feeds instead (§3.9).
- The booking-link model (Cal.com/Calendly) and the vote-on-N-options model (Doodle/Rallly). This is continuous-grid group polls only.
- Native mobile apps. Responsive web with proper touch input instead (When2Meet's actual mobile sin isn't "no app," it's a desktop-only grid).
- Email infrastructure in v1 — Discord is the notification channel. (Email = deliverability pain on a hobby domain; revisit at P2.)
- Paid aggregators (Nylas $10+/mo, Cronofy ~$819/mo) and iCloud CalDAV app-specific passwords (full-account credential handed to our server for a busy overlay — bad trade).

---

## 2. What When2Meet Actually Is (research summary)

Built by Don Engel as a Brown student project, essentially frozen since ~2007, still free/donation-run in 2026. Server-rendered PHP with all event data embedded as JS arrays in the page — the "API" the community uses is scraping those arrays (there's a whole ecosystem: CSV exporter userscripts, a `GCal2Meet` script that auto-paints from Google Calendar, even a When2Meet MCP server for AI agents). Demand for programmatic access is proven; supply is zero.

**Its complete feature surface:** create event (name, "Specific Dates" or "Days of the Week", no-earlier/no-later hour dropdowns, timezone) → get unique URL → participants "sign in" with a name + optional per-event password → paint 15-minute slots (autosave, no submit button) → group heatmap with hover-who's-available. CSV export via an undocumented `&csv` param. That's everything.

**The complaint list** (consistent across alternative-tool reviews, a UX redesign study, and HN threads):

| Gap | Notes |
|---|---|
| No API / integrations | Community scrapes the page JS instead |
| Can't edit events after creation | Change the time range → make a new poll, re-collect everything |
| Can't fix/delete responses | Typo'd name lives forever; organizer has no moderation tools |
| No notifications | Organizer can't hear "everyone responded" or "quorum reached" — a redesign study found users explicitly wanted "tell me when 5 people can make it" |
| No finalization | Stops at visualization; no chosen-time confirmation, no calendar invite |
| Mobile | Desktop grid on a phone: tiny cells, broken drag |
| Colorblind-hostile | Red→green heatmap; a browser extension exists solely to recolor it |
| No calendar overlay | Users tab-switch to Google Calendar and hand-copy busy times |
| Link fragility | The URL is the only handle; lose it, lose the event |
| Timezone friction | Days-of-week mode is timezone-naive by design; confusing picker |

**Competitor deltas** (what "better When2Meet" already looks like): **Crab Fit** (GPLv3, Rust+Next.js) adds Google-overlay + timezone handling but no notifications/API product. **Timeful, ex-Schej** (AGPL, Go+Vue) is the strongest — Google/Outlook/Apple overlay, "if needed" tier, subset filtering, email notifications, a plugin API. **LettuceMeet** (closed) adds calendar overlay, nothing else. **Rallly** (AGPL, Next.js+Prisma) is option-voting but is the only one that finalizes with real emailed calendar invites. **Nobody in the grid-poll space ships a documented public API + webhooks.** That's our lane, and it happens to be exactly the Discord-bot use case.

---

## 3. Feature Modules

Priorities: **P0** = core, build first · **P1** = soon after · **P2** = when wanted · **Cut** = deliberately skipped.

### 3.1 Events — **P0**

- Create: name, optional description, **Specific Dates** or **Days of the Week** mode, date/day multi-select, no-earlier/no-later bounds, fixed **15-minute slots** (When2Meet parity — ✅ confirmed; no granularity setting to explain), event timezone, optional response deadline.
- **Editable after creation** (the #1 When2Meet gripe): organizer can rename, extend/shrink the date range or hours, change deadline. Painted availability outside a shrunk range is kept in the DB (non-destructive) in case the range is re-expanded.
- Every event gets two links: **share link** (respond/view) and **organizer link** (secret suffix → edit event, manage respondents, finalize). Organizer link shown once at creation with a "keep this safe" prompt — solves link-fragility without accounts.
- Delete event; optional auto-expiry cleanup (cron) for events whose dates are long past, Crab Fit-style.

### 3.2 Availability Grid — **P0**

The product lives or dies here. When2Meet parity plus the fixes:

- Click-drag paint with autosave; two grids (yours + group heatmap) side by side on desktop, **tabbed/stacked on mobile with proper touch painting** (pointer events, large hit targets, drag without page-scroll fighting).
- **Two availability tiers**: Available and **"If needed"** (Timeful's best idea) — heatmap counts them separately (solid vs hatched/half-tone).
- Group heatmap: **colorblind-safe single-hue scale (white→blue) + on-cell counts** ("3/5"), hover/tap shows who's available vs unavailable vs if-needed; hover a name to isolate their availability (per the dataviz conventions: never encode meaning in red-vs-green alone).
- Per-participant timezone auto-detect with an override picker (grouped by offset, not When2Meet's confusing city list). Days-of-week mode stays single-timezone but *says so* in the UI.
- Keyboard path (arrow keys + space to toggle) — makes it accessible and is nearly free to build.

### 3.3 Live Updates — **P0**

- Responses stream to all open viewers via **SSE** (simpler than WebSocket, proxies/tunnels love it). The heatmap updates as people paint — When2Meet requires a refresh.

### 3.4 Identity & Respondent Management — **P0**

- When2Meet-style: type a name, optionally set a PIN to protect it. Additionally, each respondent gets a **private edit link** (magic URL) after first save — return on any device without remembering the PIN.
- **Organizer moderation** (via organizer link): rename or delete any respondent — fixes the "typo'd name lives forever" complaint.
- Optional **expected-roster** field: organizer lists who they're waiting on ("Alice, Bob, Chuck") → page and API show who hasn't responded yet.

### 3.5 REST API — **P0** ⭐ the point

- Everything above exposed as JSON under `/api/v1`, documented with an **OpenAPI spec** served at `/api/docs`. The Next.js UI consumes these same endpoints (dogfooding guarantees the API never rots).
- **Auth model:** public share-link operations need only the event ID (same trust model as When2Meet); mutations need the respondent's edit token or the organizer token; **server-level API keys** (issued via CLI/env) for trusted clients like ThatYiBot, which can act on any event and create events programmatically.
- Sketch of the surface:

| Endpoint | Purpose |
|---|---|
| `POST /events` | Create event (bot or UI) |
| `GET /events/{id}` | Event + slots + all availability (the heatmap data) |
| `PATCH /events/{id}` | Edit (organizer/API key) |
| `GET /events/{id}/summary` | Computed: top-N best slots, counts, composition viability, missing roster |
| `PUT /events/{id}/tag-groups` · `PUT /events/{id}/composition` | Define dropdowns & viability rules (§3.7) |
| `PUT /events/{id}/respondents/{rid}/availability` | Paint programmatically |
| `POST /events/{id}/finalize` | Pick winning slot(s) |
| `POST /events/{id}/webhooks` | Subscribe to change events (§3.6) |
| `GET /events/{id}/export.csv` | CSV export (When2Meet's `&csv`, but documented) |

- Light per-IP rate limiting; CORS open for GETs. No versioned stability promises — it's ours.

### 3.6 Webhooks — **P0** ⭐ (core stays dumb; consumers get smart — ✅ confirmed)

Division of labor, per your call: the core never schedules notices or decides who to ping. It does exactly two things — **compute truth** and **announce changes** — and consumers build any alerting they want on top.

- **What the core emits** (change-driven only, no timers except the deadline's single timestamp): subscribe a URL per event or globally, plain JSON + HMAC signature. Events: `respondent.created`, `availability.updated`, `slot.viable` / `slot.unviable` (viability flips under the composition rule — computed server-side anyway for the heatmap, so announcing the flip is free), `event.finalized`, `deadline.passed`. Every payload embeds the summary block (top slots, counts, viability, missing roster, "viable-only-with-conditionals: [names]") so consumers never need a follow-up GET.
- **What consumers build from that** (reference implementation = the ThatYiBot plugin, §3.8): *threshold notices* ("first viable slot!" — just react to `slot.viable`), *look-ahead notices* ("X hours before a viable slot starts" — bot-side scheduler, the bot already has one), *conditional-fill pings* ("Sam, Priya — Friday works if you're in" — names arrive in the payload; the bot resolves Discord mentions), *deadline nags*. None of this touches core code.
- No Discord-specific formatting in core — webhooks are generic JSON; pretty embeds are the bot's job (✅ confirmed). Anything that can consume a webhook or poll `GET /events/{id}/summary` gets the same power.

### 3.7 Sign-up Tags, Composition Rules & Commitment — **P0/P1** ⭐ the differentiator

The feature no competitor has: the grid knows *who* people are, not just *when* they're free. Merges When2Meet with Raid-Helper-style role signup.

- **Tag groups (creator-defined, optional per event):** the organizer adds dropdown groups of customizable options — "Role": Tank / Healer / DPS, "Bringing": Mains / Dessert / Drinks / Utensils, "Transport": Has car / Needs ride. Each group configures: multi-select allowed (default yes — people who fit multiple check multiple), required-or-optional at sign-in, and whether respondents may add their own option (free-text "other", off by default).
- **Sign-in flow:** name → one chip-select step for tags (skipped entirely if the event has no groups) → paint. Tags are editable later via the respondent's edit link; organizer can edit anyone's via the organizer link. Zero added friction for events that don't use it.
- **Commitment level — Yes vs Conditional (per respondent, ✅ confirmed):** "For sure going where I'm available" vs "ping me if I'm needed." One flag per person per event — not per-slot. Deliberately distinct from the per-slot "if needed" *time* tier in §3.2: that says *when* is inconvenient; this says *whether* they want to be counted by default. Heatmap counts firm respondents solid and conditionals as a separate translucent layer. Respondents can flip their own flag anytime via their edit link.
- **Composition rules (the filter, ✅ confirmed editable mid-poll):** organizer defines slot-viability requirements, e.g. `≥1 Tank, ≥1 Healer, ≥4 total` or `≥1 Mains, ≥1 Dessert, ≥5 total`. Editable at any time — user freedom over guardrails; viability recomputes live. Guardrails against the resulting foot-guns: `slot.viable` webhooks re-arm rather than replay (a slot that was viable, became non-viable under a stricter rule, then viable again fires again — but an edit alone never re-fires events for still-viable slots), and the organizer page shows a "rule changed, N slots changed viability" diff so mistakes are visible immediately.
  - **Heatmap "viable" outline** on slots meeting the composition (and a filter mode: dim non-viable slots).
  - **Best-times panel** ranks viable slots first.
  - **Webhooks (§3.6):** `slot.viable`/`slot.unviable` fire on composition-viability flips — a plain "≥N people" is just the degenerate one-requirement composition, so counts and compositions are one engine, not two.
  - **Conditional-fill data:** when a slot is viable only if specific conditional people attend, the summary and webhook payloads name them; *pinging* them ("Sam, Priya — Friday 7pm works if you're in") is the bot's job (§3.8). The optional Discord-handle field on respondents (free-text, or auto-filled when signing up via the ThatYiBot embed) is what makes the mention precise.
- **Correctness note:** with multi-role people, viability is a *matching* problem, not counting — if Sam checked Tank *and* Healer, he satisfies either requirement but only one at a time. Greedy counting overpromises; we check viability with a small bipartite-matching/max-flow pass (Hall's theorem). At ≤20 respondents and ≤5 requirements this is microseconds per slot, but speccing it now means the "viable" badge never lies.
- Subset filtering (§3.11) gains a tag dimension: "show overlap counting only Healers."

### 3.8 ThatYiBot Plugin — **P1** ⭐ (where the alert brains live — ✅ confirmed)

- One plugin folder in ThatYiBot, per its architecture. Commands: `/meet create` (modal → calls `POST /events`, posts the share link as an embed), `/meet status` (top slots + who's missing + composition state), `/meet finalize`.
- **The alert-rule engine lives here**, not in the core (your call: let the bot handle what the bot can handle): `/meet alert` configures per-poll rules — threshold notice (react to `slot.viable` webhooks), look-ahead notice ("X before a viable slot's start" — uses the bot's existing scheduler), conditional-fill pings (resolve Discord mentions from payload names), deadline nags. Rich embeds, role/user mentions, all formatting bot-side.
- Signing up via the bot auto-links a respondent's Discord handle for precise pings. Pairs naturally with the bot's Scheduled Messages module.
- P2 sparkle: rendered heatmap PNG in the status embed (canvas server-side).

### 3.9 Finalization & Calendar-Out — **P1**

- Organizer picks winning slot(s) → event page shows a "Scheduled: Fri Jul 17, 7–9 PM" banner, grid freezes (read-only), `event.finalized` webhook fires (→ Discord announcement).
- **Add-to-calendar with zero OAuth**: Google Calendar template link, Outlook deeplink, and a generated **.ics download** (works for Apple/desktop Outlook). All free, no API, no verification — this alone out-features every grid competitor except Rallly.
- Emailed `METHOD:REQUEST` invites: **Cut** for v1 (needs a sending domain + deliverability fight).

### 3.10 Calendar Overlay (busy times while painting) — **P1/P2**

The pragmatic ladder, given the verification research:

- **P1 — ICS feed paste**: participant pastes their secret ICS URL (Google "secret address," Outlook "publish calendar" busy-only variant, iCloud public calendar link). Server fetches (conditional GET, 15–60 min cache), parses with an RRULE-capable lib, renders busy blocks as an overlay layer on their paint grid. Zero OAuth, zero verification, works for all three providers. Honest caveat in UI: feeds can lag hours. URLs are bearer secrets → encrypted at rest, never logged.
- **P2 — Google OAuth (Testing mode)**: real-time freebusy via `calendar.freebusy` scope for ≤100 named test users — fine for a friend group, zero verification. Client-side-only (Crab Fit's pattern: token never touches our server).
- **Cut**: Microsoft Graph OAuth (personal MSA accounts can't use `getSchedule`; we'd hand-compute from calendarView for marginal gain over ICS), iCloud CalDAV (app-specific password = full account access).

### 3.11 Organizer Quality-of-Life — **P1**

- **Best-times panel**: auto-ranked top slots (composition-viable first, then most available, fewest if-needed, longest contiguous run) — When2Meet makes you eyeball the colors.
- **Subset filter**: "only count Alice/Bob/Dana" or "only count Healers" recompute (Timeful feature, extended with tags; great for "core members must attend").
- Copy-results-as-text (paste into Discord), duplicate event, CSV export (§3.5).

### 3.12 Extras — **P2**

- **When2Meet import**: slurp an existing when2meet.com poll via its `&csv` trick → recreate here. Great migration party trick.
- **Saved availability template**: paint your typical week once (stored against a browser-local key), one-click apply to any poll.
- Recurring/standing polls ("every week, repaint by Thursday"), i18n, dark mode (cheap, maybe P1).

### 3.13 Cut (deliberately)

Accounts & dashboards, email notifications/invites, comments/chat on polls, Doodle-style option voting, conferencing integrations (Meet/Zoom links beyond what finalization links give), branding/customization, ads/donations, native apps, Nylas/Cronofy.

---

## 4. Data Model (sketch)

`events` (id, slug, name, desc, mode, dates/days, bounds, granularity, tz, deadline, finalized_slots, composition JSON, organizer_token, created_at) · `respondents` (id, event_id, name, pin_hash?, edit_token, commitment yes|conditional, discord_handle?) · `availability` (respondent_id, slot_start_epoch, tier available|if_needed) — slot rows, mirroring When2Meet's `AvailableAtSlot` model, cheap at this scale · `tag_groups` (event_id, name, multi_select, required, allow_other) · `tags` (group_id, label) · `respondent_tags` (respondent_id, tag_id) · `webhooks` (event_id?, url, secret, event_types[], fired_keys[] for viability re-arm) · `api_keys` (hash, label). No alert-rules table — that state lives in ThatYiBot's own DB (§3.8). SQLite handles all of it.

---

## 5. Recommended Stack

**TypeScript + Next.js** (App Router) — as you confirmed, and consistent with ThatYiBot:

- **One Next.js app** serves UI + `/api/v1` route handlers + SSE streams. No separate backend service — at friends-scale, splitting is ceremony.
- **SQLite + Drizzle ORM** (WAL mode) — same zero-ops pattern as the bot; one-file backups; Postgres swap stays trivial if ever needed.
- In-process **scheduler** (croner) for the few timed chores the core keeps — deadline-passed webhooks, ICS feed refresh, event expiry. All *alerting* schedulers live bot-side. One Node process, one thing to deploy.
- Libraries: `zod` (validation shared by UI+API), OpenAPI generation from the zod schemas, `ics` (generate .ics), `node-ical` or `tsdav` (parse feeds incl. RRULE/EXDATE), `nanoid` (slugs/tokens).
- **Docker Compose** one-service deploy; same repo could later host the ThatYiBot plugin as a sibling package (pnpm workspace) sharing API types.

---

## 6. Hosting

Unlike the bot (outbound-only), this needs an **inbound public URL** your friends can reach.

| Route | Cost | Notes |
|---|---|---|
| **Own hardware + Cloudflare Tunnel** | ~$0 | Free tunnel = public HTTPS URL, no port forwarding; same box as ThatYiBot. Recommended start. |
| Fly.io | ~$2–3/mo | Public URL out of the box; Docker-native. |
| RackNerd VPS | ~$11/yr | Cheapest 24/7 option; run both bot and this on it. |
| Railway | $5/mo | Nicest DX. |

Footprint: one Node process + SQLite, ~150–300MB RAM. Trivially cohabits with ThatYiBot.

---

## 7. Phased Roadmap

- **Phase 1 — Poll core, API-first (P0):** events (create/edit/organizer links), grid with two tiers + touch + colorblind-safe heatmap, SSE live updates, respondent management, **tag groups + commitment level collected at sign-in** (data model in from day one, even before anything acts on it), documented `/api/v1` + API keys, CSV export.
- **Phase 2 — Integration layer (P0⭐):** composition-viability engine (matching-based) + heatmap viability outline + tag filters, change-event webhooks (`slot.viable` etc.), and the ThatYiBot `/meet` plugin carrying the whole alert-rule engine (threshold / look-ahead / conditional-fill pings / deadline nags).
- **Phase 3 — Finish the loop (P1):** finalization + add-to-calendar links/.ics, best-times panel, subset filter, roster tracking, ICS busy overlay.
- **Phase 4 — On demand (P2):** Google OAuth overlay (test-user mode), When2Meet import, saved templates, heatmap PNG in Discord embeds, recurring polls.

---

## 8. Decisions Log (all build-blocking questions resolved)

1. **Name** → ✅ **When2Yi** (runners-up: HearYi, CanYi, AvailabilYi).
2. **Alert semantics** → ✅ **facilitate, don't implement.** Core emits change events + rich summaries; timed/threshold notice logic lives in API consumers (ThatYiBot reference implementation, §3.6/§3.8).
3. **Discord delivery** → ✅ **the bot handles it.** No Discord-specific code in core; webhooks are generic JSON; site stays simple and clean.
4. **Granularity** → ✅ **fixed 15-minute slots** (When2Meet parity, no setting).
5. **Calendar overlay** → ✅ **ICS-paste ships first**; Google OAuth deferred to P2 Testing mode. No architectural barrier: the overlay is just a "busy blocks provider" interface — ICS feed today, Google API later, same rendering path.
6. **Hosting** → ⏸ **deferred, deliberately.** Product must run standalone (single Docker container, SQLite inside, no external services) so it works on any box; API access is what opens it up. Decide at deploy time — nothing in the design cares.
7. **Commitment granularity** → ✅ **per person, per event.**
8. **Composition editing** → ✅ **editable mid-poll; user freedom at the risk of user error** (re-arm + viability-diff guardrails in §3.7).

---

*Sources: when2meet.com (live), SavvyCal/Calday/Meetergo/Cal.com/ClickUp/WhenItWorks When2Meet guides & alternative roundups (2026), Raincheck UX redesign study (Medium), HN threads via Algolia, when2meet reverse-engineering gist + exporter tools (GitHub), Crab Fit / Timeful (schej-it) / Rallly / Cal.com GitHub repos & docs, Rallly pricing/support docs, Google Calendar API reference + OAuth verification docs (sensitive vs restricted scopes, Testing-mode 100-user cap, 2026 quota-billing announcement), Microsoft Graph calendar docs (getSchedule/findMeetingTimes MSA limitations, publisher verification), Apple app-specific password & iCloud publishing docs, Nylas/Cronofy pricing pages. Full URL list available on request.*
