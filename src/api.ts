import { istDate, runTick, type ScrapeEnv } from "./scraper/tick";
import { ITEMS, describe } from "./items";
import { withSlugs } from "./branches";
import { snapshot } from "./snapshot";

/** An item's display labels, for the page (no `known`: that's for /api/status). */
const labels = (item: string) => {
  const { en, te, color } = describe(item);
  return { en, te, color };
};

export interface ApiEnv extends ScrapeEnv {
  ADMIN_TOKEN?: string;
}

const respond = (body: string, status = 200, maxAge = 120) =>
  new Response(body, {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": maxAge ? `public, max-age=${maxAge}` : "no-store",
    },
  });
const json = (data: unknown, status = 200, maxAge = 120) => respond(JSON.stringify(data), status, maxAge);

// What the pages (src/site.ts) and the busiest endpoints show is served from snapshots (src/snapshot.ts).
export const overviewBody = (env: ApiEnv) => snapshot(env.DB, "overview", () => buildOverview(env));
export const marketsBody = (env: ApiEnv) => snapshot(env.DB, "markets", () => buildMarkets(env));
/** One branch's latest table; check the id exists first (marketsBody) so junk ids don't fill the table. */
export const pricesBody = (env: ApiEnv, id: number) => snapshot(env.DB, `prices:${id}`, () => buildPrices(env, id));

export async function handleApi(req: Request, env: ApiEnv, url: URL): Promise<Response> {
  const path = url.pathname;
  if (req.method === "GET" && path === "/api/markets") return respond(await marketsBody(env));
  if (req.method === "GET" && path === "/api/overview") return respond(await overviewBody(env));
  if (req.method === "GET" && path === "/api/prices") return prices(env, url);
  if (req.method === "GET" && path === "/api/item") return item(env, url);
  if (req.method === "GET" && path === "/api/history") return history(env, url);
  if (req.method === "GET" && path === "/api/last") return last(env, url);
  if (req.method === "GET" && path === "/api/status") return status(env);
  if (req.method === "POST" && path === "/api/admin/scrape") return manualScrape(req, env);
  return json({ error: "not found" }, 404, 0);
}

export type Markets = Awaited<ReturnType<typeof buildMarkets>>;
export type Market = Markets["districts"][number]["markets"][number] & { district: string; districtId: number };

/** Every branch with its district, in district then name order. */
export const flatMarkets = (data: Markets): Market[] =>
  data.districts.flatMap((d) => d.markets.map((m) => ({ ...m, district: d.name, districtId: d.id })));

async function buildMarkets(env: ApiEnv) {
  const { results } = await env.DB.prepare(
    `SELECT d.id AS districtId, d.name AS district, m.id, m.name,
            m.last_reported_date AS lastReportedDate, m.last_item_count AS itemCount,
            m.last_checked_at AS lastCheckedAt, m.lat, m.lng
       FROM markets m JOIN districts d ON d.id = m.district_id
      WHERE m.active = 1
      ORDER BY d.name, m.name`,
  ).all<{
    districtId: number;
    district: string;
    id: number;
    name: string;
    lastReportedDate: string | null;
    itemCount: number;
    lastCheckedAt: string | null;
    lat: number | null;
    lng: number | null;
  }>();
  type Row = Omit<(typeof results)[number], "districtId" | "district"> & { slug: string };
  const districts = new Map<number, { id: number; name: string; markets: Row[] }>();
  for (const { districtId, district, ...m } of withSlugs(results)) {
    if (!districts.has(districtId)) districts.set(districtId, { id: districtId, name: district, markets: [] });
    districts.get(districtId)!.markets.push(m);
  }
  return { today: istDate(new Date()), districts: [...districts.values()] };
}

async function prices(env: ApiEnv, url: URL) {
  const marketId = Number(url.searchParams.get("market"));
  if (!Number.isInteger(marketId) || marketId <= 0) return json({ error: "market is required" }, 400, 0);
  const known = flatMarkets(JSON.parse(await marketsBody(env)) as Markets).some((m) => m.id === marketId);
  if (!known) return json({ error: "unknown market" }, 404, 0);
  return respond(await pricesBody(env, marketId));
}

