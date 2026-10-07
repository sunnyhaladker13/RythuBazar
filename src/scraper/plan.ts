// Decides which districts/markets a tick should fetch, within the fetch budget.
// Pure, so the scheduling rules are unit-testable.

export interface DistrictState {
  id: number;
  name: string;
  marketCount: number;
  lastAttemptAt: string | null;
}

export interface MarketState {
  id: number;
  districtId: number;
  name: string;
  lastCheckedAt: string | null;
  lastReportedDate: string | null;
  lastHash: string | null;
}

export interface PlanConfig {
  activeIntervalMin: number;
  recheckIntervalMin: number;
  discoveryIntervalMin: number;
  /** Fetches available for district + market pages (home page excluded). */
  budget: number;
}

export interface DistrictPlan {
  districtId: number;
  dueMarketIds: number[];
  cost: number;
}

/** Guess for a district never fetched before (its market count is unknown). */
const UNKNOWN_DISTRICT_MARKETS = 3;

const MIN = 60_000;

function olderThan(iso: string | null, minutes: number, nowMs: number): boolean {
  return iso === null || nowMs - Date.parse(iso) >= minutes * MIN;
}

export function isMarketDue(m: MarketState, today: string, nowMs: number, cfg: PlanConfig): boolean {
  const interval = m.lastReportedDate === today ? cfg.recheckIntervalMin : cfg.activeIntervalMin;
  return olderThan(m.lastCheckedAt, interval, nowMs);
}

export function planTick(
  districts: DistrictState[],
  markets: MarketState[],
  today: string,
  now: Date,
  cfg: PlanConfig,
): DistrictPlan[] {
  const nowMs = now.getTime();
  const byDistrict = new Map<number, MarketState[]>();
  for (const m of markets) {
    const list = byDistrict.get(m.districtId) ?? [];
    list.push(m);
    byDistrict.set(m.districtId, list);
  }

  const candidates: (DistrictPlan & { sortKey: string })[] = [];
  for (const d of districts) {
    const known = byDistrict.get(d.id) ?? [];
    const due = known.filter((m) => isMarketDue(m, today, nowMs, cfg));
    const neverFetched = d.lastAttemptAt === null;
    const rediscover = olderThan(d.lastAttemptAt, cfg.discoveryIntervalMin, nowMs);
    if (!due.length && !neverFetched && !rediscover) continue;

    const expected = neverFetched && !known.length ? UNKNOWN_DISTRICT_MARKETS : due.length;
    // Oldest work first; never-fetched districts sort before everything ("").
    const oldest = due.map((m) => m.lastCheckedAt ?? "").sort()[0];
    candidates.push({
      districtId: d.id,
      dueMarketIds: due.map((m) => m.id),
      cost: 1 + expected,
      sortKey: neverFetched ? "" : (oldest ?? d.lastAttemptAt ?? ""),
    });
  }
  candidates.sort((a, b) => a.sortKey.localeCompare(b.sortKey) || a.districtId - b.districtId);

  // Greedy fill. The first district is always taken: if it overruns, the tick
  // stops mid-district and the unchecked markets stay due for the next tick.
  const plan: DistrictPlan[] = [];
  let used = 0;
  for (const { sortKey: _, ...c } of candidates) {
    if (plan.length && used + c.cost > cfg.budget) continue;
    plan.push(c);
    used += c.cost;
    if (used >= cfg.budget) break;
  }
  return plan;
}
