import { istDate, runTick, type ScrapeEnv } from "./scraper/tick";

export interface ApiEnv extends ScrapeEnv {
  ADMIN_TOKEN?: string;
}

const json = (data: unknown, status = 200, maxAge = 120) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": maxAge ? `public, max-age=${maxAge}` : "no-store",
    },
  });

export async function handleApi(req: Request, env: ApiEnv, url: URL): Promise<Response> {
  const path = url.pathname;
  if (req.method === "GET" && path === "/api/markets") return markets(env);
  if (req.method === "GET" && path === "/api/overview") return overview(env);
  if (req.method === "GET" && path === "/api/prices") return prices(env, url);
  if (req.method === "GET" && path === "/api/item") return item(env, url);
  if (req.method === "GET" && path === "/api/status") return status(env);
  if (req.method === "POST" && path === "/api/admin/scrape") return manualScrape(req, env);
  return json({ error: "not found" }, 404, 0);
}

async function markets(env: ApiEnv) {
  const { results } = await env.DB.prepare(
    `SELECT d.id AS districtId, d.name AS district, m.id, m.name,
            m.last_reported_date AS lastReportedDate, m.last_item_count AS itemCount,
            m.last_checked_at AS lastCheckedAt
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
  }>();
  const districts = new Map<number, { id: number; name: string; markets: unknown[] }>();
  for (const { districtId, district, ...m } of results) {
    if (!districts.has(districtId)) districts.set(districtId, { id: districtId, name: district, markets: [] });
    districts.get(districtId)!.markets.push(m);
  }
  return json({ today: istDate(new Date()), districts: [...districts.values()] });
}

async function prices(env: ApiEnv, url: URL) {
  const marketId = Number(url.searchParams.get("market"));
  if (!Number.isInteger(marketId) || marketId <= 0) return json({ error: "market is required" }, 400, 0);

  const market = await env.DB.prepare(
    `SELECT m.id, m.name, d.name AS district, m.last_checked_at AS lastCheckedAt,
            (SELECT MAX(date) FROM prices p WHERE p.market_id = m.id) AS latestDate
       FROM markets m JOIN districts d ON d.id = m.district_id WHERE m.id = ?1`,
  )
    .bind(marketId)
    .first<{ id: number; name: string; district: string; lastCheckedAt: string | null; latestDate: string | null }>();
  if (!market) return json({ error: "unknown market" }, 404, 0);

  const today = istDate(new Date());
  if (!market.latestDate) {
    return json({
      market: { id: market.id, name: market.name, district: market.district, lastCheckedAt: market.lastCheckedAt },
      date: null,
      isToday: false,
      today,
      items: [],
    });
  }

  const [own, spread] = await env.DB.batch([
    env.DB.prepare(
      `SELECT item, price, updated_at AS updatedAt FROM prices
        WHERE market_id = ?1 AND date = ?2 ORDER BY item`,
    ).bind(marketId, market.latestDate),
    env.DB.prepare(
      `${LATEST}
       SELECT p.item, GROUP_CONCAT(p.price) AS prices
         FROM latest l CROSS JOIN prices p ON p.market_id = l.market_id AND p.date = l.date
        GROUP BY p.item`,
    ).bind(windowStart()),
  ]);
  const stats = new Map(
    (spread.results as { item: string; prices: string }[]).map((r) => [r.item, priceStats(r.prices)]),
  );
  const items = (own.results as { item: string; price: number; updatedAt: string }[]).map((i) => ({
    ...i,
    stats: stats.get(i.item) ?? null,
  }));
  return json({
    market: { id: market.id, name: market.name, district: market.district, lastCheckedAt: market.lastCheckedAt },
    date: market.latestDate,
    isToday: market.latestDate === today,
    today,
    items,
  });
}

/**
 * Every active market's latest price table within the window /api/item also uses.
 * Read from markets.last_reported_date (kept by the scraper) rather than MAX(date) over
 * prices: that would scan all of history on every page view and burn D1's free read quota.
 */
const LATEST = `WITH latest AS (
  SELECT id AS market_id, last_reported_date AS date
    FROM markets
   WHERE active = 1 AND last_reported_date >= ?1)`;
const windowStart = () => istDate(new Date(Date.now() - 3 * 86_400_000));

/** All bazars at once: each item's typical price, range and where it's cheapest. */
async function overview(env: ApiEnv) {
  const today = istDate(new Date());
  const [rows, counts] = await env.DB.batch([
    env.DB.prepare(
      `${LATEST}
       SELECT p.item, p.price, m.name AS market
         FROM latest l
        -- CROSS JOIN pins the order: 40 markets, then a primary-key lookup each (no prices scan).
        CROSS JOIN prices p ON p.market_id = l.market_id AND p.date = l.date
         JOIN markets m ON m.id = p.market_id
        ORDER BY p.item, p.price, m.name`,
    ).bind(windowStart()),
    env.DB.prepare(
      `SELECT (SELECT COUNT(*) FROM markets WHERE active = 1) AS markets,
              (SELECT COUNT(*) FROM markets WHERE active = 1 AND last_reported_date = ?1) AS reportedToday,
              (SELECT MAX(last_checked_at) FROM markets WHERE active = 1) AS lastCheckedAt`,
    ).bind(today),
  ]);
  const byItem = new Map<string, { price: number; market: string }[]>();
  for (const r of rows.results as { item: string; price: number; market: string }[]) {
    if (!byItem.has(r.item)) byItem.set(r.item, []);
    byItem.get(r.item)!.push(r);
  }
  const items = [...byItem].map(([item, list]) => {
    const stats = priceStats(list.map((r) => r.price).join(","));
    const cheapest = list.filter((r) => r.price === stats.min).map((r) => r.market);
    return { item, ...stats, cheapest };
  });
  return json({ today, ...(counts.results[0] as object), items });
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
  const [runs, counts] = await env.DB.batch([
    env.DB.prepare("SELECT * FROM scrape_runs ORDER BY id DESC LIMIT 20"),
    env.DB.prepare(
      `SELECT (SELECT COUNT(*) FROM markets WHERE active = 1) AS markets,
              (SELECT COUNT(*) FROM markets WHERE active = 1 AND last_reported_date = ?1) AS reportedToday`,
    ).bind(istDate(new Date())),
  ]);
  return json({ ...(counts.results[0] as object), runs: runs.results }, 200, 0);
}

async function manualScrape(req: Request, env: ApiEnv) {
  if (!env.ADMIN_TOKEN || req.headers.get("Authorization") !== `Bearer ${env.ADMIN_TOKEN}`) {
    return json({ error: "unauthorized" }, 401, 0);
  }
  return json(await runTick(env, "manual"), 200, 0);
}
