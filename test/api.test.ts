import { describe, expect, it } from "vitest";
import { priceStats } from "../src/api";

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