export type Prices = NonNullable<Awaited<ReturnType<typeof buildPrices>>>;

/** One branch's latest table, each item against its spread across branches, and its biggest moves. */
async function buildPrices(env: ApiEnv, marketId: number) {
  const market = await env.DB.prepare(
    `SELECT m.id, m.name, d.name AS district, m.last_checked_at AS lastCheckedAt,
            (SELECT MAX(date) FROM prices p WHERE p.market_id = m.id) AS latestDate
       FROM markets m JOIN districts d ON d.id = m.district_id WHERE m.id = ?1`,
  )
    .bind(marketId)
    .first<{ id: number; name: string; district: string; lastCheckedAt: string | null; latestDate: string | null }>();
  if (!market) return null;

  const today = istDate(new Date());
  if (!market.latestDate) {
    return {
      market: { id: market.id, name: market.name, district: market.district, lastCheckedAt: market.lastCheckedAt },
      date: null,
      isToday: false,
      today,
      updatedAt: null,
      items: [],
      changes: [],
      movers: [],
    };
  }

  const [own, before, recent, overviewJson] = await Promise.all([
    env.DB.prepare(
      `SELECT item, price, updated_at AS updatedAt FROM prices
        WHERE market_id = ?1 AND date = ?2 ORDER BY item`,
    )
      .bind(marketId, market.latestDate)
      .all<{ item: string; price: number; updatedAt: string }>(),
    // The day before its latest table, for "biggest moves" (primary-key range, ~25 rows).
    env.DB.prepare(`SELECT item, price FROM prices WHERE market_id = ?1 AND date = date(?2, '-1 day')`)
      .bind(marketId, market.latestDate)
      .all<{ item: string; price: number }>(),
    // This bazar's own last week, for the trend lines (primary-key range, ~175 rows).
    env.DB.prepare(`SELECT item, date, price FROM prices WHERE market_id = ?1 AND date >= ?2 ORDER BY item, date`)
      .bind(marketId, daysAgo(TREND_DAYS - 1))
      .all<{ item: string; date: string; price: number }>(),
    // Each item's spread across bazars is exactly what the overview already computes.
    overviewBody(env),
  ]);
  // Each item's spread across bazars, compared only with a table from the same day as the board.
  const board = JSON.parse(overviewJson) as Overview;
  const stats = new Map<string, { min: number; max: number; median: number; markets: number }>(
    board.date === market.latestDate
      ? board.items.map(({ item, min, max, median, markets }) => [item, { min, max, median, markets }])
      : [],
  );
  const trends = new Map<string, number[]>();
  for (const r of recent.results) {
    if (!trends.has(r.item)) trends.set(r.item, []);
    trends.get(r.item)!.push(r.price);
  }
  const items = own.results.map((i) => ({
    ...i,
    ...labels(i.item),
    stats: stats.get(i.item) ?? null,
    trend: trends.get(i.item) ?? [],
  }));
  const changes = movers(
    own.results.map((r) => ({ marketId, ...r })),
    before.results.map((r) => ({ marketId, ...r })),
    1,
    Infinity,
  );
  return {
    market: { id: market.id, name: market.name, district: market.district, lastCheckedAt: market.lastCheckedAt },
    date: market.latestDate as string | null,
    isToday: market.latestDate === today,
    today,
    // When this table's rates last appeared or changed.
    updatedAt: own.results.reduce<string | null>((t, r) => (!t || r.updatedAt > t ? r.updatedAt : t), null),
    items,
    changes,
    movers: changes.slice(0, 3),
  };
}

/**
 * Every active market's latest price table within the window /api/item also uses.
 * Read from markets.last_reported_date (kept by the scraper) rather than MAX(date) over
 * prices: that would scan all of history on every page view and burn D1's free read quota.
 */
