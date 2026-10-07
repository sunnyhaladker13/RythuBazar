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

## Andhra Pradesh (researched 2026-10-07, ~20:00 IST)

### TL;DR

- **AP has its own copy of rbzts, `http://117.192.9.10/rbzap/`, but it is down.** It refused connections from Sunny's broadband (curl and Chrome) and from mobile data. The AP Agricultural Marketing Dept links to it as "Click here for Rythu Bazar Prices". From our network, ports 80 and 443 both refused (`Connection refused`), while rbzts answered 200 in the same run. The Wayback Machine has no snapshot of it. It was alive at some point: Tilicho's "Rythu Bazaar" iOS app (last updated Oct 2020) listed "~96 Rytu bazaars in AP and 39 in Telangana" from "a govt portal".
- **The only live per-bazar AP prices are on Digi Rythu Bazaar** (`digirythubazaarap.com`), the AP govt's online Rythu Bazar shop built with Machint Solutions. It covers **15 units**: 12 in Visakhapatnam and 1 each in Vijayawada, Tirupati and Guntur. Each store has its own prices for ~40 vegetables, mostly ₹/kg. These are online-shop prices with no date, not the bazar's daily board.
- **Agmarknet has no AP Rythu Bazars.** It lists 220 AP markets, none of them Rythu Bazars. They are wholesale APMC markets (₹/quintal), ~2 days behind.
- **Recommendation:** no full AP source exists today. The choices are a thin, mostly-Vizag "beta" from Digi Rythu Bazaar, or asking the AP Agricultural Marketing Dept whether rbzap has moved (see "Next step").

### Sources compared

| Source | Coverage | Units | Freshness | Access | Verdict |
|---|---|---|---|---|---|
| **rbzap** (`117.192.9.10/rbzap/`) | AP's ~101 Rythu Bazars (the dept page says 101; 2026 news cites 115–130 incl. counters) | Presumably the same as rbzts (retail ₹/kg) | Presumably same-day | **Down: connection refused** from broadband and mobile (7 Oct 2026) | Primary if it comes back |
| **Digi Rythu Bazaar** (`digirythubazaarap.com`) | 15 units: Vizag 12, Vijayawada (Patamata) 1, Tirupati 1, Guntur (Krishnanagar) 1 | Online sale price. Of 111 items with a unit: 82 kg, 28 piece, 1 bunch | Current only, no date shown | Server-rendered HTML, store picked by cookie; no prices API | Fallback "beta" only |
| Agmarknet 2.0 | 220 AP APMC markets, **0 Rythu Bazars** | Wholesale ₹/quintal | ~2 days behind (a statewide query on 7 Oct returned 12 rows dated 05-10) | Public JSON | Skip |
| CM App (`cmapp.ap.gov.in`) | AMC procurement and farm-gate price monitoring | — | — | Department login + captcha | Skip |
| vegetablemarketprice.com, OneIndia, commodityonline | One statewide figure, or republished Agmarknet | Mixed | Daily | No source given | Skip |
| Visakhapatnam district site | A single PDF of Rythu Bazar prices, dated Aug 2021 | — | Stale | — | Skip |
| Telugu/English news | Occasional articles on price spikes, no daily lists | — | — | — | Skip |

### rbzap details

- Linked from https://vyavasayamarketingshakha.ap.gov.in/agriMrkt/Dashboard/rythu-bazars.html (marquee: "Click here for Rythu Bazar Prices"). The name and path mirror rbzts (`183.82.5.184/rbzts/`), so it is very likely the same ASP.NET app. If it comes back, the existing scraper should need little more than a different base URL and district/market IDs.
- `117.192.x.x` is a BSNL range. The refusal came back in ~30 ms (rbzts took ~130 ms for a full response). A fast refusal could mean the server is down, the port is closed, or something filters our network. Chrome on the same machine also got `ERR_CONNECTION_REFUSED` (7 Oct, 20:20 IST), and so did a phone on mobile data. **Treat it as down.**
- The same page says each bazar's prices are fixed every morning by a committee (the Estate Officer plus 2–3 farmers): **25% above wholesale and 25% below local retail**. That's the same scheme as Telangana, so the numbers would be comparable.

