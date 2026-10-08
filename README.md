# Rythu Bazar Prices

Today's vegetable rates at Telangana Rythu Bazars, in one place. It runs entirely on Cloudflare's free plan.

**Live:** https://rythu-bazar.sunnyhaladker.workers.dev

- **Source:** Telangana Rythu Bazar Information System (`183.82.5.184/rbzts`), run by the Agricultural Marketing Dept. Each bazar's staff enter that day's rates by about 1 PM. There's no API, so we scrape it. See [RESEARCH.md](RESEARCH.md).
- **Stack:** one Cloudflare Worker. It serves the static site (`public/`), the JSON API (`src/api.ts`) and the scraper (cron, `src/scraper/`), and stores everything in **D1** (SQLite).
- **Coverage:** Telangana only (40 bazars). Andhra Pradesh's equivalent portal is down; see RESEARCH.md → Andhra Pradesh.

## How it works

```
rbzts (ASP.NET page, no API)
   │  every 5 min, 05:30–16:25 IST: Worker cron scrapes only what's due (src/scraper/)
   ▼
D1: districts → markets → prices (one row per market / day / item, history kept)
   │  JSON API (src/api.ts)
   ▼
Static site (public/): all-bazar overview by default, one bazar via ?market=<id>
```

1. **Scrape.** The cron Worker posts the rbzts dropdowns (district → market) and parses each market's price table. Prices fill in through the morning, so markets are re-checked until they report. Bazars post between ~07:30 and the 1 PM deadline (8 Oct: Yellandu by 07:30, Kukatpally 09:50, most later). rbzts shows no date, so a table identical to a bazar's previous day is treated as yesterday's still on screen, not today's (`isCarryOver`).
2. **Store.** Each market's table is saved per IST date. A row is written only when a price changes, and history is never pruned. Price history starts 7 Oct 2026; rbzts has no older data.
3. **Serve.** The home page shows every item across all bazars: its price range (lowest–highest) and where it's cheapest. Picking a bazar ("Choose a branch") shows that bazar's own table.
4. **Share.** Links get a preview card on WhatsApp and social media, and bazar links are titled after their bazar (see below).

## Project layout

