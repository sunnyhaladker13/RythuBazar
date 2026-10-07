# Rythu Bazar Prices — Data Source Research

_Researched 2026-10-07 (Wed), ~11:00–11:30 IST._

## TL;DR

- **The only real source is the Telangana Rythu Bazar Information System: `http://183.82.5.184/rbzts/`** (Agricultural Marketing Dept). There is no API, so we have to scrape it.
- Agmarknet and data.gov.in carry only a tiny, delayed copy of the same numbers. They're useful for cross-checking, not as the main source.
- Plan: a **scheduled scraper → our DB → the website reads only from the DB**. Never send a user's request through to rbzts live.

## Sources compared

| Source | Coverage | Units | Freshness | Access | Verdict |
|---|---|---|---|---|---|
| **rbzts** (`183.82.5.184/rbzts/HomePage.aspx`) | 40 Rythu Bazars in 18 districts, ~20–27 items each (29 distinct items) | Retail ₹/kg ("Our Rate") | Same day; markets report by **1:00 PM** | Scrape an ASP.NET WebForms page | **Primary** |
| **Agmarknet 2.0 API** (`https://api.agmarknet.gov.in/v1/`) | Only 7 Telangana RBZs; only Onion/Potato/Tomato | Wholesale ₹/quintal | ~2 days behind (on 10-07 it returned data from 05-10) | Public JSON, no key | Fallback / cross-check |
| **data.gov.in** "Current Daily Price… (Mandi)" | Same Agmarknet data | ₹/quintal | Same lag | Needs an API key; `api.data.gov.in` refused connections from here | Skip |
| NaPanta, KisanDeals, acrop.app | Republish Agmarknet | ₹/quintal | Same lag | No API | Skip |

**Agmarknet copies its numbers from rbzts.** Mehdipatnam on rbzts: Tomato 31, Potato 17, Onion 40 (₹/kg). Agmarknet for the Hyderabad RBZs: 3100 / 1700 / 4000 (₹/quintal). They're the same numbers ×100, just later.

## rbzts — how it works

- Old ASP.NET WebForms page (IIS, .NET 2.0), **plain HTTP on a bare IP**.
- **Only the home page works.** Every report page (`DailyPrices.aspx`, `mmm.aspx`, `ReportBetweenDates.aspx`, `RythuBazarList.aspx`, …) returns 404, and the footer says "Website under Maintenance". **There's no history to pull, so we have to build our own from daily snapshots.**
- Scrape flow (3 requests per market):
  1. `GET HomePage.aspx` → read the hidden fields `__VIEWSTATE`, `__EVENTVALIDATION`, `__VIEWSTATEGENERATOR`, `__PREVIOUSPAGE`
  2. `POST` with `__EVENTTARGET=ctl00$ContentPlaceHolder1$ddlDist` and `ctl00$ContentPlaceHolder1$ddlDist=<districtId>` → the response fills the `ddlRbz` options
  3. `POST` with `__EVENTTARGET=ctl00$ContentPlaceHolder1$ddlRbz` plus both dropdown values → the price table `#ctl00_ContentPlaceHolder1_GridView1` (columns: Vegetable, Our Rate, e.g. `31/-`)
- A full crawl takes **~75 requests**. It took ~7 min with 1 s throttling and hit 5 timeouts in one run, so the server is flaky.
- **Prices fill in during the day.** At ~11:20 IST only **12 of 40** markets had data; Erragadda and Kukatpally were still empty. The table doesn't show which date the prices are for, so we must timestamp each scrape ourselves and keep the last good value.
- Working prototype: [`research/scrape_rbzts.py`](research/scrape_rbzts.py) (writes `rbzts_snapshot.json`).

### District IDs (`ddlDist`)