export const LATEST = `WITH latest AS (
  SELECT id AS market_id, last_reported_date AS date
    FROM markets
   WHERE active = 1 AND last_reported_date >= ?1)`;
export const windowStart = () => istDate(new Date(Date.now() - 3 * 86_400_000));

/**
 * Fewest branches that make a day worth showing on the all-branches board. Until today has this many,
 * the board shows the last day that did (usually yesterday), so its rates are always from one day.
 */
export const MIN_BOARD_BRANCHES = 6;

/**
 * The day the all-branches board shows: today once enough branches have posted, else the latest
 * earlier day that had enough. If none did, the busiest day, today included; null when nobody posted.
 */
export function boardDay(today: string, postedToday: number, earlier: { date: string; markets: number }[]): string | null {
  if (postedToday >= MIN_BOARD_BRANCHES) return today;
  const days = earlier.filter((d) => d.date < today).sort((a, b) => b.date.localeCompare(a.date));
  const full = days.find((d) => d.markets >= MIN_BOARD_BRANCHES);
  if (full) return full.date;
  const busiest = days.reduce((a, b) => (b.markets > a.markets ? b : a), { date: today, markets: postedToday });
  return busiest.markets ? busiest.date : null;
}

export type Overview = Awaited<ReturnType<typeof buildOverview>>;

/** All bazars at once, from one day's tables (boardDay): each item's price range, median and where it's cheapest. */
async function buildOverview(env: ApiEnv) {
  const today = istDate(new Date());
  const [counts, daily] = await env.DB.batch([
    env.DB.prepare(
      `SELECT (SELECT COUNT(*) FROM markets WHERE active = 1) AS markets,
              (SELECT COUNT(*) FROM markets WHERE active = 1 AND last_reported_date = ?1) AS reportedToday,
              (SELECT MAX(last_checked_at) FROM markets WHERE active = 1) AS lastCheckedAt`,
    ).bind(today),
    // ~28 items x 7 days of ready-made daily stats, for the trend lines and how many branches posted each day.
    env.DB.prepare(`SELECT item, date, median, markets FROM daily_stats WHERE date >= ?1 ORDER BY item, date`).bind(
      daysAgo(TREND_DAYS - 1),
    ),
  ]);
  const { markets, reportedToday, lastCheckedAt } = counts.results[0] as {
    markets: number;
    reportedToday: number;
    lastCheckedAt: string | null;
  };
  // Branches that posted on a day = the most that posted any one item that day.
  const perDay = new Map<string, number>();
  for (const r of daily.results as DayStat[]) perDay.set(r.date, Math.max(perDay.get(r.date) ?? 0, r.markets));
  const date = boardDay(
    today,
    reportedToday,
    [...perDay].map(([date, markets]) => ({ date, markets })),
  );

  type Row = { marketId: number; item: string; price: number; market: string };
  let rows: Row[] = [];
  let before: Row[] = [];
  if (date) {
    const [own, prev] = await env.DB.batch([
      env.DB.prepare(
        `SELECT p.market_id AS marketId, p.item, p.price, m.name AS market
           FROM markets m
          -- CROSS JOIN pins the order: 40 markets, then a primary-key lookup each (no prices scan).
          CROSS JOIN prices p ON p.market_id = m.id AND p.date = ?1
          WHERE m.active = 1
          ORDER BY p.item, p.price, m.name`,
      ).bind(date),
      // Each market's table from the day before, for "biggest moves".
      env.DB.prepare(
        `SELECT p.market_id AS marketId, p.item, p.price
           FROM markets m
          CROSS JOIN prices p ON p.market_id = m.id AND p.date = date(?1, '-1 day')
          WHERE m.active = 1`,
      ).bind(date),
    ]);
    rows = own.results as Row[];
    before = prev.results as Row[];
  }

  // Trend lines end on the board's day, so they never run past the rates beside them.
  const trends = new Map<string, DayStat[]>();
  for (const r of daily.results as DayStat[]) {
    if (!date || r.date > date) continue;
    if (!trends.has(r.item)) trends.set(r.item, []);
    trends.get(r.item)!.push(r);
  }
  const byItem = new Map<string, Row[]>();
  for (const r of rows) {
    if (!byItem.has(r.item)) byItem.set(r.item, []);
    byItem.get(r.item)!.push(r);
  }
  const items = [...byItem].map(([item, list]) => {
    const stats = priceStats(list.map((r) => r.price).join(","));
    const cheapest: string[] = list.filter((r) => r.price === stats.min).map((r) => r.market);
    return { item, ...labels(item), ...stats, cheapest, trend: usableDays(trends.get(item) ?? [], today).map((d) => d.median) };
  });
  const changes = movers(rows, before, MIN_MOVER_BAZARS, Infinity);
  // Listed vegetables not on the board's day, so search can still offer their last price.
  const seen = new Set(items.map((i) => i.item));
  const missing = Object.keys(ITEMS)
    .filter((item) => !seen.has(item))
    .map((item) => ({ item, ...labels(item) }));
  return { today, date, markets, reportedToday, lastCheckedAt, items, changes, movers: changes.slice(0, 3), missing };
}

