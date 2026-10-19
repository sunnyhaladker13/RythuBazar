// Branch names, labels and URL slugs. rbzts market names are sometimes places ("Kukatpally")
// and sometimes spots in a town ("Opp: Municipal Office"); every name a visitor sees leads with a place.

import { slugify } from "./format";

/** "Medchal (Malkajgiri)" → "Medchal" */
export const placeOf = (district: string) => district.replace(/\s*\(.*\)$/, "");

function parse(name: string, district: string) {
  // "Ursu Premises(Nalgonda)" → "Ursu Premises"; "Kothagudem(P. Stdm)" → "Kothagudem (P. Stdm)"
  const clean = name
    .replace(/\s*\(([^)]*)\)\s*$/, (_, inner: string) => (district.includes(inner) ? "" : ` (${inner})`))
    .replace(/,(?=\S)/g, ", ")
    .trim();
  const isSpot = /\b(opp|near|area|ground|premises|colony|x road|market)\b|:|^[ivx]+ /i.test(clean);
  return { place: placeOf(district), clean, isSpot };
}

/** The branch's own name without a repeated district: "Ursu Premises", "Kukatpally". For lists within one district. */
export const shortName = (name: string, district: string) => parse(name, district).clean;

/** A name that stands alone anywhere in Telangana: "Kukatpally", "Adilabad (Opp: Municipal Office)". */
export function branchName(name: string, district: string): string {
  const { place, clean, isSpot } = parse(name, district);
  return isSpot ? `${place} (${clean})` : clean;
}

/** "Kukatpally Rythu Bazar", "Adilabad Rythu Bazar (Opp: Municipal Office)": titles and link previews. */
export function bazarLabel(name: string, district: string): string {
  const { place, clean, isSpot } = parse(name, district);
  return isSpot ? `${place} Rythu Bazar (${clean})` : `${clean} Rythu Bazar`;
}

/** "kukatpally", "adilabad-municipal-office" (no "opp"/"near": they aren't what anyone searches). */
export function branchSlug(name: string, district: string): string {
  const { place, clean, isSpot } = parse(name, district);
  return slugify(isSpot ? `${place} ${clean.replace(/^(opp|near)\b\W*/i, "")}` : clean);
}

/** Adds each branch's slug; a slug two branches would share gets its rbzts id appended. */
export function withSlugs<T extends { id: number; name: string; district: string }>(list: T[]): (T & { slug: string })[] {
  const slugs = list.map((m) => branchSlug(m.name, m.district));
  return list.map((m, i) => ({
    ...m,
    slug: slugs.indexOf(slugs[i]) === slugs.lastIndexOf(slugs[i]) ? slugs[i] : `${slugs[i]}-${m.id}`,
  }));
}
