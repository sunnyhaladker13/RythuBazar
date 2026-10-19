// The site's pages: which URL shows what, and the data behind each (src/pages.ts renders them).
// A page view reads 1–2 D1 rows: everything comes from snapshots (src/snapshot.ts).
//
//   /                      all branches (home)        /?market=<id> → 301 to the branch page
//   /vegetables            every vegetable            /vegetables/<slug>  one vegetable everywhere
//   /branches              every branch by district   /branches/<slug>    one branch's rates
//   /sitemap.xml, /robots.txt

import {
  LATEST,
  flatMarkets,
  marketsBody,
  overviewBody,
  pricesBody,
  usableDays,
  windowStart,
  type ApiEnv,
  type DayStat,
  type Market,
  type Markets,
  type Overview,
  type Prices,
} from "./api";
import { branchName } from "./branches";
import { addDays } from "./format";
import { ITEMS, RARE, baseItem, itemBySlug, itemSlug } from "./items";
import {
  branchPage,
  branchesHub,
  homePage,
  messagePage,
  vegetablePage,
  vegetablesHub,
  type Ctx,
  type VegData,
} from "./pages";
import { istDate } from "./scraper/tick";
import { snapshot } from "./snapshot";

export interface SiteEnv extends ApiEnv {
  /**
   * The site's one public address, e.g. "https://rythubazarrates.in". Canonical links and the
   * sitemap use it, and pages requested on any other host (workers.dev) redirect there.
   * Empty: each request's own origin, no redirects.
   */
  SITE_ORIGIN?: string;
}

const HTML_HEADERS = { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "public, max-age=60" };
const htmlResponse = (body: string, status = 200) => new Response(body, { status, headers: HTML_HEADERS });
const redirect = (to: string) => new Response(null, { status: 301, headers: { Location: to } });

const markets = async (env: SiteEnv) => flatMarkets(JSON.parse(await marketsBody(env)) as Markets);
const overview = async (env: SiteEnv) => JSON.parse(await overviewBody(env)) as Overview;
const vegetable = async (env: SiteEnv, key: string) =>
  JSON.parse(await snapshot(env.DB, `item:${key}`, () => buildVegetable(env, key))) as VegData;

const isLocal = (url: URL) => ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);

/** The response for a page URL, or null when the path isn't a page (static files, /api/*). */
export async function handleSite(req: Request, env: SiteEnv, url: URL): Promise<Response | null> {
  if (req.method !== "GET" && req.method !== "HEAD") return null;
  const path = url.pathname;
  const route = path.match(/^\/(vegetables|branches)(?:\/([^/]*))?\/?$/i);
  const isPage = path === "/" || !!route || path === "/sitemap.xml" || path === "/robots.txt";
  if (!isPage) return null;

  const origin = env.SITE_ORIGIN?.replace(/\/$/, "") || url.origin;
  if (origin !== url.origin && !isLocal(url)) return redirect(origin + path + url.search);
  const ctx: Ctx = { origin };
  // One URL per page: no trailing slash, lower case.
  if (route && (path.endsWith("/") || path !== path.toLowerCase())) {
    return redirect(path.toLowerCase().replace(/\/+$/, "") + url.search);
  }

  try {
    if (path === "/robots.txt") {
      return new Response(`User-agent: *\nAllow: /\nDisallow: /api/\n\nSitemap: ${origin}/sitemap.xml\n`, {
        headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=3600" },
      });
    }
    if (path === "/sitemap.xml") return sitemap(env, origin);

    if (path === "/") {
      const all = await markets(env);
      // Old shared links (WhatsApp) used ?market=<id>.
      const id = url.searchParams.get("market");
      if (id) {
        const m = all.find((x) => String(x.id) === id);
        return redirect(m ? `/branches/${m.slug}` : "/");
      }
      return htmlResponse(homePage(ctx, await overview(env), all));
    }

    const [, section, slug] = route!;
    if (section === "vegetables") {
      if (slug === undefined) return htmlResponse(vegetablesHub(ctx, await overview(env)));
      const key = itemBySlug(slug);
      if (key) return htmlResponse(vegetablePage(ctx, await vegetable(env, key)));
    } else {
      const all = await markets(env);
      if (slug === undefined) return htmlResponse(branchesHub(ctx, istDate(new Date()), all));
      const m = all.find((x) => x.slug === slug);
      if (m) {
        const prices = JSON.parse(await pricesBody(env, m.id)) as Prices | null;
        if (prices) return htmlResponse(branchPage(ctx, prices, m, all));
      }
    }
    return notFound(ctx, path);
  } catch (err) {
    console.error(JSON.stringify({ event: "page_failed", path, error: String(err) }));
    return new Response(
      messagePage(ctx, istDate(new Date()), path, "Couldn't load rates", "Something went wrong on our side. Try again in a minute."),
      { status: 503, headers: { ...HTML_HEADERS, "Cache-Control": "no-store", "Retry-After": "60" } },
    );
  }
}

