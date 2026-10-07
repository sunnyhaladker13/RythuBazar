// One scrape tick: read state (2 queries) → take a lease (1) → fetch due pages
// (≤ FETCH_BUDGET) → write results in one batch (≤ 8 statements, rows passed as JSON
// via json_each). Stays under the Workers Free limits: 50 subrequests and 10 ms CPU.

import { planTick, type DistrictState, type MarketState, type PlanConfig } from "./plan";
import {
  BudgetExceeded,
  DISTRICT_FIELD,
  MARKET_FIELD,
  RbztsClient,
  parsePriceTable,
  parseReportedDate,
  parseSelectOptions,
  type Option,
  type PriceRow,
} from "./rbzts";

export interface ScrapeEnv {
  DB: D1Database;
  RBZ_ORIGIN: string;
  FETCH_BUDGET?: string;
  REQUEST_DELAY_MS?: string;
  ACTIVE_INTERVAL_MIN?: string;
  RECHECK_INTERVAL_MIN?: string;
  DISCOVERY_INTERVAL_MIN?: string;
}

export interface TickSummary {
  skipped: boolean;
  districts: number;
  markets: number;
  reported: number;
  priceRows: number;
  fetches: number;
  budgetHit: boolean;
  errors: string[];
}

interface MarketResult {
  id: number;
  reportedDate?: string;
  itemCount?: number;
  hash?: string;
}

interface DistrictResult {
  id: number;
  marketCount: number;
  attemptAt: string | null; // null when the tick ran out of budget mid-district
  error: string | null;
}

export function istDate(now: Date): string {
  return new Date(now.getTime() + 330 * 60_000).toISOString().slice(0, 10);
}

/** FNV-1a over the sorted table; detects unchanged tables without async crypto. */
export function hashRows(rows: PriceRow[]): string {
  const s = rows
    .map((r) => `${r.item}=${r.price}`)
    .sort()
    .join("|");
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16);
}

const num = (v: string | undefined, fallback: number) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

