import { describe, expect, it } from "vitest";
import { movers, priceStats, usableDays } from "../src/api";

describe("priceStats", () => {
  it("handles one market", () => {
    expect(priceStats("31")).toEqual({ min: 31, max: 31, median: 31, markets: 1 });
  });

  it("sorts numerically, not as strings", () => {
    expect(priceStats("100,9,35")).toEqual({ min: 9, max: 100, median: 35, markets: 3 });
  });

  it("averages the middle pair for an even count", () => {
    expect(priceStats("55,70")).toEqual({ min: 55, max: 70, median: 62.5, markets: 2 });
  });

  it("keeps decimal prices", () => {
    expect(priceStats("12.5,10,11").median).toBe(11);
  });
});

describe("movers", () => {
  const r = (marketId: number, item: string, price: number) => ({ marketId, item, price });

  it("ranks by relative change and drops unchanged items", () => {
    const today = [r(1, "Tomato", 40), r(2, "Tomato", 44), r(1, "Onion", 60), r(2, "Onion", 60), r(1, "Potato", 18), r(2, "Potato", 18)];
    const before = [r(1, "Tomato", 30), r(2, "Tomato", 34), r(1, "Onion", 50), r(2, "Onion", 50), r(1, "Potato", 18), r(2, "Potato", 18)];
    expect(movers(today, before, 2)).toEqual([
      { item: "Tomato", change: 10, pct: 31, bazars: 2 },
      { item: "Onion", change: 10, pct: 20, bazars: 2 },
    ]);
  });

  it("uses the median bazar, so one outlier can't top the board", () => {
    const today = [r(1, "Cabbage", 13), r(2, "Cabbage", 13), r(3, "Cabbage", 130)];
    const before = [r(1, "Cabbage", 13), r(2, "Cabbage", 14), r(3, "Cabbage", 13)];
    // Changes 0, -1, +117: the median bazar didn't move.
    expect(movers(today, before, 3)).toEqual([]);
  });

  it("needs enough bazars with both days", () => {
    expect(movers([r(1, "Tomato", 40)], [r(1, "Tomato", 30)], 3)).toEqual([]);
    expect(movers([r(1, "Tomato", 40)], [r(1, "Tomato", 30)], 1)).toEqual([{ item: "Tomato", change: 10, pct: 33, bazars: 1 }]);
  });

  it("only pairs the same bazar's rates", () => {
    expect(movers([r(1, "Tomato", 40)], [r(2, "Tomato", 30)], 1)).toEqual([]);
  });
});

describe("usableDays", () => {
  const d = (date: string, markets: number) => ({ date, markets });

  it("drops days with fewer than 3 bazars", () => {
    expect(usableDays([d("2026-10-06", 2), d("2026-10-07", 15)], "2026-10-08")).toEqual([d("2026-10-07", 15)]);
  });

  it("holds back today until half of yesterday's bazars have posted", () => {
    expect(usableDays([d("2026-10-07", 16), d("2026-10-08", 4)], "2026-10-08")).toEqual([d("2026-10-07", 16)]);
    expect(usableDays([d("2026-10-07", 16), d("2026-10-08", 8)], "2026-10-08")).toHaveLength(2);
  });

  it("keeps a thin day when it isn't today", () => {
    expect(usableDays([d("2026-10-06", 16), d("2026-10-07", 4)], "2026-10-08")).toHaveLength(2);
  });
});
