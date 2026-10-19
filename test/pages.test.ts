import { describe, expect, it } from "vitest";
import { ITEMS, baseItem, itemBySlug, itemSlug, pathForItem } from "../src/items";
import { chartRanges, changeText, esc, html, vegetablePage, type VegData } from "../src/pages";
import { istTime, slugify } from "../src/format";

describe("vegetable slugs", () => {
  it("drops the bracket and is unique", () => {
    expect(itemSlug("Bhendi")).toBe("okra");
    expect(itemSlug("Onions-I")).toBe("onion");
    expect(itemSlug("Leafy Vegetables")).toBe("leafy-greens");
    const slugs = Object.keys(ITEMS).map(itemSlug);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const s of slugs) expect(itemBySlug(s)).not.toBeNull();
  });

  it("sends a variety to its base vegetable's page", () => {
    expect(baseItem("Tomato-618")).toBe("Tomato");
    expect(baseItem("Onions-II")).toBe("Onions-I");
    expect(pathForItem("Tomato-618")).toBe("/vegetables/tomato");
    expect(pathForItem("Dragon fruit")).toBeNull();
  });
});

describe("html", () => {
  it("escapes interpolated text, not nested html", () => {
    const name = `<script>alert("x")</script>`;
    expect(html`<b>${name}</b>${html`<i>ok</i>`}`.value).toBe(`<b>${esc(name)}</b><i>ok</i>`);
    expect(esc(`a"b'<`)).toBe("a&quot;b&#39;&lt;");
  });

  it("formats IST clock times and slugs", () => {
    expect(istTime("2026-10-19T06:35:00.000Z")).toBe("12:05 pm");
    expect(istTime("2026-10-19T02:00:00.000Z")).toBe("7:30 am");
    expect(slugify("Kothagudem (P. Stdm)")).toBe("kothagudem-p-stdm");
  });
});

describe("chart", () => {
  const days = (dates: string[]) => dates.map((date, i) => ({ date, median: 30 - i }));

  it("offers a period only while history reaches past the shorter one", () => {
    const d = days(Array.from({ length: 13 }, (_, i) => `2026-10-${String(7 + i).padStart(2, "0")}`));
    expect(chartRanges(d).map((r) => r.key)).toEqual(["1W", "1M"]);
    expect(chartRanges(d.slice(-5)).map((r) => r.key)).toEqual(["1W"]);
    expect(chartRanges(d.slice(-2))).toEqual([]);
  });

  it("words the change since the period began", () => {
    expect(changeText({ date: "2026-10-07", median: 31 }, { median: 23 }, "1M")).toEqual({
      text: "▼ ₹8 · 26% since 7 Oct",
      tone: "down",
    });
    expect(changeText({ date: "2026-10-12", median: 23 }, { median: 23 }, "1W").text).toBe("Same as 12 Oct");
  });
});

describe("vegetable page", () => {
  const row = (id: number, name: string, price: number, date = "2026-10-19", lat = 17.4, lng = 78.45) => ({
    id,
    slug: `b${id}`,
    name,
    district: "Hyderabad",
    lat,
    lng,
    date,
    price,
    updatedAt: "2026-10-19T06:35:00.000Z",
  });
  const data = (rows: VegData["rows"]): VegData => ({
    today: "2026-10-19",
    key: "Tomato",
    rows,
    days: [
      { item: "Tomato", date: "2026-10-12", median: 27, markets: 15 },
      { item: "Tomato", date: "2026-10-18", median: 23, markets: 15 },
      { item: "Tomato", date: "2026-10-19", median: 23, markets: 12 },
    ],
    last: null,
    variants: [],
    others: [],
  });

  it("puts every rate, a dated description and the answers in the html", () => {
    const page = vegetablePage(
      { origin: "https://example.in" },
      data([row(1, "Erragadda", 23), row(2, "Kodad", 30, "2026-10-17", 16.99, 79.97)]),
    );
    expect(page).toContain("<title>Tomato price today in Hyderabad &amp; Telangana | Rythu Bazar rates</title>");
    expect(page).toContain("19 Oct: Tomato is ₹23 a kg at 1 of 2 Rythu Bazars, including 1 branch in Hyderabad; up to ₹30 in Hyderabad.");
    expect(page).toContain('href="https://example.in/vegetables/tomato"');
    expect(page).toContain("₹23–30 at 2 branches · 1 posted today");
    expect(page).toContain("The typical rate is ₹23 a kg, the same as yesterday and ₹4 less than a week ago (₹27 on 12 Oct).");
    expect(page).toContain("2 days ago");
    expect(page).not.toContain("noindex");
  });

  it("is noindex with nothing to show, and escapes branch names", () => {
    expect(vegetablePage({ origin: "" }, data([]))).toContain('<meta name="robots" content="noindex" />');
    const page = vegetablePage({ origin: "" }, data([row(1, "<b>X</b>", 23)]));
    expect(page).not.toContain("<b>X</b>");
    expect(page).toContain("&lt;b&gt;X&lt;/b&gt;");
  });
});