export async function runTick(env: ScrapeEnv, trigger: "cron" | "manual", now = new Date()): Promise<TickSummary> {
  const startedAt = now.toISOString();
  const today = istDate(now);
  const fetchBudget = num(env.FETCH_BUDGET, 35);
  const cfg: PlanConfig = {
    activeIntervalMin: num(env.ACTIVE_INTERVAL_MIN, 30),
    recheckIntervalMin: num(env.RECHECK_INTERVAL_MIN, 180),
    discoveryIntervalMin: num(env.DISCOVERY_INTERVAL_MIN, 1440),
    budget: fetchBudget - 1, // home page
  };

  const [dRes, mRes] = await env.DB.batch([
    env.DB.prepare(
      "SELECT id, name, market_count AS marketCount, last_attempt_at AS lastAttemptAt FROM districts",
    ),
    env.DB.prepare(
      `SELECT id, district_id AS districtId, name, last_checked_at AS lastCheckedAt,
              last_reported_date AS lastReportedDate, last_hash AS lastHash
         FROM markets WHERE active = 1`,
    ),
  ]);
  let districts = dRes.results as unknown as DistrictState[];
  const markets = mRes.results as unknown as MarketState[];

  let plan = planTick(districts, markets, today, now, cfg);
  const summary: TickSummary = {
    skipped: false,
    districts: 0,
    markets: 0,
    reported: 0,
    priceRows: 0,
    fetches: 0,
    budgetHit: false,
    errors: [],
  };
  if (districts.length && !plan.length) return { ...summary, skipped: true };

  const nowIso = now.toISOString();
  const leaseUntil = new Date(now.getTime() + 14 * 60_000).toISOString();
  const lease = await env.DB.prepare(
    "UPDATE scrape_lock SET until = ?1 WHERE id = 1 AND until < ?2 RETURNING until",
  )
    .bind(leaseUntil, nowIso)
    .first();
  if (!lease) return { ...summary, skipped: true }; // another tick is still running

  const client = new RbztsClient({
    origin: env.RBZ_ORIGIN,
    maxFetches: fetchBudget,
    delayMs: num(env.REQUEST_DELAY_MS, 250),
  });

  const marketsById = new Map(markets.map((m) => [m.id, m]));
  const discovered: (Option & { districtId: number })[] = [];
  const districtResults: DistrictResult[] = [];
  const marketResults: MarketResult[] = [];
  const priceRows: { m: number; d: string; i: string; p: number }[] = [];
  let districtUpserts: Option[] = [];

  try {
    const home = await client.home();
    const reportDate = parseReportedDate(home.html) ?? today;
    const homeDistricts = parseSelectOptions(home.html, DISTRICT_FIELD);
    if (!homeDistricts.length) throw new Error("rbzts home page has no district list (layout changed?)");

    // Bootstrap / sync the district list when the dropdown differs from the DB.
    const known = new Map(districts.map((d) => [d.id, d]));
    districtUpserts = homeDistricts.filter((o) => known.get(o.id)?.name !== o.name);
    if (districtUpserts.length) {
      districts = homeDistricts.map(
        (o) => known.get(o.id) ?? { id: o.id, name: o.name, marketCount: 0, lastAttemptAt: null },
      );
      plan = planTick(districts, markets, today, now, cfg);
    }


    outer: for (const dp of plan) {
      const due = new Set(dp.dueMarketIds);
      let options: Option[] = [];
      try {
        const page = await client.selectDistrict(home, dp.districtId);
        options = parseSelectOptions(page.html, MARKET_FIELD);
        summary.districts++;
        discovered.push(...options.map((o) => ({ ...o, districtId: dp.districtId })));

        const toScrape = options.filter((o) => due.has(o.id) || !marketsById.has(o.id));
        for (const o of toScrape) {
          let table;
          try {
            table = parsePriceTable((await client.selectMarket(page, dp.districtId, o.id)).html);
          } catch (err) {
            if (err instanceof BudgetExceeded) throw err;
            summary.errors.push(`market ${o.id}: ${String(err)}`);
            continue;
          }
          summary.markets++;
          const result: MarketResult = { id: o.id };
          if (table.status === "missing") {
            summary.errors.push(`market ${o.id}: no price grid in response`);
          } else if (table.status === "ok") {
            summary.reported++;
            const hash = hashRows(table.rows);
            const prev = marketsById.get(o.id);
            Object.assign(result, { reportedDate: reportDate, itemCount: table.rows.length, hash });
            if (prev?.lastHash !== hash || prev?.lastReportedDate !== reportDate) {
              for (const r of table.rows) priceRows.push({ m: o.id, d: reportDate, i: r.item, p: r.price });
            }
          }
          marketResults.push(result);
        }
        districtResults.push({ id: dp.districtId, marketCount: options.length, attemptAt: nowIso, error: null });
      } catch (err) {
        if (err instanceof BudgetExceeded) {
          summary.budgetHit = true;
          if (options.length) {
            districtResults.push({ id: dp.districtId, marketCount: options.length, attemptAt: null, error: null });
          }
          break outer;
        }
        // Leave last_attempt_at alone so the district is retried next tick.
        summary.errors.push(`district ${dp.districtId}: ${String(err)}`);
        const prev = districts.find((d) => d.id === dp.districtId);
        districtResults.push({
          id: dp.districtId,
          marketCount: options.length || (prev?.marketCount ?? 0),
          attemptAt: null,
          error: String(err),
        });
      }
    }
  } catch (err) {
    // Upstream down or layout changed: still record the run and release the lease.
    summary.errors.push(`fatal: ${String(err)}`);
  }
  summary.fetches = client.fetches;
  summary.priceRows = priceRows.length;

  const db = env.DB;
  const json = JSON.stringify;
  const stmts: D1PreparedStatement[] = [];
  if (districtUpserts.length) {
    stmts.push(
      db
        .prepare(
          `INSERT INTO districts (id, name)
           SELECT json_extract(value, '$.id'), json_extract(value, '$.name') FROM json_each(?1) WHERE true
           ON CONFLICT(id) DO UPDATE SET name = excluded.name`,
        )
        .bind(json(districtUpserts)),
    );
  }
  if (discovered.length) {
    stmts.push(
      db
        .prepare(
          `INSERT INTO markets (id, district_id, name, active)
           SELECT json_extract(value, '$.id'), json_extract(value, '$.districtId'), json_extract(value, '$.name'), 1
             FROM json_each(?1) WHERE true
           ON CONFLICT(id) DO UPDATE SET district_id = excluded.district_id, name = excluded.name, active = 1
           WHERE markets.district_id IS NOT excluded.district_id OR markets.name IS NOT excluded.name OR markets.active = 0`,
        )
        .bind(json(discovered)),
    );
  }
  const discoveredDistricts = districtResults.filter((d) => d.error === null).map((d) => d.id);
  if (discoveredDistricts.length) {
    // Markets that vanished from a district's dropdown.
    stmts.push(
      db
        .prepare(
          `UPDATE markets SET active = 0
            WHERE active = 1
              AND district_id IN (SELECT value FROM json_each(?1))
              AND id NOT IN (SELECT value FROM json_each(?2))`,
        )
        .bind(json(discoveredDistricts), json(discovered.map((m) => m.id))),
    );
  }
  if (districtResults.length) {
    stmts.push(
      db
        .prepare(
          `UPDATE districts
              SET market_count = json_extract(j.value, '$.marketCount'),
                  last_attempt_at = COALESCE(json_extract(j.value, '$.attemptAt'), last_attempt_at),
                  last_error = json_extract(j.value, '$.error')
             FROM json_each(?1) AS j
            WHERE districts.id = json_extract(j.value, '$.id')`,
        )
        .bind(json(districtResults)),
    );
  }
  if (marketResults.length) {
    stmts.push(
      db
        .prepare(
          `UPDATE markets
              SET last_checked_at = ?2,
                  last_reported_date = COALESCE(json_extract(j.value, '$.reportedDate'), last_reported_date),
                  last_item_count = COALESCE(json_extract(j.value, '$.itemCount'), last_item_count),
                  last_hash = COALESCE(json_extract(j.value, '$.hash'), last_hash)
             FROM json_each(?1) AS j
            WHERE markets.id = json_extract(j.value, '$.id')`,
        )
        .bind(json(marketResults), nowIso),
    );
  }
  if (priceRows.length) {
    stmts.push(
      db
        .prepare(
          `INSERT INTO prices (market_id, date, item, price, first_seen_at, updated_at)
           SELECT json_extract(value, '$.m'), json_extract(value, '$.d'), json_extract(value, '$.i'),
                  json_extract(value, '$.p'), ?2, ?2
             FROM json_each(?1) WHERE true
           ON CONFLICT(market_id, date, item) DO UPDATE
              SET price = excluded.price, updated_at = excluded.updated_at
            WHERE prices.price != excluded.price`,
        )
        .bind(json(priceRows), nowIso),
    );
  }
  stmts.push(
    db
      .prepare(
        `INSERT INTO scrape_runs
           (started_at, finished_at, trigger, districts, markets, reported, price_rows, fetches, budget_hit, errors)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)`,
      )
      .bind(
        startedAt,
        new Date().toISOString(),
        trigger,
        summary.districts,
        summary.markets,
        summary.reported,
        summary.priceRows,
        summary.fetches,
        summary.budgetHit ? 1 : 0,
        summary.errors.length ? json(summary.errors.slice(0, 20)) : null,
      ),
  );
  stmts.push(db.prepare("UPDATE scrape_lock SET until = '' WHERE id = 1 AND until = ?1").bind(leaseUntil));
  await db.batch(stmts);
  return summary;
}
