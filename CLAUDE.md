# Notes for working on this repo

Trading-card inventory + cross-listing tracker + public shop. See README.md for features and setup.

## Commands

- `npm run dev` — API on :3001 (tsx watch) + Vite on :5173 (proxies /api and /media)
- `npm test` — Vitest unit + API tests (`tests/*.test.ts`); API tests use a temp data dir and a fake Claude client
- `npm run typecheck` — server/shared/tests (`tsconfig.server.json`) and web (`tsconfig.web.json`)
- `npm run build && npm run test:e2e` — Playwright smoke test through the real UI (`tests/e2e/smoke.mjs`; set `CHROME_PATH`)
- `npm run demo` then `DATA_DIR=./demo-data npm run dev` — sample data

## Conventions

- Money is always integer cents (`*_cents`); convert only at the edges (`shared/money.ts`).
- Dates people pick are `YYYY-MM-DD` strings; timestamps are ISO strings (`server/lib/time.ts`).
- Card status is partly derived: `recomputeStatus` (server/services/cards.ts) sets sold / listed / in_stock from sales and active listings, but keeps the manual statuses `draft`, `pending`, `keeper`. Call it after anything that changes listings, sales or quantity.
- Every change to searchable card fields must call `refreshSearchText` (the `search_text` column powers search).
- Migrations in `server/db/migrations.ts` are append-only — add a new version, never edit a shipped one.
- Request bodies are validated with zod schemas that also whitelist the columns used in dynamic `UPDATE … SET` statements.
- The public API (`server/services/public.ts`) uses an explicit allow-list — never expose cost, floor price, notes, location or buyer data there.
- Links entered by people go through `cleanUrl` (http/https only) before they're stored.
- Shared types live in `shared/types.ts`; the web app imports them as `@shared/...`.

## AI (server/services/ai/)

- Claude via `@anthropic-ai/sdk`, beta Messages API. Default model `claude-opus-5` (Settings can switch to `claude-sonnet-5`).
- Identification: `messages.parse` with a zod structured-output schema; photos resized to ≤2000px.
- Price research: `web_search_20260209` server tool + a strict `report_market_value` custom tool; handles `pause_turn`, refusals, and a nudge if no report is made.
- Opus 5 requests send `fallbacks: 'default'` with beta `server-side-fallback-2026-07-01` so safety-classifier refusals retry on a fallback model.
- Jobs are queued in the `ai_jobs` table and run two at a time (`jobs.ts`); running jobs are re-queued on restart.