| Path | What |
|---|---|
| `src/index.ts` | Worker entry: routes `/api/*`, adds share tags to `/`, runs the cron |
| `src/scraper/` | `rbzts.ts` (fetch and parse), `plan.ts` (what's due this tick), `tick.ts` (one run) |
| `src/api.ts` | JSON endpoints (below) |
| `src/share.ts` | Open Graph tags per request |
| `src/snapshot.ts` | Saved responses for `/api/overview` and `/api/markets` (below) |
| `public/` | The site: `index.html`, `app.js`, `styles.css`, `og.jpg` |
| `design/` | Share-card source (`og-card.html`) and its renderer |
| `migrations/` | D1 schema |
| `research/` | The original Python scraper prototype |
| `test/` | Vitest tests; rbzts HTML fixtures in `test/fixtures/` |

## How the scraper fits the free plan

| Free-plan limit | How we stay under it |
|---|---|
| 50 subrequests per invocation (fetch **and** D1 both count) | Each tick makes at most `FETCH_BUDGET` = 35 fetches, retries included. D1 adds ≤ 11 (2 reads, 1 lease, ≤ 8 writes in one batch). Rows go to D1 as a single JSON param through `json_each`, so a batch is ~8 statements whatever its size. |
| 10 ms CPU per invocation | Regex parsing costs ≈ 0.2 ms per page (`npm test` prints it). View-state parsing is skipped on market pages, and network waits don't count as CPU. |
| 5 cron triggers per account | Uses 1: `*/5 0-10 * * *` (every 5 min, 05:30–16:25 IST). |
| D1: 100k writes / 5M reads per day | Prices are written only when a market's table changes (hash check, plus `ON CONFLICT … WHERE price != excluded.price`). Expect ~1–3k writes per day. Reads: page views are served from saved snapshots (1 row instead of ~1,000; see API). |
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

`/api/*` is rate limited per IP at 300 requests/min (Workers rate-limit binding `API_LIMITER`; approximate and per Cloudflare location). Over the limit gets `429`. It is generous on purpose, because Indian mobile carriers share one IP across many users. Requests it blocks still count toward the Worker's 100k/day; only a firewall rule in front (needs a custom domain) avoids that.

**Snapshots** (`src/snapshot.ts`, table `snapshots`): `/api/overview` (~920 rows to build) and `/api/markets` (~120) are saved as ready-made JSON, so a request reads 1 row. `/api/prices` takes each item's cross-bazar spread from the overview snapshot (~30 rows instead of ~815). A snapshot is rebuilt on the next request after any of these:
- the scraper writes anything (`tick.ts` deletes all snapshots in the same batch);
- the IST date changes;
- 5 minutes pass (a backstop).

It's safe to empty the table at any time.

| Endpoint | Returns |
|---|---|
| `GET /api/markets` | Districts → markets, with `lastReportedDate` |
| `GET /api/overview` | All markets at once: each item's min / max / median across markets' latest tables, and where it's cheapest (the home page) |
| `GET /api/prices?market=<id>` | The market's latest price table, plus `isToday` and each item's cross-market `stats` |
| `GET /api/item?name=<item>` | One item across markets (each market's latest date within 3 days), cheapest first |
| `GET /api/status` | Coverage today and the last 20 scrape runs |

## Link previews (WhatsApp, social)

- `public/index.html` carries Open Graph tags. Because `run_worker_first: ["/"]` is set in `wrangler.jsonc`, the Worker handles `/` before the static file is served. `src/share.ts` then fills in absolute URLs for whatever domain serves the page, and titles `?market=` links after their bazar. A `?market=` link costs one 2-row D1 lookup.
- Untidy rbzts names get a place first: "Opp: Municipal Office" in Adilabad becomes "Adilabad Rythu Bazar (Opp: Municipal Office)". See `bazarLabel`.
- The card is `public/og.jpg`, 1200×630. Keep it under ~300 KB, or WhatsApp may show a small preview or none. WhatsApp shows it at about a third of its size, so keep text large. To change it:

  ```sh
  # edit design/og-card.html, then:
  PLAYWRIGHT=/path/to/node_modules/playwright node design/render-og.mjs
  sips -s format jpeg -s formatOptions 85 public/og.png --out public/og.jpg && rm public/og.png
  ```

  Then bump `?v=` in `OG_IMAGE` (`src/share.ts`) and `public/index.html`. WhatsApp caches previews per image URL.

## Things to watch after the first deploy

- **Migrations before deploys:** apply `npm run db:migrate:remote` before `npm run deploy`. The scraper's write batch touches `snapshots`, so new code against an unmigrated DB would make every tick fail.
- **Upstream reachability:** verified 2026-10-07 — rbzts answers requests from Cloudflare. It does go down: on 8 Oct it timed out from ~10:25 IST for everyone, not just Cloudflare. If every run in `/api/status` starts showing `fatal: … timed out`, it has started blocking.
- **D1 reads:** home page views read ~2 rows (snapshots); a rebuild reads ~1k, at most every 5 minutes. "Latest table per market" comes from `markets.last_reported_date`, not `MAX(date)` over `prices`, so page views don't scan the whole history. Keep it that way; check `meta.rows_read` with `wrangler d1 execute --remote --json` when changing queries.
- **CPU time:** Workers dashboard → Observability shows CPU per invocation. If ticks get close to 10 ms, lower `FETCH_BUDGET`.
- **sslip.io dependency:** if you own a domain on Cloudflare, add a DNS-only A record (e.g. `rbz-origin.example.com → 183.82.5.184`) and point `RBZ_ORIGIN` at it.