### Second sweep (7 Oct, ~20:25 IST): no other public per-bazar source

- **Older link to rbzap on the Telangana server:** the West Godavari district page links `http://183.82.5.184/rbzap`, the same server as rbzts. It returns 404 (as do `HomePage.aspx` and `Default.aspx`), so it was removed. A hint about the history: rbzts district IDs start at 14 (Mahbubnagar), with the 10 old TG districts at 14–23. That suggests IDs 1–13 were the 13 AP districts when this was one combined system. We did not try to post hidden dropdown values: ASP.NET event validation would reject them, and any AP rows would be years old.
- `market.ap.nic.in` (the old department site) doesn't answer.
- **Official AP apps are internal:** "Agricultural Marketing" (APCFSS, updated Aug 2026) is for market committees and check posts. "Rythu Bazar" (Dreamstep Software Innovations, updated Oct 2022) is "built for employees of Rythubazar in AP": stalls, rent, master data. **If AP still records daily prices digitally, they are probably in a staff system like this, not in public.**
- **Consumer Affairs price monitoring** (`fcainfoweb.nic.in`): the report page needs a captcha. Since Sept 2023 it publishes only state and national averages, no per-centre figures (per CEDA/Ashoka's mirror). Only tomato, onion and potato among vegetables. Not usable per bazar.
- **Agmarknet:** none of the 60 markets named like "bazar" or "RBZ" are in AP. All Rythu Bazar entries are Telangana.
- **Third-party "Vijayawada vegetable prices" pages** (amaravativoice: last updated 2016; goldenchennai, vegetablemarketprice, OneIndia): no stated source, one city-level figure.

### Digi Rythu Bazaar details

- Bazar list: `GET https://digirythubazaarap.com/rb`, or `GET https://drb-api-prod-fbeshza3b0bqf0b6.southindia-01.azurewebsites.net/RB/nearest/{lat}/{lng}`. The latter returns JSON: `id` (GUID), `unitCode` (e.g. `RB-VIZAG-01`), name, address, lat/lng, weekly off day.
- Prices: `GET /Products?category=Vegetables` with cookie `NearestRbId=<id>`. That returns ~1.2 MB of HTML. Each card carries `data-product-name`, `data-category`, `data-farming`, `data-telugu` (Telugu name included), `data-unit` and the price. `/products` on the API host returns 404.
- Prices really do differ per store. On 7 Oct, MVP (Vizag) vs Tirupati: potato 12 vs 28, carrot 40 vs 65, tomato 40 vs 35, onion 50 vs 57.
- **Caveats:** these are shop prices. The govt says they match the bazar's committee price, but we can't verify that. There's no date, so we'd stamp each scrape ourselves (same as rbzts). The ~1.2 MB page per store is heavy for the free plan's 10 ms CPU limit, so fetch one store per tick and use a lean regex. The site has no `robots.txt`. Coverage is mostly Visakhapatnam.

### If we add AP: same Worker + D1, not a separate deploy

- **IDs collide.** `districts.id` and `markets.id` are the raw rbzts dropdown values, and rbzap almost certainly reuses small integers too. Options: add `source TEXT` (`rbzts` | `rbzap` | `digirb`) and give AP rows offset IDs (e.g. +10000), keeping the source's own ID in a separate column. Or make keys `(source, source_id)`. The offset approach keeps every existing query and index unchanged.
- Add `state TEXT NOT NULL DEFAULT 'TG'` to `districts`. The overview and the UI then filter by state: a "Telangana / Andhra Pradesh" switch, with the default state remembered or guessed from location.
- **Separate source modules** (`src/scraper/rbzts.ts`, `rbzap.ts`, `digirb.ts`) behind the same planner, fetch budget and lock. Item names need mapping into the shared item list (Digi uses e.g. "lady finger / bhindi", "ivy gourd"; rbzts uses "Bhendi", "Donda").
- **Budget:** rbzap at ~101 bazars × ~3 requests ≈ 300 fetches per full round, vs ~120 for rbzts. That fits the ~108 cron ticks/day × 35 fetches (≈ 3.8k/day), but each bazar would be refreshed less often. D1 writes ~2.5×, still far under 100k/day. Overview reads grow with market count, so filter by state.

### Next step

1. ~~Check whether rbzap is up from another network~~. Done: down on broadband and on mobile data (7 Oct).
2. Ask the AP Agricultural Marketing Dept (@AMD_AP) whether the Rythu Bazar price portal moved. Meanwhile, decide whether a 15-store Digi Rythu Bazaar "AP beta" is worth building.
3. If both stay unattractive, look at the all-India option (Consumer Affairs retail + Agmarknet).

## Search terms & domain (Google Trends, 2026-10-07)

Telangana, last 5 years, from the Trends explore and widget APIs. All numbers are relative; 0 means too small to register, not literally zero.

- **Head terms are about equal:** "rythu bazar" ≈ 45, "vegetable market" ≈ 51, "mandi price" ≈ 47 (the farmer/wholesale side). "farmers market" 5. Wholesale market names: Bowenpally 30, Monda 14, Gudimalkapur 13.
- **Spelling:** "rythu bazar" by a wide margin. "rythu bazaar", "raithu bazar", "rythubazar", Telugu script (రైతు బజార్, కూరగాయల ధరలు), "kuragayala dharalu", "sabzi/sabji mandi" all ≈ 0.
- **People say "rates", not "prices", and add "today".** Top related queries for "rythu bazar" in TG: "rythu bazar **rates**" 100, "rythu bazar hyderabad" 96, "near me" 62, "kukatpally rythu bazar" 56, "rythu bazar rates today" 55, "today rythu bazar vegetable rates" 32 (rising +80%), "rythu bazar prices today" 29. Head-to-head, "rythu bazar rates" 3 vs "rythu bazar prices" 1. For "vegetable rates" the top query is "vegetable rates today", and "today vegetable rates telugu" is rising.
- **AP searches more than TG** ("rythu bazar": AP 100, Telangana 71). AP's top queries: "rythu bazar rates" 100, "rythu bazar rates today" 68, "rythu bazar vijayawada" 51; "digi rythu bazar" is a breakout.
- **Tomato is the item people search:** "tomato price hyderabad", "today tomato price", "kg tomato price today". "why tomato price increased" is a breakout.
- **SEO implication:** say "Rythu Bazar rates today" in the title and H1. Give each bazar its own page ("Kukatpally Rythu Bazar rates today") and each item its own page ("Tomato price today Hyderabad").

**Domains** (RDAP, 7 Oct): `rythubazar.com` and `rythubazar.in` are taken. Available: `rythubazarrates.{com,in,app}`, `rythubazars.{com,in,app}`, `rythubazar.app`, `rythubazartoday.{com,in}`, `vegetablerates.{com,in}`, `eerojurates.{com,in}`, `bazarrates.{com,in}`. Cloudflare Registrar reportedly doesn't sell `.in`, so buy `.in` elsewhere and point its nameservers at Cloudflare. That's safe for a fresh domain because there are no existing records to copy.

## Sources

- rbzts: http://183.82.5.184/rbzts/
- rbzap (AP, refused): http://117.192.9.10/rbzap/ (linked from https://vyavasayamarketingshakha.ap.gov.in/agriMrkt/Dashboard/rythu-bazars.html)
- Digi Rythu Bazaar AP: https://digirythubazaarap.com/rb · launch coverage: https://www.amazingap.com/2025/12/ap-digi-rythu-bazar-farm-fresh-produce.html
- Tilicho "Rythu Bazaar" app (AP 96 / TG 39 bazars, 2020): https://apps.apple.com/us/app/rythu-bazaar/id1438643204
- AP CM App: https://cmapp.ap.gov.in/
- Agmarknet 2.0: https://agmarknet.gov.in/
- data.gov.in dataset: https://data.gov.in/resource/current-daily-price-various-commodities-various-markets-mandi
- Cloudflare D1 pricing: https://developers.cloudflare.com/d1/platform/pricing/
- D1 free-tier enforcement: https://developers.cloudflare.com/changelog/post/2026-09-01-d1-free-tier-limit-enforcement/
- Workers limits: https://developers.cloudflare.com/workers/platform/limits/
- Cloudflare error 1003: https://developers.cloudflare.com/support/troubleshooting/http-status-codes/cloudflare-1xxx-errors/error-1003
