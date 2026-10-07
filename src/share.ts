// Link previews (WhatsApp, social). The page's Open Graph tags are filled in per
// request so the image URL is absolute on whatever domain serves the site, and a
// shared ?market= link names its bazar.

// Bump ?v= whenever og.jpg changes: WhatsApp caches previews per image URL.
const OG_IMAGE = "/og.jpg?v=1";
const DEFAULT_TITLE = "Rythu Bazar rates today";
const DEFAULT_DESCRIPTION = "Today's vegetable rates at every Telangana Rythu Bazar, updated through the day.";

export interface ShareMeta {
  title: string;
  description: string;
  url: string;
  image: string;
}

export function defaultMeta(url: URL): ShareMeta {
  return { title: DEFAULT_TITLE, description: DEFAULT_DESCRIPTION, url: `${url.origin}/`, image: url.origin + OG_IMAGE };
}

/**
 * rbzts market names are sometimes places ("Kukatpally") and sometimes spots in a
 * town ("Opp: Municipal Office"). Lead with a place either way.
 */
export function bazarLabel(name: string, district: string): string {
  const place = district.replace(/\s*\(.*\)$/, "");
  // "Ursu Premises(Nalgonda)" → "Ursu Premises"; "Kothagudem(P. Stdm)" → "Kothagudem (P. Stdm)"
  const clean = name
    .replace(/\s*\(([^)]*)\)\s*$/, (_, inner: string) => (district.includes(inner) ? "" : ` (${inner})`))
    .trim();
  const isSpot = /\b(opp|near|area|ground|premises|colony|x road|market)\b|:|^[ivx]+ /i.test(clean);
  return isSpot ? `${place} Rythu Bazar (${clean})` : `${clean} Rythu Bazar`;
}

export async function shareMeta(db: D1Database, url: URL): Promise<ShareMeta> {
  const meta = defaultMeta(url);
  const id = url.searchParams.get("market");
  if (!id || !/^\d{1,6}$/.test(id)) return meta;

  const row = await db
    .prepare("SELECT m.name, d.name AS district FROM markets m JOIN districts d ON d.id = m.district_id WHERE m.id = ?")
    .bind(Number(id))
    .first<{ name: string; district: string }>();
  if (!row) return meta;

  const label = bazarLabel(row.name, row.district);
  const place = row.district.replace(/\s*\(.*\)$/, "");
  return {
    ...meta,
    title: `${label} rates today`,
    description: `Today's vegetable rates at ${label}${label.includes(place) ? "" : `, ${place}`}, updated through the day.`,
    url: `${url.origin}/?market=${id}`,
  };
}

export function withShareTags(page: Response, meta: ShareMeta): Response {
  const content = (value: string) => ({
    element(el: Element) {
      el.setAttribute("content", value);
    },
  });
  return new HTMLRewriter()
    .on("title", {
      element(el) {
        el.setInnerContent(meta.title);
      },
    })
    .on('meta[name="description"]', content(meta.description))
    .on('meta[property="og:title"]', content(meta.title))
    .on('meta[property="og:description"]', content(meta.description))
    .on('meta[property="og:url"]', content(meta.url))
    .on('meta[property="og:image"]', content(meta.image))
    .transform(page);
}