const TREND_DAYS = 7;
const daysAgo = (n: number) => istDate(new Date(Date.now() - n * 86_400_000));

export type DayStat = { item: string; date: string; median: number; min?: number; max?: number; markets: number };

/**
 * Days whose typical price means something: at least 3 bazars. Today is still filling in
 * through the morning, so it also needs half as many bazars as the day before; otherwise
 * the first few bazars to post would swing the line.
 */
export function usableDays<T extends { date: string; markets: number }>(days: T[], today: string): T[] {
  const ok = days.filter((d) => d.markets >= 3);
  const last = ok[ok.length - 1];
  const prev = ok[ok.length - 2];
  if (last?.date === today && prev && last.markets * 2 < prev.markets) ok.pop();
  return ok;
}

/** An item's most recent day on record, however old or thin: for search hits not reported lately. */
async function last(env: ApiEnv, url: URL) {
  const name = url.searchParams.get("name")?.trim();
  if (!name) return json({ error: "name is required" }, 400, 0);
  const day = await env.DB.prepare(
    `SELECT date, median, min, max, markets FROM daily_stats WHERE item = ?1 ORDER BY date DESC LIMIT 1`,
  )
    .bind(name)
    .first();
  return json({ item: name, day: day ?? null });
}

/** One item's typical price and lowest–highest bazar per day, for the item chart. */
async function history(env: ApiEnv, url: URL) {
  const name = url.searchParams.get("name")?.trim();
  if (!name) return json({ error: "name is required" }, 400, 0);
  const days = Math.min(Math.max(Number(url.searchParams.get("days")) || 30, 2), 90);
  const { results } = await env.DB.prepare(
    `SELECT date, median, min, max, markets FROM daily_stats WHERE item = ?1 AND date >= ?2 ORDER BY date`,
  )
    .bind(name, daysAgo(days - 1))
    .all<DayStat>();
  return json({ item: name, days: usableDays(results, istDate(new Date())) });
}

type Rate = { marketId: number; item: string; price: number };
/** An item counts as moving across bazars only when at least this many bazars have both days. */
const MIN_MOVER_BAZARS = 3;

/**
 * The items whose price changed most from one day to the next, biggest relative change first.
 * Each bazar's change is its latest rate minus its rate the day before; an item's change is the
 * median of those (so one bazar's typo can't top the board), and `pct` is against the median
 * earlier rate of the same bazars. Items with no change are left out.
 */
