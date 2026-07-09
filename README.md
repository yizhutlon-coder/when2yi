# When2Yi

A self-hosted When2Meet clone with the thing When2Meet famously lacks: **a real API**.
One link, no accounts, paint your availability, watch the heatmap — and every bit of it
is scriptable, so ThatYiBot (or anything else) can create polls, watch responses, and
ping the channel when game night becomes viable.

Design philosophy (see [`FEATURE_SPEC.md`](./FEATURE_SPEC.md)): **simple site, smart consumers.**
The core computes truth and announces changes; bots schedule, decide, and ping.

## Run it

```bash
npm install
npm run dev        # http://localhost:3000  (DB auto-creates at ./data/when2yi.db)
```

Production: `npm run build && npm start`. One Node process, SQLite inside — runs anywhere.

## API

- OpenAPI JSON at `/api/docs`, Swagger UI at `/api/docs?ui`.
- Mint a bot key: `npm run apikey -- "thatyibot"` → use as `x-api-key` header.
  API keys can do anything (create events, edit any event) — spec §3.5 auth model.
- Quick tour:

```bash
# create an event (Fri+Sat evenings, gamer roles)
curl -s localhost:3000/api/v1/events -H 'content-type: application/json' -d '{
  "name": "Game night", "mode": "days", "days": [5,6],
  "startMin": 1080, "endMin": 1380, "timezone": "America/New_York",
  "tagGroups": [{"name":"Role","multiSelect":true,"options":["Tank","Healer","DPS"]}],
  "roster": ["Yi","Sam","Priya"]
}'
# → { event: {slug}, organizerToken, ... }

# join + paint (slotKey = day*1440 + minuteOfDay for "days" mode)
curl -s localhost:3000/api/v1/events/SLUG/respondents -H 'content-type: application/json' \
  -d '{"name":"Sam","commitment":"conditional","tagIds":[]}'
curl -s -X PUT localhost:3000/api/v1/events/SLUG/respondents/RID/availability \
  -H 'content-type: application/json' -H 'x-edit-token: TOKEN' \
  -d '{"slots":[{"slotKey":8280,"tier":"yes"}]}'

# what a bot polls
curl -s localhost:3000/api/v1/events/SLUG/summary
curl -s localhost:3000/api/v1/events/SLUG/export        # CSV
curl -N  localhost:3000/api/v1/events/SLUG/stream        # SSE change events
```

## What's here (Phase 1) vs not yet

Done: events (create/edit/organizer links, non-destructive edits), 15-min paint grid with
**Available / If needed** tiers, white→blue colorblind-safe heatmap with counts + hover
who's-free, sign-up **dropdowns/tags** + **Yes vs Conditional** commitment, expected-roster
tracking, SSE live updates, respondent moderation, full REST API + API keys, CSV export.

Phase 2+ (spec §3.6–§3.8): outbound webhooks (`slot.viable` etc.), composition-viability
engine (1 Tank + 1 Healer + 4 total, matching-based), ThatYiBot `/meet` plugin with the
alert rules, finalization + add-to-calendar, ICS busy overlay.

Known Phase-1 polish TODOs: per-viewer timezone rendering for "dates" events (currently
shown in event timezone), keyboard painting path, mobile drag ergonomics tuning,
per-IP rate limiting.

## Layout

```
src/db/          schema + SQLite bootstrap (drizzle; WAL; auto-creates on first run)
src/lib/         slot math, auth (PIN/tokens/API keys), SSE bus, summary, CSV, OpenAPI
src/app/api/v1/  the REST API (the UI is just another client of it)
src/app/         create page (/) and event page (/e/[slug])
src/components/  AvailabilityGrid (paint + heatmap), EventClient
scripts/         create-api-key.ts
```
