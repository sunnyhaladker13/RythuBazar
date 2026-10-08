import { describe, expect, it } from "vitest";
import { isFresh } from "../src/snapshot";

const now = new Date("2026-10-08T06:00:00Z"); // 11:30 IST
const row = (day: string, minutesOld: number) => ({
  day,
  builtAt: new Date(now.getTime() - minutesOld * 60_000).toISOString(),
  body: "{}",
});

describe("isFresh", () => {
  it("serves a recent snapshot from today", () => {
    expect(isFresh(row("2026-10-08", 1), now)).toBe(true);
  });

  it("rebuilds when there is none", () => {
    expect(isFresh(null, now)).toBe(false);
  });

  it("rebuilds after 5 minutes", () => {
    expect(isFresh(row("2026-10-08", 5), now)).toBe(false);
  });

  it("rebuilds when the IST date has rolled over", () => {
    // 00:01 IST on 9 Oct, one minute after a snapshot built on 8 Oct.
    const justAfterMidnight = new Date("2026-10-08T18:31:00Z");
    const yesterday = { day: "2026-10-08", builtAt: "2026-10-08T18:29:00Z", body: "{}" };
    expect(isFresh(yesterday, justAfterMidnight)).toBe(false);
  });
});
