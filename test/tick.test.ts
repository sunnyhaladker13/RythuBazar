import { describe, expect, it } from "vitest";
import { isCarryOver } from "../src/scraper/tick";

describe("isCarryOver", () => {
  it("flags yesterday's table still on screen", () => {
    expect(isCarryOver({ lastReportedDate: "2026-10-07", lastHash: "abc" }, "abc", "2026-10-08")).toBe(true);
  });

  it("accepts a changed table on a new day", () => {
    expect(isCarryOver({ lastReportedDate: "2026-10-07", lastHash: "abc" }, "xyz", "2026-10-08")).toBe(false);
  });

  it("accepts a re-check of today's own table", () => {
    expect(isCarryOver({ lastReportedDate: "2026-10-08", lastHash: "abc" }, "abc", "2026-10-08")).toBe(false);
  });

  it("accepts a market's first report", () => {
    expect(isCarryOver(undefined, "abc", "2026-10-08")).toBe(false);
    expect(isCarryOver({ lastReportedDate: null, lastHash: null }, "abc", "2026-10-08")).toBe(false);
  });
});
