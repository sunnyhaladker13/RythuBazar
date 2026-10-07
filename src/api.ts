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

  const items = market.latestDate
    ? (
        await env.DB.prepare(
          `SELECT item, price, updated_at AS updatedAt FROM prices
            WHERE market_id = ?1 AND date = ?2 ORDER BY item`,
        )
          .bind(marketId, market.latestDate)
          .all<{ item: string; price: number; updatedAt: string }>()
      ).results
    : [];
  const today = istDate(new Date());
  return json({
    market: { id: market.id, name: market.name, district: market.district, lastCheckedAt: market.lastCheckedAt },
    date: market.latestDate,
    isToday: market.latestDate === today,
    today,
    items,
  });
}

/** One item across all markets, using each market's latest date within the last 3 days. */
async function item(env: ApiEnv, url: URL) {
  const name = url.searchParams.get("name")?.trim();
  if (!name) return json({ error: "name is required" }, 400, 0);
  const since = istDate(new Date(Date.now() - 3 * 86_400_000));
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
