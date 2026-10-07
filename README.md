# Rythu Bazar Prices

Today's vegetable rates at Telangana Rythu Bazars, in one place. It runs entirely on Cloudflare's free plan.

- **Source:** Telangana Rythu Bazar Information System (`183.82.5.184/rbzts`). There's no API, so we scrape it. See [RESEARCH.md](RESEARCH.md).
- **Stack:** one Cloudflare Worker. It serves the static site (`public/`), the JSON API (`src/api.ts`) and the scraper (cron, `src/scraper/`), and stores everything in **D1** (SQLite).

## How the scraper fits the free plan

| Free-plan limit | How we stay under it |
|---|---|
| 50 subrequests per invocation (fetch **and** D1 both count) | Each tick makes at most `FETCH_BUDGET` = 35 fetches, retries included. D1 adds ≤ 11 (2 reads, 1 lease, ≤ 8 writes in one batch). Rows go to D1 as a single JSON param through `json_each`, so a batch is ~8 statements whatever its size. |
| 10 ms CPU per invocation | Regex parsing costs ≈ 0.2 ms per page (`npm test` prints it). View-state parsing is skipped on market pages, and network waits don't count as CPU. |
| 5 cron triggers per account | Uses 1: `*/5 2-10 * * *` (every 5 min, 07:30–16:25 IST). |
| D1: 100k writes / 5M reads per day | Prices are written only when a market's table changes (hash check, plus `ON CONFLICT … WHERE price != excluded.price`). Expect ~1–3k writes per day. |
| `fetch()` can't target a bare IP (error 1003) | `RBZ_ORIGIN` uses `183-82-5-184.sslip.io`, a public wildcard DNS name that resolves to the IP. IIS ignores the Host header. |

**Scheduling** (`src/scraper/plan.ts`): a full crawl is ~60 requests (1 home + 1 per district + 1 per market), too many for one invocation. So each tick does the most overdue slice of work that fits the budget:

- A market that hasn't reported today is checked every **30 min** (`ACTIVE_INTERVAL_MIN`).
- A market that has reported today is re-checked every **3 h** for revisions (`RECHECK_INTERVAL_MIN`).
- Each district's market list, including districts with no markets, is re-read daily (`DISCOVERY_INTERVAL_MIN`), so new or closed markets are picked up.
- If budget runs out mid-district, the unchecked markets stay due and the next tick picks them up.
- A one-row lease in D1 stops overlapping ticks when the upstream is slow.
- Most ticks find nothing due, cost one D1 read and make zero upstream requests.

The very first run discovers all 33 districts and 40 markets over about 5 ticks.

## Setup

```sh
npm install
npx wrangler login                      # once
npx wrangler d1 create rythu-bazar      # copy the database_id into wrangler.jsonc
npm run db:migrate:remote
npm run deploy
```

Optional: run a tick on demand in production:

```sh
npx wrangler secret put ADMIN_TOKEN
curl -X POST -H "Authorization: Bearer <token>" https://<worker>.workers.dev/api/admin/scrape
```

## Local development

```sh
npm run db:migrate:local
npm run dev                             # http://localhost:8787
curl "http://localhost:8787/__scheduled" # run one scrape tick (hits the live rbzts site)
npm test && npm run typecheck
```

## API

| Endpoint | Returns |
|---|---|
| `GET /api/markets` | Districts → markets, with `lastReportedDate` |
| `GET /api/overview` | All markets at once: each item's min / max / median across markets' latest tables, and where it's cheapest (the home page) |
| `GET /api/prices?market=<id>` | The market's latest price table, plus `isToday` and each item's cross-market `stats` |
| `GET /api/item?name=<item>` | One item across markets (each market's latest date within 3 days), cheapest first |
| `GET /api/status` | Coverage today and the last 20 scrape runs |

## Things to watch after the first deploy

- **Upstream reachability:** verified 2026-10-07 — rbzts answers requests from Cloudflare. If every run in `/api/status` starts showing `fatal: … timed out`, it has started blocking.
- **D1 reads:** "latest table per market" comes from `markets.last_reported_date`, not `MAX(date)` over `prices`, so page views don't scan the whole history. Keep it that way; check `meta.rows_read` with `wrangler d1 execute --remote --json` when changing queries.
- **CPU time:** Workers dashboard → Observability shows CPU per invocation. If ticks get close to 10 ms, lower `FETCH_BUDGET`.
- **sslip.io dependency:** if you own a domain on Cloudflare, add a DNS-only A record (e.g. `rbz-origin.example.com → 183.82.5.184`) and point `RBZ_ORIGIN` at it.
