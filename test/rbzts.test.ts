import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  DISTRICT_FIELD,
  MARKET_FIELD,
  RbztsClient,
  BudgetExceeded,
  parseHiddenFields,
  parsePrice,
  parsePriceTable,
  parseReportedDate,
  parseSelectOptions,
} from "../src/scraper/rbzts";

const fixture = (name: string) => readFileSync(join(import.meta.dirname, "fixtures", name), "utf8");

describe("parsers", () => {
  const home = fixture("home.html");

  it("reads the ASP.NET hidden fields", () => {
    const h = parseHiddenFields(home);
    expect(Object.keys(h)).toEqual(
      expect.arrayContaining(["__VIEWSTATE", "__EVENTVALIDATION", "__VIEWSTATEGENERATOR", "__PREVIOUSPAGE"]),
    );
    expect(h.__VIEWSTATE.length).toBeGreaterThan(1000);
  });

  it("lists districts and skips the placeholder", () => {
    const d = parseSelectOptions(home, DISTRICT_FIELD);
    expect(d).toHaveLength(33);
    expect(d).toContainEqual({ id: 16, name: "Hyderabad" });
  });

  it("lists a district's markets", () => {
    expect(parseSelectOptions(fixture("district-hyderabad.html"), MARKET_FIELD)).toEqual([
      { id: 83, name: "Mehdipatnam" },
      { id: 90, name: "Falaknama" },
      { id: 91, name: "Erragadda" },
    ]);
    expect(parseSelectOptions(fixture("district-kamareddy-empty.html"), MARKET_FIELD)).toEqual([]);
  });

  it("reads the reported date", () => {
    expect(parseReportedDate(home)).toBe("2026-10-07");
  });

  it("parses a price table, skipping header/footer rows", () => {
    const t = parsePriceTable(fixture("market-mehdipatnam.html"));
    expect(t.status).toBe("ok");
    if (t.status !== "ok") return;
    expect(t.rows).toHaveLength(26);
    expect(t.rows[0]).toEqual({ item: "Rice", price: 70 });
    expect(t.rows).toContainEqual({ item: "Tomato", price: 31 });
    expect(t.rows).toContainEqual({ item: "Bitter Gourd", price: 45 }); // double space collapsed
    expect(t.rows.some((r) => r.item === "Vegetable")).toBe(false);
  });

  it("detects markets that have not reported", () => {
    expect(parsePriceTable(fixture("market-erragadda.html"))).toEqual({ status: "not_reported" });
    expect(parsePriceTable(home)).toEqual({ status: "missing" });
  });

  it("parses rate strings", () => {
    expect(parsePrice("31/-")).toBe(31);
    expect(parsePrice(" 12.50/-")).toBe(12.5);
    expect(parsePrice("-")).toBeNull();
  });

  it("parses all fixture pages well within the 10 ms CPU budget", () => {
    const pages = ["home.html", "district-hyderabad.html", "market-mehdipatnam.html"].map(fixture);
    const runs = 200;
    const t0 = performance.now();
    for (let i = 0; i < runs; i++) {
      for (const p of pages) {
        parseHiddenFields(p);
        parseSelectOptions(p, DISTRICT_FIELD);
        parseSelectOptions(p, MARKET_FIELD);
        parsePriceTable(p);
      }
    }
    const perPage = (performance.now() - t0) / (runs * pages.length);
    console.log(`parse cost ≈ ${perPage.toFixed(3)} ms/page`);
    expect(perPage).toBeLessThan(0.25); // a full tick parses ≤ 35 pages
  });
});

describe("RbztsClient", () => {
  it("stops at the fetch budget, counting retries", async () => {
    let calls = 0;
    const client = new RbztsClient({
      origin: "http://example.test",
      maxFetches: 3,
      fetchImpl: async () => {
        calls++;
        throw new Error("timeout");
      },
    });
    await expect(client.home()).rejects.toThrow("timeout"); // 2 attempts
    await expect(client.home()).rejects.toThrow("timeout"); // 1 attempt, budget then empty
    await expect(client.home()).rejects.toBeInstanceOf(BudgetExceeded);
    expect(calls).toBe(3);
  });

  it("posts the district postback with view state", async () => {
    const home = fixture("home.html");
    let body = "";
    const client = new RbztsClient({
      origin: "http://example.test/",
      maxFetches: 5,
      fetchImpl: async (_url, init) => {
        body = String(init?.body ?? "");
        return new Response(home);
      },
    });
    const page = await client.home();
    await client.selectDistrict(page, 16);
    const form = new URLSearchParams(body);
    expect(form.get("__EVENTTARGET")).toBe(DISTRICT_FIELD);
    expect(form.get(DISTRICT_FIELD)).toBe("16");
    expect(form.get("__VIEWSTATE")).toBe(page.hidden.__VIEWSTATE);
  });
});
