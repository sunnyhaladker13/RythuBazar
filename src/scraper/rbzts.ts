// Client + parsers for the Telangana Rythu Bazar Information System (rbzts),
// an ASP.NET WebForms page. Flow: GET home → POST district → POST market → price table.
// Parsers are pure and regex-based so they stay cheap under the 10 ms CPU limit.

export const DISTRICT_FIELD = "ctl00$ContentPlaceHolder1$ddlDist";
export const MARKET_FIELD = "ctl00$ContentPlaceHolder1$ddlRbz";
const PAGE_PATH = "/rbzts/HomePage.aspx";

export interface Option {
  id: number;
  name: string;
}

export interface PriceRow {
  item: string;
  price: number;
}

export type PriceTable =
  | { status: "ok"; rows: PriceRow[] }
  | { status: "not_reported" } // "Sorry Data not updated for this Market"
  | { status: "missing" }; // no grid at all: unexpected page

/** A fetched page. Hidden fields are parsed lazily: market pages never need them. */
export class Page {
  private fields?: Record<string, string>;
  constructor(readonly html: string) {}
  get hidden(): Record<string, string> {
    return (this.fields ??= parseHiddenFields(this.html));
  }
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

function cleanText(s: string): string {
  return decodeEntities(s.replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim();
}

export function parseHiddenFields(html: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of html.matchAll(/<input\b[^>]*\btype="hidden"[^>]*>/gi)) {
    const name = /\bname="([^"]*)"/.exec(m[0])?.[1];
    const value = /\bvalue="([^"]*)"/.exec(m[0])?.[1] ?? "";
    if (name) out[name] = decodeEntities(value);
  }
  return out;
}

/** Numeric options of a <select>, skipping the "Select" placeholder. */
export function parseSelectOptions(html: string, fieldName: string): Option[] {
  const start = html.indexOf(`name="${fieldName}"`);
  if (start < 0) return [];
  const end = html.indexOf("</select>", start);
  const block = html.slice(start, end < 0 ? undefined : end);
  const out: Option[] = [];
  for (const m of block.matchAll(/<option\b[^>]*\bvalue="(\d+)"[^>]*>([^<]*)<\/option>/gi)) {
    const id = Number(m[1]);
    if (id > 0) out.push({ id, name: cleanText(m[2]) });
  }
  return out;
}

/** Server's "reported" date label (dd/mm/yyyy) as yyyy-mm-dd. */
export function parseReportedDate(html: string): string | null {
  const m = /id="ctl00_ContentPlaceHolder1_lblReported"[^>]*>\s*(\d{2})\/(\d{2})\/(\d{4})/.exec(html);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

export function parsePrice(raw: string): number | null {
  const m = /^\s*(\d+(?:\.\d+)?)/.exec(raw);
  return m ? Number(m[1]) : null;
}

export function parsePriceTable(html: string): PriceTable {
  const start = html.indexOf('id="ctl00_ContentPlaceHolder1_GridView1"');
  if (start < 0) return { status: "missing" };
  const end = html.indexOf("</table>", start);
  const grid = html.slice(start, end < 0 ? undefined : end);
  if (/Data not updated/i.test(grid)) return { status: "not_reported" };

  const rows: PriceRow[] = [];
  const seen = new Set<string>();
  for (const tr of grid.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...tr[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map((c) => cleanText(c[1]));
    if (cells.length !== 2) continue; // header uses <th>
    const [item, rawPrice] = cells;
    if (item === "Vegetable") continue; // repeated header styled as footer
    const price = parsePrice(rawPrice);
    if (!item || price === null || seen.has(item)) continue;
    seen.add(item);
    rows.push({ item, price });
  }
  return rows.length ? { status: "ok", rows } : { status: "not_reported" };
}

export class BudgetExceeded extends Error {
  constructor() {
    super("fetch budget exhausted");
  }
}

export interface ClientOptions {
  origin: string;
  maxFetches: number;
  delayMs?: number;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

/** Stateless page client that counts every outbound request against a budget. */
export class RbztsClient {
  fetches = 0;
  private readonly url: string;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly opts: ClientOptions) {
    this.url = opts.origin.replace(/\/+$/, "") + PAGE_PATH;
    this.fetchImpl = opts.fetchImpl ?? ((input, init) => fetch(input, init));
  }

  get remaining(): number {
    return this.opts.maxFetches - this.fetches;
  }

  home(): Promise<Page> {
    return this.request();
  }

  selectDistrict(home: Page, districtId: number): Promise<Page> {
    return this.request({
      ...home.hidden,
      __EVENTTARGET: DISTRICT_FIELD,
      __EVENTARGUMENT: "",
      [DISTRICT_FIELD]: String(districtId),
    });
  }

  /** `districtPage` must be the response of selectDistrict; it can be reused for each market. */
  selectMarket(districtPage: Page, districtId: number, marketId: number): Promise<Page> {
    return this.request({
      ...districtPage.hidden,
      __EVENTTARGET: MARKET_FIELD,
      __EVENTARGUMENT: "",
      [DISTRICT_FIELD]: String(districtId),
      [MARKET_FIELD]: String(marketId),
    });
  }

  private async request(form?: Record<string, string>): Promise<Page> {
    let lastError: unknown;
    // One retry, but only while budget remains: retries are subrequests too.
    for (let attempt = 0; attempt < 2; attempt++) {
      if (this.remaining <= 0) throw lastError ?? new BudgetExceeded();
      if (this.fetches > 0 && this.opts.delayMs) await sleep(this.opts.delayMs * (attempt + 1));
      this.fetches++;
      try {
        const res = await this.fetchImpl(this.url, {
          method: form ? "POST" : "GET",
          headers: {
            "User-Agent": "Mozilla/5.0 (compatible; rythu-bazar-prices)",
            ...(form ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
          },
          body: form ? new URLSearchParams(form).toString() : undefined,
          signal: AbortSignal.timeout(this.opts.timeoutMs ?? 25_000),
        });
        if (!res.ok) throw new Error(`rbzts HTTP ${res.status}`);
        return new Page(await res.text());
      } catch (err) {
        lastError = err;
      }
    }
    throw lastError;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