export function movers(latest: Rate[], before: Rate[], minBazars: number, limit = 3) {
  const prev = new Map(before.map((r) => [`${r.marketId}|${r.item}`, r.price]));
  const pairs = new Map<string, { diffs: number[]; olds: number[] }>();
  for (const r of latest) {
    const old = prev.get(`${r.marketId}|${r.item}`);
    if (old === undefined) continue;
    if (!pairs.has(r.item)) pairs.set(r.item, { diffs: [], olds: [] });
    const p = pairs.get(r.item)!;
    p.diffs.push(r.price - old);
    p.olds.push(old);
  }
  const median = (xs: number[]) => {
    const s = [...xs].sort((a, b) => a - b);
    const mid = s.length >> 1;
    return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
  };
  return [...pairs]
    .filter(([, p]) => p.diffs.length >= minBazars)
    .map(([item, p]) => {
      const change = median(p.diffs);
      const base = median(p.olds);
      return { item, change, pct: base ? Math.round((change / base) * 100) : 0, bazars: p.diffs.length };
    })
    .filter((m) => m.change !== 0)
    .sort((a, b) => Math.abs(b.pct) - Math.abs(a.pct) || Math.abs(b.change) - Math.abs(a.change))
    .slice(0, limit);
}

/** Spread of one item's price across markets, from a GROUP_CONCAT list. */
export function priceStats(csv: string) {
  const ps = csv
    .split(",")
    .map(Number)
    .sort((a, b) => a - b);
  const mid = ps.length >> 1;
  const median = ps.length % 2 ? ps[mid] : (ps[mid - 1] + ps[mid]) / 2;
  return { min: ps[0], max: ps[ps.length - 1], median, markets: ps.length };
}

/** One item across all markets, using each market's latest date within the last 3 days. */
async function item(env: ApiEnv, url: URL) {
  const name = url.searchParams.get("name")?.trim();
  if (!name) return json({ error: "name is required" }, 400, 0);
  const since = windowStart();
  const { results } = await env.DB.prepare(
    `SELECT p.market_id AS marketId, m.name AS market, d.name AS district, p.date, p.price
       FROM prices p
       JOIN markets m ON m.id = p.market_id AND m.active = 1
       JOIN districts d ON d.id = m.district_id
      WHERE p.item = ?1 AND p.date >= ?2
        AND p.date = (SELECT MAX(date) FROM prices q WHERE q.market_id = p.market_id AND q.date >= ?2)
      ORDER BY p.price, m.name`,
  )
    .bind(name, since)
    .all();
  return json({ item: name, today: istDate(new Date()), markets: results });
}

async function status(env: ApiEnv) {
  const [runs, counts, items, markets] = await env.DB.batch([
    env.DB.prepare("SELECT * FROM scrape_runs ORDER BY id DESC LIMIT 20"),
    env.DB.prepare(
      `SELECT (SELECT COUNT(*) FROM markets WHERE active = 1) AS markets,
              (SELECT COUNT(*) FROM markets WHERE active = 1 AND last_reported_date = ?1) AS reportedToday`,
    ).bind(istDate(new Date())),
    env.DB.prepare(
      `SELECT item, MIN(date) AS firstSeen, MAX(date) AS lastSeen, MAX(markets) AS bazars
         FROM daily_stats WHERE date >= ?1 GROUP BY item`,
    ).bind(daysAgo(29)),
    env.DB.prepare("SELECT id, name FROM markets WHERE active = 1 AND lat IS NULL"),
  ]);
  // Names seen in the last 30 days that src/items.ts can't label: add them there.
  const unknownItems = (items.results as { item: string }[]).filter((r) => !describe(r.item).known);
  // Branches "near me" can't place: set markets.lat/lng (migrations/0004_market_geo.sql).
  return json({ ...(counts.results[0] as object), unknownItems, unlocatedMarkets: markets.results, runs: runs.results }, 200, 0);
}

async function manualScrape(req: Request, env: ApiEnv) {
  if (!env.ADMIN_TOKEN || req.headers.get("Authorization") !== `Bearer ${env.ADMIN_TOKEN}`) {
    return json({ error: "unauthorized" }, 401, 0);
  }
  return json(await runTick(env, "manual"), 200, 0);
}