export const notFound = (ctx: Ctx, path: string) =>
  htmlResponse(
    messagePage(
      ctx,
      istDate(new Date()),
      path,
      "Page not found",
      "There's no page at this address. Today's rates for every vegetable and branch are on the home page.",
    ),
    404,
  );

/** One vegetable at every branch that posted it in the last 3 days, plus its history. ~40 + ~1 row/day read. */
async function buildVegetable(env: SiteEnv, key: string): Promise<VegData> {
  const today = istDate(new Date());
  const [o, all] = await Promise.all([overview(env), markets(env)]);
  const [rows, history] = await env.DB.batch([
    env.DB.prepare(
      `${LATEST}
       SELECT p.market_id AS marketId, p.date, p.price, p.updated_at AS updatedAt
         FROM latest l
        CROSS JOIN prices p ON p.market_id = l.market_id AND p.date = l.date AND p.item = ?2`,
    ).bind(windowStart(), key),
    env.DB.prepare(`SELECT item, date, median, min, max, markets FROM daily_stats WHERE item = ?1 AND date >= ?2 ORDER BY date`).bind(
      key,
      addDays(today, -366),
    ),
  ]);
  const byId = new Map(all.map((m) => [m.id, m]));
  const days = history.results as DayStat[];
  return {
    today,
    key,
    rows: (rows.results as { marketId: number; date: string; price: number; updatedAt: string }[])
      .filter((r) => byId.has(r.marketId))
      .map((r) => {
        const m = byId.get(r.marketId) as Market;
        return {
          id: m.id,
          slug: m.slug,
          name: branchName(m.name, m.district),
          district: m.district,
          lat: m.lat,
          lng: m.lng,
          date: r.date,
          price: r.price,
          updatedAt: r.updatedAt,
        };
      }),
    days: usableDays(days, today),
    last: days[days.length - 1] ?? null,
    variants: o.items
      .filter((i) => i.item !== key && baseItem(i.item) === key)
      .map(({ en, min, max, markets }) => ({ en, min, max, markets })),
    // The rest of the home page's list: listed items enough branches report.
    others: o.items
      .filter((i) => i.item in ITEMS && i.markets >= RARE)
      .sort((a, b) => a.en.localeCompare(b.en))
      .map(({ item, min, max, markets }) => ({ key: item, min, max, markets })),
  };
}

/** Pages with rates on them. Empty branches and vegetables nobody posted lately are noindex, so they're left out. */
async function sitemap(env: SiteEnv, origin: string): Promise<Response> {
  const [o, all] = await Promise.all([overview(env), markets(env)]);
  const today = o.today;
  const posted = new Set(o.items.map((i) => baseItem(i.item)));
  const urls: [string, string][] = [
    ["/", today],
    ["/vegetables", today],
    ["/branches", today],
    ...Object.keys(ITEMS)
      .filter((k) => posted.has(k))
      .map((k): [string, string] => [`/vegetables/${itemSlug(k)}`, today]),
    ...all.filter((m) => m.lastReportedDate).map((m): [string, string] => [`/branches/${m.slug}`, m.lastReportedDate!]),
  ];
  const body = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map(([path, date]) => `  <url><loc>${origin}${path}</loc><lastmod>${date}</lastmod></url>`).join("\n")}
</urlset>
`;
  return new Response(body, { headers: { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "public, max-age=3600" } });
}