Adilabad 19, Badradri (Kothagudem) 43, Hyderabad 16, Jagityal 35, Jaishankar (Bhoopalapalli) 37, Jangaon 38, Jogulamba (Gadwal) 31, Kamareddy 44, Karimnagar 20, Khammam 22, Komarambheem (Asifabad) 25, Mahabubabad 40, Mahbubnagar 14, Mancherial 24, Medak 17, Medchal (Malkajgiri) 28, Mulugu 45, Nagarkurnool 29, Nalgonda 23, Narayanpet 46, Nirmal 26, Nizamabad 18, Peddapalli 36, Rajanna (Sircilla) 34, Rangareddy 15, Sanga Reddy 32, Siddipet 33, Suryapet 41, Vikarabad 27, Wanaparthy 30, Warangal 21, Warangal Rural 39, Yadadri (Bhongir) 42.

Hyderabad markets (`ddlRbz`): Mehdipatnam 83, Falaknama 90, Erragadda 91.

### Coverage snapshot (2026-10-07 ~11:20 IST, item count)

| District / Market | Items | District / Market | Items |
|---|---|---|---|
| Adilabad / Opp: Municipal Office | 0 | Nagarkurnool / Nagarkurnool | 0 |
| Badradri / Kothagudem (P. Stdm) | 23 | Nalgonda / Ursu Premises | 0 |
| Badradri / Palvancha | 0 | Nalgonda / Miryalaguda (NSP Camp) | 15 |
| Hyderabad / Mehdipatnam | 26 | Nalgonda / Beet Market, Hyd Road | 0 |
| Hyderabad / Falaknama | 0 | Narayanpet / Narayanpet | 0 |
| Hyderabad / Erragadda | 0 | Nizamabad / Pullanga X Road | 0 |
| Karimnagar / Weekly Market Area | 0 | Nizamabad / NGOs Colony | 0 |
| Karimnagar / Kashmir Gadda Area | 0 | Rangareddy / Saroornagar | 26 |
| Khammam / Pavilian Ground | 22 | Rangareddy / Vanasthalipuram | 26 |
| Khammam / Sathupally (Ramalayam) | 22 | Rangareddy / Chevella | 0 |
| Khammam / Yellandu | 25 | Sanga Reddy / Jogipet | 0 |
| Khammam / Madhira | 0 | Sanga Reddy / Narayankhed | 0 |
| Khammam / III Town | 0 | Siddipet / Siddipet Town | 22 |
| Mahbubnagar / Near Rly. Gate | 0 | Suryapet / Kodad | 0 |
| Mahbubnagar / Badepally | 0 | Suryapet / Suryapet | 0 |
| Medak / Medak Town | 0 | Vikarabad / Vikarabad | 0 |
| Medchal / Kukatpally | 0 | Warangal / Excise Colony | 0 |
| Medchal / Alwal | 25 | Warangal / Laxmipuram (M.Y.) | 0 |
| Medchal / Ramakrishnapuram | 19 | Yadadri / Bhongir | 0 |
| Medchal / Medchal | 0 | | |
| Medchal / Yellammabanda | 25 | | |

**Still unknown:** whether the empty markets fill in after the 1 PM deadline or some never report. Re-run the crawl after ~2 PM to find out.

Items seen: Aratikaya, Beet Root, Bhendi, Bitter Gourd, Bottle Gourd, Brinjal, Cabbage, Carrot, Cauliflower, Cluster Beans, Colocasia (Chama), Cucumber, Donda, Field Beans, French Beans, Green Chillies, Kanda, Keera, Leafy Vegetables, Mulagakada, Onions-I, Onions-II, Potato, Ribbed Gourd, Rice, Snake Gourd, Tomato, Tomato-618.

## Agmarknet 2.0 API (fallback)

No auth. The endpoints come from the portal's JS bundle; they're undocumented and could change.

- Filter metadata (states, districts, markets, commodities):
  `GET https://api.agmarknet.gov.in/v1/dashboard-filters/?dashboard_name=marketwise_price_arrival`
  Telangana `state_id=32`, Hyderabad `district_id=566`.
