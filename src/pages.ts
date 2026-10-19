// The site's HTML, rendered by the Worker so every rate is in the page itself (search engines and
// AI tools that don't run JavaScript see them). public/app.js then adds search, sorting, "near me"
// and the chart readout on top. Every interpolated value is escaped by `html`; nothing here trusts
// a name from rbzts.

import type { DayStat, Market, Overview, Prices } from "./api";
import { bazarLabel, branchName, placeOf, shortName } from "./branches";
import {
  addDays,
  daysBetween,
  fmtDate,
  fmtDay,
  istTime,
  km,
  kmText,
  lower,
  money,
  plural,
  range,
  rupees,
} from "./format";
import { ITEMS, RARE, UNIT_VARIES, baseItem, itemSlug, pathForItem } from "./items";

// ---------- HTML ----------

export class Html {
  constructor(readonly value: string) {}
  toString() {
    return this.value;
  }
}
type Part = Html | string | number | null | undefined | false | readonly Part[];

const ESC: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
export const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ESC[c]);
const part = (p: Part): string =>
  p == null || p === false ? "" : p instanceof Html ? p.value : Array.isArray(p) ? p.map(part).join("") : esc(String(p));

/** Template tag: interpolations are escaped unless they are already Html. */
export function html(strings: TemplateStringsArray, ...parts: Part[]): Html {
  let out = strings[0];
  parts.forEach((p, i) => (out += part(p) + strings[i + 1]));
  return new Html(out);
}
const raw = (s: string) => new Html(s);
/** JSON safe inside <script>: no "</script>" or line separators can end it early. */
const scriptJson = (data: unknown) =>
  raw(JSON.stringify(data).replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029"));

// ---------- Shared pieces ----------

export const TRACKING_START = "2026-10-07"; // first day of scraped rates
// Bump ?v= whenever og.jpg changes: WhatsApp caches previews per image URL.
const OG_IMAGE = "/og.jpg?v=1";
const SITE = "Rythu Bazar rates";
// "Hyderabad" in answers = branches within this distance of the city centre (Charminar), so
// suburbs in Medchal and Rangareddy districts count and Chevella or Medchal town don't.
const HYDERABAD = { lat: 17.3616, lng: 78.4747 };
const HYDERABAD_KM = 25;
const inHyderabad = (m: { lat: number | null; lng: number | null }) =>
  m.lat != null && m.lng != null && km(HYDERABAD, { lat: m.lat, lng: m.lng }) <= HYDERABAD_KM;

const icon = {
  back: raw('<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 6l-6 6 6 6" /></svg>'),
  down: raw('<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>'),
  search: raw('<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg>'),
  close: raw('<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>'),
  pin: raw('<svg viewBox="0 0 24 24" aria-hidden="true" class="pin"><path d="M3 11l18-8-8 18-2-8z" /></svg>'),
  directions: raw(
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.5l9.5 9.5-9.5 9.5L2.5 12z" /><path d="M9 15v-3a1.5 1.5 0 0 1 1.5-1.5H15" /><path d="M13 8.5l2 2-2 2" /></svg>',
  ),
};

export interface Ctx {
  origin: string; // canonical origin, e.g. https://rythubazarrates.in
}

interface Page {
  path: string;
  title: string; // no price in it: search results keep a title for days
  description: string; // dated, so a quote of it is always dated
  page: string; // body[data-page], picks what public/app.js does
  body: Html;
  noindex?: boolean;
  jsonLd?: object[];
  data?: unknown; // for public/app.js
  attrs?: Record<string, string | number>;
}

function layout(ctx: Ctx, p: Page): string {
  const url = ctx.origin + p.path;
  const ogTitle = p.title.split(" | ")[0];
  const attrs = Object.entries(p.attrs ?? {}).map(([k, v]) => html` data-${raw(k)}="${v}"`);
  return (
    "<!doctype html>\n" +
    html`<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <title>${p.title}</title>
    <meta name="description" content="${p.description}" />
    <link rel="canonical" href="${url}" />
    ${p.noindex ? raw('<meta name="robots" content="noindex" />') : ""}
    <meta property="og:type" content="website" />
    <meta property="og:site_name" content="${SITE}" />
    <meta property="og:locale" content="en_IN" />
    <meta property="og:title" content="${ogTitle}" />
    <meta property="og:description" content="${p.description}" />
    <meta property="og:url" content="${url}" />
    <meta property="og:image" content="${ctx.origin + OG_IMAGE}" />
    <meta property="og:image:type" content="image/jpeg" />
    <meta property="og:image:width" content="1200" />
    <meta property="og:image:height" content="630" />
    <meta property="og:image:alt" content="Rythu Bazar rates today, in English and Telugu" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="theme-color" content="#ffd931" media="(prefers-color-scheme: light)" />
    <meta name="theme-color" content="#1d1a1b" media="(prefers-color-scheme: dark)" />
    <link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><rect width='32' height='32' fill='%23ffd931'/><text x='16' y='24' font-family='Arial' font-weight='900' font-size='20' text-anchor='middle' fill='%23231f20'>₹</text></svg>" />
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link
      rel="stylesheet"
      href="https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@62..125,400..900&amp;family=Anek+Telugu:wght@400..700&amp;display=swap"
    />
    <link rel="stylesheet" href="/styles.css" />
    <script src="/app.js" defer></script>
    ${(p.jsonLd ?? []).map((d) => html`<script type="application/ld+json">${scriptJson(d)}</script>`)}
  </head>
  <body data-page="${p.page}"${attrs}>
${p.body}
${p.data === undefined ? "" : html`<script type="application/json" id="rbz-data">${scriptJson(p.data)}</script>`}
  </body>
</html>
`.value
  );
}

const crumbs = (ctx: Ctx, list: [string, string][]) => ({
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  itemListElement: list.map(([name, path], i) => ({ "@type": "ListItem", position: i + 1, name, item: ctx.origin + path })),
});

const SOURCE =
  "Rates as published by the Telangana Agricultural Marketing Department's Rythu Bazar Information System, in ₹ per kg.";

function footer(long: boolean): Html {
  return html`<footer class="wrap foot">
    ${
      long
        ? html`<p>
        <strong>Ranges:</strong> on the all-branches view each price runs from the lowest to the highest rate across branches that
        reported in the last three days. The small line under it is the typical price over the last week, and an arrow shows
        the change since the day before (no arrow: no change). When you're viewing one branch, the strip shows the same range:
        the square is this branch's rate and the tick is the typical (middle) rate.
      </p>
      <p>
        <strong>Biggest price moves:</strong> the three items whose rate changed most from one day to the next, by percentage.
        Across all branches it's the typical branch's change; inside a branch, that branch's own.
      </p>
      <p>
        ${SOURCE} A few items such as drumsticks and leafy greens are sold per piece or bunch, and branches don't say which, so
        those aren't compared. Branches report through the morning, usually by 1 PM.
      </p>`
        : html`<p>${SOURCE} Typical price = the middle rate across branches that day.</p>`
    }
    <p class="foot-nav"><a href="/vegetables">All vegetables</a> · <a href="/branches">All branches</a></p>
    <p class="credit">
      Built by <a href="https://www.sunnyhaladker.my" target="_blank" rel="noopener">Sunny</a> at
      <a href="https://rippledesign.co" target="_blank" rel="noopener">Ripple Design</a>
    </p>
  </footer>`;
}

/** A time the browser turns into "40 mins ago" (public/app.js); "at 12:05 pm" without JavaScript. */
const ago = (iso: string) => html`<time datetime="${iso}" data-ago>at ${istTime(iso)}</time>`;

/** How fresh a branch's rates are, as a list tag. */
function age(lastReportedDate: string | null, today: string): { text: string; tone: string } {
  if (!lastReportedDate) return { text: "No rates yet", tone: "old" };
  const n = daysBetween(lastReportedDate, today);
  if (n <= 0) return { text: "Today", tone: "today" };
  if (n === 1) return { text: "Yesterday", tone: "recent" };
  return { text: `${n} days ago`, tone: "old" };
}

/** Ink or white, whichever reads better on the tile colour. */
function inkOn(hex: string) {
  const n = parseInt(hex.slice(1), 16);
  const lum = (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
  return lum > 0.6 ? "#231f20" : "#ffffff";
}
const tile = (en: string, te: string, color: string) =>
  html`<span class="tile" aria-hidden="true" style="background:${color};color:${inkOn(color)}">${te ? [...te][0] : en[0]}</span>`;

/** rbzts writes "Miryalaguda(NSP Camp)"; give the bracket a space so it wraps like a name. */
const place = (name: string) => name.replace(/\s*\(/, " (");

/** A link when there's somewhere to go, else a plain block with the same look. */
const linkOr = (href: string | null, cls: string, label: string | null, inner: Html) =>
  href
    ? html`<a class="${cls}" href="${href}"${label ? html` aria-label="${label}"` : ""}>${inner}</a>`
    : html`<div class="${cls}"${label ? html` aria-label="${label}"` : ""}>${inner}</div>`;

// ---------- Item lists (home and branch) ----------

type Stats = { min: number; max: number; median: number; markets: number };
type Move = { item: string; change: number; pct: number; bazars: number };
interface ListItem {
  item: string;
  en: string;
  te: string;
  color: string;
  price: number; // all branches: the lowest rate, so "Cheapest first" sorts by it
  stats: Stats | null;
  cheapest?: string[];
  trend: number[];
}

// The board shows the biggest price moves; until there are enough (no history yet, or nothing moved), these fill it.
const STAPLES: [string, string][] = [
  ["Tomato", "Tomato"],
  ["Onions-I", "Onion"],
  ["Potato", "Potato"],
];

const comparable = (i: ListItem) => !!i.stats && i.stats.markets > 1 && !UNIT_VARIES.has(i.item);

/** One line under the item name. All branches: where it's cheapest. One branch: how it compares. */
function verdict(i: ListItem, branch: boolean): { tone: string; text: string } | null {
  const s = i.stats;
  if (!s || !comparable(i)) return null;
  const n = `${s.markets} branches`;
  if (s.min === s.max) return { tone: "plain", text: `Same price at all ${n}` };
  if (!branch) {
    const c = i.cheapest ?? [];
    if (c.length === 1) return { tone: "plain", text: `Cheapest at ${place(c[0])}` };
    return { tone: "plain", text: `${rupees(s.min)} at ${c.length} of ${n}` };
  }
  if (i.price <= s.min) return { tone: "good", text: `Lowest of ${n}` };
  if (i.price >= s.max) return { tone: "bad", text: `Highest of ${n}` };
  const diff = i.price - s.median;
  if (diff > s.median * 0.1) return { tone: "bad", text: `${rupees(diff)} above typical` };
  if (-diff > s.median * 0.1) return { tone: "good", text: `${rupees(-diff)} below typical` };
  return { tone: "plain", text: "Typical price" };
}

/** Best deals first: furthest below typical, then nearest the lowest rate, then the most saved vs the highest. */
function compareDeals(a: ListItem, b: ListItem) {
  const key = (i: ListItem) => {
    const s = i.stats;
    if (!s || !comparable(i)) return [Infinity, Infinity, 0];
    const span = s.max - s.min || 1;
    return [(i.price - s.median) / s.median, (i.price - s.min) / span, (s.max - i.price) / s.max];
  };
  const [a1, a2, a3] = key(a);
  const [b1, b2, b3] = key(b);
  return a1 - b1 || a2 - b2 || b3 - a3;
}

/** All branches: lowest–highest rate, since one number would hide the spread. One branch: its own rate. */
const priceLabel = (i: ListItem, branch: boolean) =>
  !branch && i.stats && i.stats.max > i.stats.min ? range(i.stats.min, i.stats.max) : rupees(i.price);

// Unchanged prices get no label at all: an arrow appearing is the signal.
const moveText = (m: Move) => `${m.change > 0 ? "▲" : "▼"} ${rupees(Math.abs(m.change))}`;
const moveWords = (m: Move) => `${m.change > 0 ? "up" : "down"} ${rupees(Math.abs(m.change))}`;

/** A small line of the last week's prices, stock-app style. Three days is the least that shows a trend. */
function sparkline(values: number[]): Html | null {
  if (!values || values.length < 3) return null;
  const H = 12;
  const lo = Math.min(...values);
  const span = Math.max(...values) - lo;
  const y = (v: number) => (span ? 1.5 + (1 - (v - lo) / span) * (H - 3) : H / 2).toFixed(1);
  const points = values.map((v, n) => `${((n / (values.length - 1)) * 100).toFixed(1)},${y(v)}`).join(" ");
  return html`<svg class="spark" viewBox="0 0 100 ${H}" preserveAspectRatio="none" aria-hidden="true"><polyline points="${points}" vector-effect="non-scaling-stroke"></polyline></svg>`;
}

function board(items: ListItem[], movers: Move[], branch: boolean): Html | null {
  const moves = new Map(movers.map((m) => [m.item, m]));
  // Biggest movers first, then staples so the board stays three wide.
  const picks = [...moves.keys(), ...STAPLES.map(([key]) => key)]
    .filter((key, n, all) => all.indexOf(key) === n && items.some((x) => x.item === key))
    .slice(0, 3);
  if (!picks.length) return null;
  const tiles = picks.map((key) => {
    const i = items.find((x) => x.item === key)!;
    // Tiles are narrow: "Okra (bhindi)" → "Okra".
    const label = STAPLES.find(([k]) => k === key)?.[1] ?? i.en.replace(/\s*\(.*\)$/, "");
    const move = moves.get(key);
    const s = i.stats;
    const priceText = priceLabel(i, branch);
    let note = "per kg";
    if (s && s.markets > 1) {
      if (!branch) note = `per kg · ${s.markets} branches`;
      else {
        const v = verdict(i, branch);
        note = `${v?.tone === "good" ? "low" : v?.tone === "bad" ? "high" : "typical"} · ${range(s.min, s.max)}`;
      }
    }
    const aria = [
      `${label} ${priceText} per kg${branch ? "" : " across branches"}`,
      move ? `${moveWords(move)}, ${Math.abs(move.pct)}%` : "",
      "Every branch's rate",
    ]
      .filter(Boolean)
      .join(". ");
    return linkOr(
      pathForItem(key),
      "staple",
      aria,
      html`<span class="label">${label}</span><span class="te">${i.te}</span><span class="num${priceText.length > 5 ? " small" : ""}">${priceText}</span>${
        move ? html`<span class="move" aria-hidden="true">${moveText(move)} · ${Math.abs(move.pct)}%</span>` : ""
      }${sparkline(i.trend)}<span class="note">${note}</span>`,
    );
  });
  return html`<p class="board-label">${moves.size ? "Biggest price moves since the day before" : "Daily staples"}</p>
        <div class="board">${tiles}</div>`;
}

function itemRow(i: ListItem, move: Move | undefined, branch: boolean, deal: number): Html {
  const s = i.stats;
  const rare = !branch && !!s && s.markets < RARE;
  const v = rare
    ? {
        tone: "plain",
        text: s!.markets === 1 ? `Only at ${place(i.cheapest?.[0] ?? "one branch")}` : `Only ${s!.markets} branches report this`,
      }
    : verdict(i, branch);
  const unitVaries = UNIT_VARIES.has(i.item);
  // All branches: the range is the headline, so the strip only earns its place inside one branch.
  const showStrip = branch && comparable(i) && s!.max > s!.min;
  const pos = (p: number) => `${((p - s!.min) / (s!.max - s!.min)) * 100}%`;
  const priceText = priceLabel(i, branch);
  // All branches: the last week's trend and the change since the day before, under the range.
  const spark = branch ? null : sparkline(i.trend);
  const change = branch || !move ? null : move;
  const label = [
    i.en,
    `${priceText}${unitVaries ? "" : " per kg"}${branch ? "" : " across branches"}`,
    change ? `${moveWords(change)} since the day before` : "",
    v?.text,
  ]
    .filter(Boolean)
    .join(". ");
  const inner = html`${tile(i.en, i.te, i.color)}<span class="what"><span class="en">${i.en}</span>${
    i.te ? html`<span class="te">${i.te}</span>` : ""
  }${v ? html`<span class="badge ${v.tone}">${v.text}</span>` : ""}${
    unitVaries ? html`<span class="badge plain">Per piece or bunch at some branches</span>` : ""
  }</span><span class="cost"><span class="num${priceText.length > 5 ? " small" : ""}">${priceText}${
    unitVaries ? "" : html`<span class="unit">/kg</span>`
  }</span>${
    showStrip
      ? html`<span class="strip" aria-hidden="true"><span class="tick" style="left:${pos(s!.median)}"></span><span class="dot" style="left:${pos(i.price)}"></span></span>`
      : ""
  }${
    spark || change
      ? html`<span class="meta" aria-hidden="true">${spark}${
          change ? html`<span class="chg ${change.change > 0 ? "up" : "down"}">${moveText(change)}</span>` : ""
        }</span>`
      : ""
  }${
    showStrip
      ? html`<span class="range" aria-hidden="true"><span>${rupees(s!.min)}</span><span>${rupees(s!.max)}</span></span>`
      : ""
  }</span>`;
  const q = `${i.item} ${i.en}`.toLowerCase() + ` ${i.te}`;
  return html`<li data-item="${i.item}" data-en="${i.en}" data-price="${i.price}" data-deal="${deal}" data-q="${q}"${
    rare ? raw(" data-rare hidden") : ""
  }>${linkOr(pathForItem(i.item), "row", label, inner)}</li>`;
}

function itemList(items: ListItem[], changes: Move[], branch: boolean, old: boolean): Html {
  const sorted = [...items].sort((a, b) => a.en.localeCompare(b.en));
  const deals = new Map([...items].sort(compareDeals).map((i, n) => [i.item, n]));
  const moves = new Map(changes.map((m) => [m.item, m]));
  return html`<ul id="prices" class="prices${old ? " old" : ""}" aria-label="Prices">${sorted.map((i) =>
    itemRow(i, moves.get(i.item), branch, deals.get(i.item)!),
  )}</ul>`;
}

/** Search and sort, as on the live site. Home: the branch picker chip; a branch: back to all and best deals. */
function controls(branch: boolean, hasMarkets: boolean): Html {
  return html`<div class="controls" id="controls">
      <div class="wrap controls-inner">
        <label class="search">
          ${icon.search}
          <span class="sr">Search vegetables</span>
          <input id="search" type="search" placeholder="Search · టమాటా, onion, beans" autocomplete="off" enterkeyhint="search" />
        </label>
        <div class="chips" role="group" aria-label="Sort">
          <button type="button" class="chip" data-sort="az" aria-pressed="true">A–Z</button>
          <button type="button" class="chip" data-sort="cheap" aria-pressed="false">Cheapest first</button>
          ${
            branch
              ? html`<a class="chip" href="/">All branches</a>
          <button type="button" class="chip" data-sort="deals" aria-pressed="false">Best deals here</button>`
              : html`<button type="button" class="chip chip-bazar" id="bazar-chip" aria-haspopup="dialog"${hasMarkets ? "" : raw(" disabled")}>
            <span>Choose a branch</span>${icon.down}
          </button>`
          }
        </div>
      </div>
    </div>`;
}

const notice = (title: string, text: string, warn = false) =>
  html`<div class="card notice${warn ? " warn" : ""}"><h2>${title}</h2><p>${text}</p></div>`;

/** What app.js needs about every branch: the picker, "near me", distances. */
const marketsData = (markets: Market[]) =>
  markets.map(({ id, name, slug, district, lat, lng, lastReportedDate, itemCount }) => ({
    id,
    name,
    slug,
    district,
    lat,
    lng,
    lastReportedDate,
    itemCount,
  }));

const marketsSheet = html`<dialog id="markets" class="sheet" aria-labelledby="mk-title">
      <div class="sheet-grip" aria-hidden="true"></div>
      <div class="sheet-head">
        <div class="sheet-title"><h2 id="mk-title">Choose a branch</h2></div>
        <button type="button" class="icon-btn" data-close aria-label="Close">${icon.close}</button>
      </div>
      <div class="sheet-near" id="mk-near" hidden></div>
      <div class="sheet-search">
        <label class="search">
          ${icon.search}
          <span class="sr">Search branches</span>
          <input id="mk-search" type="search" placeholder="Search branches or districts" autocomplete="off" />
        </label>
      </div>
      <div class="sheet-body" id="mk-body"></div>
    </dialog>`;

const checkedText = (iso: string | null) => (iso ? ` · checked ${istTime(iso)}` : "");

// ---------- Home ----------

export function homePage(ctx: Ctx, o: Overview, markets: Market[]): string {
  const items: ListItem[] = o.items.map((i) => ({
    item: i.item,
    en: i.en,
    te: i.te,
    color: i.color,
    price: i.min,
    stats: { min: i.min, max: i.max, median: i.median, markets: i.markets },
    cheapest: i.cheapest,
    trend: i.trend ?? [],
  }));
  const checked = checkedText(o.lastCheckedAt);
  const fresh = items.length
    ? html`<p class="fresh${o.reportedToday === 0 ? " stale" : ""}" id="fresh" role="status" aria-live="polite">${o.reportedToday} of ${o.markets} branches reported today${checked}</p>`
    : html`<p class="fresh stale" id="fresh" role="status" aria-live="polite">No branch has posted rates yet${checked}</p>`;
  const staples = STAPLES.map(([key, name]) => [o.items.find((i) => i.item === key), name] as const)
    .filter(([i]) => i)
    .map(([i, name]) => `${lower(name)} ${range(i!.min, i!.max)}`);
  const body = html`<header class="top">
      <div class="wrap top-inner">
        <div class="eyebrow"><span>Rythu Bazar Prices</span><span>${fmtDate(o.today)}</span></div>
        <div class="title">
          <h1 class="market-name">Today's rates</h1>
          <p class="market-sub">Price ranges across Telangana's Rythu Bazars</p>
        </div>
        ${fresh}
        ${board(items, o.movers ?? [], false)}
      </div>
    </header>

    <!-- "Near me": an invite, or a link to the nearest branch (app.js). -->
    <div class="near-ask" id="near-ask" hidden></div>

    ${items.length ? controls(false, markets.length > 0) : ""}

    <main class="wrap main">
      <div id="notice">${
        items.length ? "" : notice("No rates yet", "Branches usually post rates by 1 PM. Check back then for today's rates.")
      }</div>
      ${itemList(items, o.changes ?? [], false, false)}
      <p id="empty" class="card empty" hidden></p>
    </main>

    ${footer(true)}
    ${marketsSheet}`;
  return layout(ctx, {
    path: "/",
    title: "Rythu Bazar rates today | Vegetable prices in Hyderabad & Telangana",
    description: staples.length
      ? `${fmtDay(o.today)}: ${staples.join(", ")} a kg at Telangana's Rythu Bazars. Every branch's rates, updated through the day.`
      : "Today's vegetable rates at every Telangana Rythu Bazar, updated through the day.",
    page: "home",
    body,
    data: {
      today: o.today,
      markets: marketsData(markets),
      missing: (o.missing ?? []).map((m) => ({ ...m, path: pathForItem(m.item) })),
    },
  });
}

// ---------- One branch ----------

export function branchPage(ctx: Ctx, p: Prices, m: Market, markets: Market[]): string {
  const { date, isToday, today, market } = p;
  const label = bazarLabel(m.name, m.district);
  const items: ListItem[] = p.items.map((i) => ({ ...i, trend: i.trend ?? [] }));
  const hasRates = Boolean(date) && items.length > 0;
  const checked = checkedText(market.lastCheckedAt);
  let fresh: Html;
  let alert: Html | string = "";
  if (!hasRates) {
    fresh = html`<p class="fresh stale" id="fresh">No rates in ${daysBetween(TRACKING_START, today)}+ days${checked}</p>`;
    alert = notice(
      "No rates from this branch yet",
      `It hasn't posted rates since we started checking on ${fmtDate(TRACKING_START)}. We check every 30 minutes, so its rates show here once it does.`,
    );
  } else if (isToday) {
    // One span: .fresh is a flex row, and a bare <time> would sit apart from its words.
    fresh = html`<p class="fresh" id="fresh"><span>Today's rates${p.updatedAt ? html` · updated ${ago(p.updatedAt)}` : ""}</span></p>`;
  } else {
    const days = daysBetween(date!, today);
    fresh = html`<p class="fresh stale" id="fresh">${days === 1 ? "Not updated today" : `Not updated in ${days} days`} · showing ${fmtDate(date!)}${checked}</p>`;
    alert = notice(
      `Rates from ${fmtDate(date!)}`,
      `${market.name} hasn't posted today's rates yet. These are its latest, so today's may differ.`,
      true,
    );
  }

  const located = (x: Market) => x.lat != null && x.lng != null;
  const here = located(m) ? { lat: m.lat!, lng: m.lng! } : null;
  const near = here
    ? markets
        .filter((x) => x.id !== m.id && located(x))
        .map((x) => ({ ...x, km: km(here, { lat: x.lat!, lng: x.lng! }) }))
        .sort((a, b) => a.km - b.km)
        .slice(0, 5)
    : [];
  const siblings = markets.filter((x) => x.districtId === m.districtId && x.id !== m.id);

  const staples = ["Tomato", "Onions-I", "Potato"]
    .map((k) => items.find((i) => i.item === k))
    .filter((i): i is ListItem => !!i);
  const quoted = (staples.length ? staples : items.filter((i) => !UNIT_VARIES.has(i.item)).slice(0, 3)).map(
    (i) => `${lower(i.en)} ${rupees(i.price)}`,
  );
  const description = hasRates
    ? `${isToday ? fmtDay(date!) : `Latest rates, ${fmtDay(date!)}`}: ${quoted.join(", ")} a kg. All ${items.length} rates at ${label}, updated through the day.`
    : `${label} hasn't posted rates since tracking began on ${fmtDay(TRACKING_START)}. See rates at nearby branches.`;

  const body = html`<header class="top">
      <div class="wrap top-inner">
        <div class="eyebrow"><span>Rythu Bazar Prices</span><span>${fmtDate(today)}</span></div>
        <div class="title">
          <a class="back-btn" href="/">${icon.back}All branches</a>
          <p class="near-line" id="near-line" hidden></p>
          <div class="title-row">
            <div class="title-text">
              <h1 class="market-name">${market.name}</h1>
              <p class="market-sub">${market.district}${hasRates ? ` · ${plural(items.length, "item")}` : ""}</p>
            </div>
            ${
              here
                ? html`<a class="dir-btn" href="https://www.google.com/maps/dir/?api=1&amp;destination=${here.lat},${here.lng}" target="_blank" rel="noopener" aria-label="Directions to ${label} (opens Google Maps)" title="Directions">${icon.directions}</a>`
                : ""
            }
          </div>
        </div>
        ${fresh}
        ${hasRates ? board(items, p.movers ?? [], true) : ""}
      </div>
    </header>

    ${hasRates ? controls(true, true) : ""}

    <main class="wrap main">
      <div id="notice">${alert}</div>
      ${itemList(items, p.changes ?? [], true, hasRates && !isToday)}
      <p id="empty" class="card empty" hidden></p>
      ${
        near.length
          ? html`<section class="more" aria-labelledby="near-h">
        <h2 class="section-label" id="near-h">Branches near ${market.name}</h2>
        <ul class="prices">${near.map((x) => {
          const a = age(x.lastReportedDate, today);
          return html`<li><a class="row near-row" href="/branches/${x.slug}"><span class="what"><span class="en">${branchName(x.name, x.district)}</span><span class="sub">about ${kmText(x.km)}</span></span><span class="tag ${a.tone}">${a.text}</span></a></li>`;
        })}</ul>
        <p class="note">Straight-line distance from this branch.</p>
      </section>`
          : ""
      }
      ${
        siblings.length
          ? html`<section class="more" aria-labelledby="district-h">
        <h2 class="section-label" id="district-h">Other branches in ${market.district}</h2>
        <div class="chip-wrap">${siblings.map((x) => html`<a class="chip" href="/branches/${x.slug}">${shortName(x.name, x.district)}</a>`)}</div>
      </section>`
          : ""
      }
      <section class="card about" aria-labelledby="about-h">
        <h2 class="section-label" id="about-h">About ${label}</h2>
        <p>A government-run farmers' market in ${market.district} district. It posts its rates each day on the Telangana Agricultural Marketing Department's Rythu Bazar Information System, and this page checks for them every 30 minutes.</p>
      </section>
    </main>

    ${footer(true)}`;
  return layout(ctx, {
    path: `/branches/${m.slug}`,
    title: `${label} rates today | Vegetable prices`,
    description,
    page: "branch",
    attrs: { id: m.id },
    body,
    noindex: !hasRates,
    jsonLd: [crumbs(ctx, [[SITE, "/"], ["Branches", "/branches"], [label, `/branches/${m.slug}`]])],
    data: { today, id: m.id, markets: marketsData(markets) },
  });
}

// ---------- One vegetable ----------

export interface VegRow {
  id: number;
  slug: string;
  name: string; // branchName: stands alone across Telangana
  district: string;
  lat: number | null;
  lng: number | null;
  date: string;
  price: number;
  updatedAt: string;
}

export interface VegData {
  today: string;
  key: string; // the ITEMS key
  rows: VegRow[]; // each branch's latest rate from the last 3 days
  days: DayStat[]; // usable days of typical prices, oldest first
  last: DayStat | null; // the latest day on record, however thin: for items nobody posted lately
  variants: { en: string; min: number; max: number; markets: number }[];
  others: { key: string; min: number; max: number; markets: number }[];
}

// Chart geometry, in SVG units; the SVG is 96 px tall and stretches to the header's width.
const CH = { W: 358, H: 96, L: 6, R: 6, TOP: 16, BOTTOM: 80 };
const RANGES: [string, number][] = [
  ["1W", 7],
  ["1M", 30],
  ["3M", 91],
  ["1Y", 365],
];

/** The chart periods worth offering: each one longer than the history stops the list (it would repeat the last). */
export function chartRanges(days: { date: string }[]): { key: string; from: number }[] {
  if (days.length < 3) return [];
  const last = days[days.length - 1].date;
  const out: { key: string; from: number }[] = [];
  for (const [key, n] of RANGES) {
    const start = addDays(last, -n);
    const from = days.findIndex((d) => d.date >= start);
    if (days.length - from >= 2) out.push({ key, from });
    if (days[0].date >= start) break;
  }
  return out;
}

/** "Typical today", "Typical yesterday", "Typical · 17 Oct": what the headline price is. */
const typicalLabel = (date: string, today: string) => {
  const n = daysBetween(date, today);
  return n === 0 ? "Typical today" : n === 1 ? "Typical yesterday" : `Typical · ${fmtDay(date)}`;
};

/** The change from a range's first day to `now`, as the header shows it. */
export function changeText(start: { date: string; median: number }, now: { median: number }, key: string) {
  const diff = now.median - start.median;
  if (diff === 0) return { text: `Same as ${fmtDay(start.date)}`, tone: "" };
  const pct = Math.round((Math.abs(diff) / start.median) * 100);
  return {
    text: `${diff < 0 ? "▼" : "▲"} ${rupees(Math.abs(diff))} · ${pct}% ${key === "1W" ? "past week" : `since ${fmtDay(start.date)}`}`,
    tone: diff < 0 ? "down" : "up",
  };
}

function trend(days: DayStat[], from: number, key: string, name: string, shown: boolean): Html {
  const pts = days.slice(from);
  const vals = pts.map((d) => d.median);
  const mx = Math.max(...vals);
  const mn = Math.min(...vals);
  const x = (i: number) => CH.L + (i / (pts.length - 1)) * (CH.W - CH.L - CH.R);
  const y = (v: number) => (mx === mn ? (CH.TOP + CH.BOTTOM) / 2 : CH.TOP + (1 - (v - mn) / (mx - mn)) * (CH.BOTTOM - CH.TOP));
  const pct = (i: number) => `${((x(i) / CH.W) * 100).toFixed(2)}%`;
  // Low/high labels sit over the SVG as HTML, so they don't stretch with it.
  const label = (i: number, top: number, text: string) => {
    const shift = i === 0 ? "0" : i === pts.length - 1 ? "-100%" : "-50%";
    return html`<span class="trend-label" aria-hidden="true" style="left:${pct(i)};top:${top.toFixed(1)}px;transform:translateX(${shift})">${text}</span>`;
  };
  const hi = vals.indexOf(mx);
  const lo = vals.lastIndexOf(mn);
  const lastI = pts.length - 1;
  const since = key === "1W" ? "over the past week" : `since ${fmtDay(pts[0].date)}`;
  return html`<div class="trend" data-range="${key}" data-from="${from}"${shown ? "" : raw(" hidden")}>
          <svg viewBox="0 0 ${CH.W} ${CH.H}" preserveAspectRatio="none" role="img" aria-label="Typical ${lower(name)} price ${since}: from ${rupees(vals[0])} to ${rupees(vals[lastI])} a kilo. Low ${rupees(mn)}, high ${rupees(mx)}.">
            <line class="trend-base" x1="0" x2="${CH.W}" y1="${y(vals[0]).toFixed(1)}" y2="${y(vals[0]).toFixed(1)}" vector-effect="non-scaling-stroke"></line>
            <polyline class="trend-line" points="${vals.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ")}" vector-effect="non-scaling-stroke"></polyline>
          </svg>
          <span class="trend-cursor" aria-hidden="true" hidden></span>
          <span class="trend-dot" aria-hidden="true" style="left:${pct(lastI)};top:${y(vals[lastI]).toFixed(1)}px"></span>
          ${mx > mn ? [label(hi, y(mx) - 18, rupees(mx)), label(lo, y(mn) + 6, rupees(mn))] : label(lastI, y(mx) - 18, rupees(mx))}
        </div>`;
}

/** The answer sentences: built from the day's numbers, so they're never stale or generic. */
function vegFaq(d: VegData, name: string, unitVaries: boolean): [string, string][] {
  const out: [string, string][] = [];
  const n = lower(name);
  const { rows, today } = d;
  const prices = rows.map((r) => r.price);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  if (!rows.length) {
    out.push([
      `What is the ${n} price today?`,
      `No Rythu Bazar has posted a ${n} rate in the last 3 days.${
        d.last ? ` The last was ${range(d.last.min ?? d.last.median, d.last.max ?? d.last.median)} a kg on ${fmtDate(d.last.date)}.` : ""
      }`,
    ]);
  } else if (unitVaries) {
    out.push([
      `What is the ${n} price today?`,
      `${rupees(min)} to ${rupees(max)} at Telangana's Rythu Bazars on ${fmtDate(today)}. Some branches sell it per piece or bunch rather than per kg, so the rates don't compare directly.`,
    ]);
  } else {
    const hyd = rows.filter(inHyderabad);
    const hp = hyd.map((r) => r.price);
    let city = "";
    if (hyd.length) {
      const hmin = Math.min(...hp);
      const hmax = Math.max(...hp);
      if (hyd.length === 1) city = ` It's ${rupees(hmin)} at ${hyd[0].name}, the one Hyderabad branch with a recent rate.`;
      else if (hmin === hmax) city = ` It's ${rupees(hmin)} at all ${hyd.length} Hyderabad branches with recent rates.`;
      else city = ` In Hyderabad it's ${rupees(hmin)} to ${rupees(hmax)} across ${hyd.length} branches.`;
    }
    out.push([
      `What is the ${n} price today?`,
      (min === max
        ? `${rupees(min)} a kg at all ${rows.length} Rythu Bazars with recent rates on ${fmtDate(today)}.`
        : `${rupees(min)} to ${rupees(max)} a kg at Telangana's Rythu Bazars on ${fmtDate(today)}.`) + city,
    ]);
  }

  const days = d.days;
  if (!unitVaries && days.length >= 2) {
    const last = days[days.length - 1];
    const prev = days[days.length - 2];
    const week = [...days].reverse().find((x) => x.date <= addDays(last.date, -7));
    const cmp = (diff: number, when: string) =>
      diff === 0 ? `the same as ${when}` : `${rupees(Math.abs(diff))} ${diff < 0 ? "less" : "more"} than ${when}`;
    const isToday = last.date === today;
    const prevWhen = daysBetween(prev.date, last.date) === 1 ? (isToday ? "yesterday" : "the day before") : `on ${fmtDay(prev.date)}`;
    const dy = last.median - prev.median;
    const dw = week ? last.median - week.median : dy;
    let weekPart = "";
    if (week) {
      weekPart =
        daysBetween(week.date, last.date) === 7
          ? ` and ${cmp(dw, "a week ago")} (${rupees(week.median)} on ${fmtDay(week.date)})`
          : ` and ${cmp(dw, `on ${fmtDay(week.date)}`)}`;
    }
    out.push([
      dw < 0 ? `Is ${n} getting cheaper?` : dw > 0 ? `Is ${n} getting costlier?` : `Has the ${n} price changed?`,
      `The typical rate ${isToday ? "is" : "was"} ${rupees(last.median)} a kg${isToday ? "" : ` on ${fmtDay(last.date)}`}, ${cmp(dy, prevWhen)}${weekPart}.`,
    ]);
  }

  out.push([
    "Where do these rates come from?",
    "From the Telangana Agricultural Marketing Department's Rythu Bazar Information System. Branches post between about 7:30 am and 1 pm, and this page checks every 30 minutes.",
  ]);
  return out;
}

function vegDescription(d: VegData, name: string, unitVaries: boolean): string {
  const { rows } = d;
  if (!rows.length) return `${name} rates at Telangana's Rythu Bazars: every branch's latest rate and the price trend.`;
  const day = fmtDay(d.today);
  const prices = rows.map((r) => r.price);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const n = rows.length;
  if (unitVaries) {
    return `${day}: ${name} rates at ${n} Rythu Bazars, ${rupees(min)} to ${rupees(max)}. Sold per piece or bunch at some branches. Every branch's rate.`;
  }
  const hyd = rows.filter(inHyderabad);
  if (min === max) {
    return `${day}: ${name} is ${rupees(min)} a kg at all ${n} Rythu Bazars with recent rates${
      hyd.length > 1 ? `, including all ${hyd.length} in Hyderabad` : ""
    }. Every branch's rate.`;
  }
  const atMin = rows.filter((r) => r.price === min);
  const hydMin = atMin.filter(inHyderabad).length;
  const city =
    hydMin && hydMin === hyd.length && hyd.length > 1
      ? `, including all ${hyd.length} in Hyderabad`
      : hydMin
        ? `, including ${plural(hydMin, "branch", "branches")} in Hyderabad`
        : "";
  const maxPlaces = new Set(rows.filter((r) => r.price === max).map((r) => placeOf(r.district)));
  const where = maxPlaces.size === 1 ? ` in ${[...maxPlaces][0]}` : "";
  return `${day}: ${name} is ${rupees(min)} a kg at ${atMin.length} of ${n} Rythu Bazars${city}; up to ${rupees(max)}${where}. Every branch's rate, cheapest first.`;
}

export function vegetablePage(ctx: Ctx, d: VegData): string {
  const [name, te] = ITEMS[d.key];
  const slug = itemSlug(d.key);
  const unitVaries = UNIT_VARIES.has(d.key);
  const { rows, today, days } = d;
  const prices = rows.map((r) => r.price);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const postedToday = rows.filter((r) => r.date === today);

  // Cheapest first, then the freshest, then by name: the order the page opens in.
  const sorted = [...rows].sort(
    (a, b) => a.price - b.price || daysBetween(a.date, today) - daysBetween(b.date, today) || a.name.localeCompare(b.name),
  );

  const ranges = unitVaries ? [] : chartRanges(days);
  const shown = ranges.find((r) => r.key === "1M") ?? ranges[ranges.length - 1];
  const lastDay = days[days.length - 1];

  // Headline: the latest typical price, or with no usable history, the middle of today's rates.
  let headline: Html | string = "";
  if (unitVaries) {
    headline = html`<p class="veg-note">Sold per piece or bunch at some branches, so there's no typical price.</p>`;
  } else if (lastDay || rows.length) {
    const typical = lastDay?.median ?? [...prices].sort((a, b) => a - b)[prices.length >> 1];
    const chg = shown ? changeText(days[shown.from], lastDay, shown.key) : null;
    headline = html`<div class="veg-price">
            <span class="veg-when" id="veg-when">${lastDay ? typicalLabel(lastDay.date, today) : "Typical rate"}</span>
            <span class="num veg-num"><span id="veg-num">${rupees(typical)}</span><span class="unit">/kg</span></span>
            ${chg ? html`<span class="chg ${chg.tone}" id="veg-chg">${chg.text}</span>` : ""}
          </div>`;
  }

  let updated: Html;
  if (postedToday.length) {
    const latest = postedToday.reduce((t, r) => (r.updatedAt > t ? r.updatedAt : t), "");
    updated = html`<p class="fresh"><span>Updated ${ago(latest)}</span></p>`;
  } else if (rows.length) {
    const latest = rows.reduce((t, r) => (r.date > t ? r.date : t), "");
    updated = html`<p class="fresh stale">Latest rates from ${fmtDate(latest)}</p>`;
  } else updated = html`<p class="fresh stale">No rates in the last 3 days</p>`;

  const chart = ranges.length
    ? html`<div class="trend-wrap" id="trend">${ranges.map((r) => trend(days, r.from, r.key, name, r === shown))}</div>`
    : unitVaries
      ? ""
      : html`<p class="chart-note">A price chart appears here once there are 3 days of rates.</p>`;

  const heading = !rows.length
    ? `No branch has posted ${lower(name)} in the last 3 days`
    : `${
        unitVaries
          ? plural(rows.length, "branch", "branches")
          : min === max && rows.length > 1
            ? `${rupees(min)} at all ${rows.length} branches`
            : `${range(min, max)} at ${plural(rows.length, "branch", "branches")}`
      } · ${postedToday.length} posted today`;

  const row = (r: VegRow) => {
    const n = daysBetween(r.date, today);
    const when = n <= 0 ? html`Updated ${ago(r.updatedAt)}` : n === 1 ? "Yesterday" : `${n} days ago`;
    const lowest = !unitVaries && max > min && r.price === min;
    return html`<li data-price="${r.price}" data-age="${n}" data-name="${r.name}"${
      r.lat != null && r.lng != null ? html` data-lat="${r.lat}" data-lng="${r.lng}"` : ""
    }><a class="row br-row" href="/branches/${r.slug}"><span class="what"><span class="en">${r.name}</span><span class="sub">${r.district}<span class="km"></span></span><span class="when${n <= 0 ? " fresh-when" : ""}">${when}</span></span><span class="cost"><span class="num">${rupees(r.price)}${
      unitVaries ? "" : html`<span class="unit">/kg</span>`
    }</span>${lowest ? html`<span class="badge good">Lowest</span>` : ""}</span></a></li>`;
  };

  const variants = d.variants.map((v) => `${v.en}, a variety, ${range(v.min, v.max)} at ${plural(v.markets, "branch", "branches")}`);
  const faq = vegFaq(d, name, unitVaries);
  const others = d.others.filter((o) => o.key !== d.key);

  const body = html`<header class="top">
      <div class="wrap top-inner veg-top">
        <div class="top-row">
          <a class="back-btn" href="/">${icon.back}All vegetables</a>
          <span class="eyebrow">${fmtDate(today)}</span>
        </div>
        <div class="veg-head">
          <div class="veg-name">
            <h1 class="market-name">${name}</h1>
            <span class="te">${te}</span>
          </div>
          ${headline}
        </div>
        ${chart}
        <div class="trend-foot">
          ${
            ranges.length > 1
              ? html`<div class="ranges" role="group" aria-label="Chart period">${ranges.map(
                  (r) => html`<button type="button" class="range-chip" data-range="${r.key}" aria-pressed="${String(r === shown)}">${r.key}</button>`,
                )}</div>`
              : ""
          }
          ${updated}
        </div>
      </div>
    </header>

    ${
      rows.length
        ? html`<div class="controls">
      <div class="wrap controls-inner">
        <h2 class="section-label">${heading}</h2>
        <div class="chips" role="group" aria-label="Sort">
          <button type="button" class="chip" data-vsort="cheap" aria-pressed="true">Cheapest first</button>
          <button type="button" class="chip chip-near" data-vsort="near" aria-pressed="false" hidden>${icon.pin}<span>Nearest</span></button>
          <button type="button" class="chip" data-vsort="az" aria-pressed="false">A–Z</button>
        </div>
        <p class="near-msg" id="near-msg" role="status" hidden></p>
      </div>
    </div>`
        : ""
    }

    <main class="wrap main">
      ${
        rows.length
          ? html`<section aria-label="${name} rate at each branch">
        <ul class="prices" id="branches">${sorted.map(row)}</ul>
        <p class="note">Each branch's latest rate from the last 3 days.${variants.length ? ` Also listed: ${variants.join("; ")}.` : ""}</p>
      </section>`
          : html`<div class="card notice"><h2>${heading}</h2><p>${faq[0][1]}</p></div>`
      }

      <section class="more" aria-labelledby="faq-h">
        <h2 class="section-label" id="faq-h">Questions</h2>
        <div class="card faq">${faq.map(([q, a]) => html`<div><h3>${q}</h3><p>${a}</p></div>`)}</div>
      </section>

      ${
        others.length
          ? html`<section class="more" aria-labelledby="others-h">
        <h2 class="section-label" id="others-h">Other vegetables today</h2>
        <ul class="veg-grid">${others.map((o) => {
          const [en, ote] = ITEMS[o.key];
          return html`<li><a href="/vegetables/${itemSlug(o.key)}"><span class="what"><span class="en">${en}</span><span class="te">${ote}</span></span><span class="num">${
            UNIT_VARIES.has(o.key) ? "" : range(o.min, o.max)
          }</span></a></li>`;
        })}</ul>
      </section>`
          : ""
      }
    </main>

    ${footer(false)}`;

  return layout(ctx, {
    path: `/vegetables/${slug}`,
    title: `${name} price today in Hyderabad & Telangana | ${SITE}`,
    description: vegDescription(d, name, unitVaries),
    page: "vegetable",
    body,
    noindex: !rows.length,
    jsonLd: [
      crumbs(ctx, [[SITE, "/"], ["Vegetables", "/vegetables"], [name, `/vegetables/${slug}`]]),
      {
        "@context": "https://schema.org",
        "@type": "FAQPage",
        mainEntity: faq.map(([q, a]) => ({ "@type": "Question", name: q, acceptedAnswer: { "@type": "Answer", text: a } })),
      },
    ],
    data: { today, days: days.map(({ date, median }) => ({ date, median })) },
  });
}

// ---------- Hubs ----------

function hubHeader(today: string, title: string, sub: string): Html {
  return html`<header class="top">
      <div class="wrap top-inner">
        <div class="eyebrow"><span>Rythu Bazar Prices</span><span>${fmtDate(today)}</span></div>
        <div class="title">
          <a class="back-btn" href="/">${icon.back}Today's rates</a>
          <h1 class="market-name">${title}</h1>
          ${sub ? html`<p class="market-sub">${sub}</p>` : ""}
        </div>
      </div>
    </header>`;
}

/** Every listed vegetable, with today's range where there is one. */
export function vegetablesHub(ctx: Ctx, o: Overview): string {
  const stats = new Map(o.items.map((i) => [i.item, i]));
  const keys = Object.keys(ITEMS).sort((a, b) => ITEMS[a][0].localeCompare(ITEMS[b][0]));
  const body = html`${hubHeader(o.today, "Vegetables", "Today's price ranges across Telangana's Rythu Bazars")}
    <main class="wrap main">
      <ul class="prices">${keys.map((key) => {
        const [en, te, color] = ITEMS[key];
        const s = stats.get(key);
        const unitVaries = UNIT_VARIES.has(key);
        const sub = s ? plural(s.markets, "branch", "branches") : "No rates in the last 3 days";
        const price = s ? (unitVaries ? "" : range(s.min, s.max)) : "";
        return html`<li><a class="row" href="/vegetables/${itemSlug(key)}">${tile(en, te, color)}<span class="what"><span class="en">${en}</span><span class="te">${te}</span><span class="badge plain">${sub}</span></span><span class="cost">${
          price ? html`<span class="num${price.length > 5 ? " small" : ""}">${price}<span class="unit">/kg</span></span>` : ""
        }</span></a></li>`;
      })}</ul>
    </main>
    ${footer(false)}`;
  return layout(ctx, {
    path: "/vegetables",
    title: `Vegetable prices today in Hyderabad & Telangana | ${SITE}`,
    description: `${fmtDay(o.today)}: today's rate for each of ${Object.keys(ITEMS).length} vegetables at Telangana's Rythu Bazars, with every branch's price.`,
    page: "hub",
    body,
    jsonLd: [crumbs(ctx, [[SITE, "/"], ["Vegetables", "/vegetables"]])],
  });
}

/** Every branch by district, with how fresh its rates are. */
export function branchesHub(ctx: Ctx, today: string, markets: Market[]): string {
  const districts = [...new Set(markets.map((m) => m.district))];
  const reporting = markets.filter((m) => m.lastReportedDate === today).length;
  const body = html`${hubHeader(today, "Branches", `All ${markets.length} Rythu Bazars in Telangana · ${reporting} reported today`)}
    <main class="wrap main">
      ${districts.map(
        (dist) => html`<section class="more" aria-label="${dist}">
        <h2 class="section-label">${dist}</h2>
        <ul class="prices">${markets
          .filter((m) => m.district === dist)
          .map((m) => {
            const a = age(m.lastReportedDate, today);
            return html`<li><a class="row near-row" href="/branches/${m.slug}"><span class="what"><span class="en">${shortName(m.name, m.district)}</span>${
              m.lastReportedDate ? html`<span class="sub">${plural(m.itemCount, "item")}</span>` : ""
            }</span><span class="tag ${a.tone}">${a.text}</span></a></li>`;
          })}</ul>
      </section>`,
      )}
    </main>
    ${footer(false)}`;
  return layout(ctx, {
    path: "/branches",
    title: `Rythu Bazar branches in Telangana | ${SITE}`,
    description: `All ${markets.length} Rythu Bazars in Telangana by district, with each branch's vegetable rates. ${reporting} reported on ${fmtDay(today)}.`,
    page: "hub",
    body,
    jsonLd: [crumbs(ctx, [[SITE, "/"], ["Branches", "/branches"]])],
  });
}

// ---------- Errors ----------

export function messagePage(ctx: Ctx, today: string, path: string, title: string, text: string): string {
  const body = html`${hubHeader(today, title, "")}
    <main class="wrap main">
      <div class="card notice"><p>${text}</p></div>
    </main>
    ${footer(false)}`;
  return layout(ctx, { path, title: `${title} | ${SITE}`, description: text, page: "message", body, noindex: true });
}
