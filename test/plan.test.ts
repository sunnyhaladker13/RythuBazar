import { describe, expect, it } from "vitest";
import { planTick, type DistrictState, type MarketState, type PlanConfig } from "../src/scraper/plan";

const now = new Date("2026-10-07T06:00:00Z"); // 11:30 IST
const today = "2026-10-07";
const ago = (min: number) => new Date(now.getTime() - min * 60_000).toISOString();
const cfg: PlanConfig = { activeIntervalMin: 30, recheckIntervalMin: 180, discoveryIntervalMin: 1440, budget: 34 };

const d = (id: number, lastAttemptAt: string | null, marketCount = 0): DistrictState => ({
  id,
  name: `D${id}`,
  marketCount,
  lastAttemptAt,
});
const m = (id: number, districtId: number, lastCheckedAt: string | null, lastReportedDate: string | null = null): MarketState => ({
  id,
  districtId,
  name: `M${id}`,
  lastCheckedAt,
  lastReportedDate,
  lastHash: null,
});

describe("planTick", () => {
  it("bootstraps never-fetched districts first, within budget", () => {
    const districts = Array.from({ length: 33 }, (_, i) => d(i + 1, null));
    const plan = planTick(districts, [], today, now, cfg);
    // each unknown district is estimated at 1 + 3 fetches
    expect(plan).toHaveLength(8);
    expect(plan.reduce((s, p) => s + p.cost, 0)).toBeLessThanOrEqual(cfg.budget);
  });

  it("re-checks unreported markets every 30 min and reported ones every 3 h", () => {
    const plan = planTick(
      [d(1, ago(40), 3)],
      [m(10, 1, ago(40)), m(11, 1, ago(10)), m(12, 1, ago(40), today), m(13, 1, ago(200), today)],
      today,
      now,
      cfg,
    );
    expect(plan).toEqual([{ districtId: 1, dueMarketIds: [10, 13], cost: 3 }]);
  });

  it("treats yesterday's report as not reported today", () => {
    const plan = planTick([d(1, ago(40), 1)], [m(10, 1, ago(40), "2026-10-06")], today, now, cfg);
    expect(plan[0]?.dueMarketIds).toEqual([10]);
  });

  it("skips idle districts until rediscovery is due", () => {
    expect(planTick([d(1, ago(60))], [], today, now, cfg)).toEqual([]);
    expect(planTick([d(1, ago(1500))], [], today, now, cfg)).toEqual([{ districtId: 1, dueMarketIds: [], cost: 1 }]);
  });

  it("serves the stalest work first and fills the budget greedily", () => {
    const markets = [
      ...Array.from({ length: 20 }, (_, i) => m(100 + i, 1, ago(60))),
      ...Array.from({ length: 20 }, (_, i) => m(200 + i, 2, ago(90))),
      m(300, 3, ago(45)),
    ];
    const plan = planTick([d(1, ago(60), 20), d(2, ago(90), 20), d(3, ago(45), 1)], markets, today, now, cfg);
    expect(plan.map((p) => p.districtId)).toEqual([2, 3]); // 21 + 2 fits; district 1 (21) would overflow
  });

  it("always takes one district even if it alone exceeds the budget", () => {
    const markets = Array.from({ length: 50 }, (_, i) => m(i + 1, 1, null));
    const plan = planTick([d(1, ago(60), 50)], markets, today, now, cfg);
    expect(plan).toHaveLength(1);
  });
});