- Telangana RBZ market IDs: Erragadda 3321, Falaknuma 1199, Mehdipatnam 3332, Adilabad 3317, Mahabubnagar 3327, Miryalguda 3329, Siddipet 3328.
- Prices:
  ```
  POST https://api.agmarknet.gov.in/v1/dashboard-data/
  Content-Type: application/json
  {"dashboard":"marketwise_price_arrival","date":"2026-10-07","group":[100000],
   "commodity":[100001],"state":32,"district":[566],"market":[3321,3332,1199],
   "page":1,"limit":50,"format":"json"}
  ```
  Returns `as_on_price`, `one_day_ago_price`, `two_day_ago_price`, arrivals and `reported_date`. Prices are ₹/quintal.

## Hosting & DB options

### Cloudflare (free plan)

**Yes, it includes a DB: D1** (serverless SQLite).

| Free limit | Value | Our need |
|---|---|---|
| D1 storage | 5 GB total | Tiny. ~1k price rows/day ≈ a few MB/year |
| D1 rows written | 100k/day | ~40 markets × ~25 items × ~10 scrapes ≈ 10k/day (less if we write only on change) |
| D1 rows read | 5M/day (hard-enforced since 2026-09-01) | Fine with indexes plus edge caching |
| Workers requests | 100k/day | Fine |
| Cron Triggers | 5 per account | Enough |
| **Subrequests** | **50 per invocation** | **A full crawl is ~75 requests, so it has to be split across cron runs or batched by district** |
| **CPU time** | **10 ms per invocation** | Network waits don't count, but parsing ~45 KB ASP.NET pages ×25 may come close, so keep parsing lean |

**Possible blocker (not yet tested):** Cloudflare has historically blocked Workers `fetch()` calls to a **bare IP** URL (error 1003), and rbzts has no domain name. Test this with a one-line Worker before committing. If it fails, run the scraper in **GitHub Actions** (free cron, no time limits, Python scraper as-is) and have it write to D1 through Cloudflare's REST API. Cloudflare Pages/Workers then serves the site from D1.

### Vercel (Hobby, the original plan)

- On Hobby, cron jobs run **only once per day**, which isn't enough for prices that fill in through the morning. Function time limits also make a 4–7 min crawl awkward.
- The DB would come through the Marketplace (e.g. Neon free Postgres).
- Works if the scraper runs elsewhere (GitHub Actions) and Vercel only hosts the site.

### Decision (2026-10-07)

**We went all-Cloudflare.** The scraper runs as a Worker cron, chunked to fit the free-plan limits, and reaches the bare IP through `183-82-5-184.sslip.io` (IIS accepts any Host; verified). See [README.md](README.md#how-the-scraper-fits-the-free-plan). The original recommendation below stays the fallback if Cloudflare egress turns out to be blocked by rbzts.

### Original recommendation

The scraper's location matters more than the host:

1. **Scraper: GitHub Actions cron**, every 30–60 min from 08:00 to 15:00 IST. Reasons: no subrequest or CPU limits, the Python prototype already works, and the bare-IP problem doesn't apply.
2. **DB: Cloudflare D1** (free and generous) **or Neon** (free Postgres).
3. **Site: Cloudflare Pages/Workers + D1** (the most generous free tier, all in one place) **or Vercel + Neon**.
4. Save a snapshot on every scrape (`market, item, price, scraped_at`). Show "last updated" per market, keep the last good value, and build history and trends over time.
5. Risk: rbzts may block datacenter or non-Indian IPs. GitHub runners are in the US. Test early; if it's blocked, use a self-hosted runner or an Indian-region host.

## Sources

- rbzts: http://183.82.5.184/rbzts/
- Agmarknet 2.0: https://agmarknet.gov.in/
- data.gov.in dataset: https://data.gov.in/resource/current-daily-price-various-commodities-various-markets-mandi
- Cloudflare D1 pricing: https://developers.cloudflare.com/d1/platform/pricing/
- D1 free-tier enforcement: https://developers.cloudflare.com/changelog/post/2026-09-01-d1-free-tier-limit-enforcement/
- Workers limits: https://developers.cloudflare.com/workers/platform/limits/
- Cloudflare error 1003: https://developers.cloudflare.com/support/troubleshooting/http-status-codes/cloudflare-1xxx-errors/error-1003
