// rbzts item names → English label, Telugu name, tile colour. The API attaches these to every
// item it returns (describe), and each listed item gets a page at /vegetables/<slug>, so this file
// is the one place to add a new vegetable.

import { slugify } from "./format";

export type ItemInfo = { en: string; te: string; color: string; known: boolean };

export const ITEMS: Record<string, [en: string, te: string, color: string]> = {
  Aratikaya: ["Raw banana", "అరటికాయ", "#6f9a3b"],
  "Beet Root": ["Beetroot", "బీట్‌రూట్", "#9b1f45"],
  Bhendi: ["Okra (bhindi)", "బెండకాయ", "#5f9a3a"],
  "Bitter Gourd": ["Bitter gourd", "కాకరకాయ", "#4d7a2a"],
  "Bottle Gourd": ["Bottle gourd", "సొరకాయ", "#a8c66c"],
  Brinjal: ["Brinjal", "వంకాయ", "#5b3a78"],
  Cabbage: ["Cabbage", "క్యాబేజీ", "#9cc56b"],
  Carrot: ["Carrot", "క్యారెట్", "#f07d22"],
  Cauliflower: ["Cauliflower", "కాలీఫ్లవర్", "#e8dfbf"],
  "Cluster Beans": ["Cluster beans", "గోరుచిక్కుడు", "#6a9a40"],
  "Colocasia(Chama)": ["Colocasia (arbi)", "చామదుంప", "#7a5a44"],
  Cucumber: ["Cucumber", "దోసకాయ", "#6aa84f"],
  Donda: ["Ivy gourd (tindora)", "దొండకాయ", "#4b8a3a"],
  "Field Beans": ["Field beans", "చిక్కుడుకాయ", "#7aa54a"],
  "French Beans": ["French beans", "బీన్స్", "#4f8a2e"],
  "Green Chillies": ["Green chillies", "పచ్చిమిర్చి", "#3f8f3a"],
  Kanda: ["Elephant foot yam", "కంద", "#8c6a4a"],
  Keera: ["Keera (cucumber)", "కీర దోసకాయ", "#3e7d3a"],
  "Leafy Vegetables": ["Leafy greens", "ఆకుకూరలు", "#2f7d32"],
  Mulagakada: ["Drumstick", "మునగకాయ", "#567d2e"],
  "Onions-I": ["Onion", "ఉల్లిపాయ", "#b04a7a"],
  Potato: ["Potato", "బంగాళదుంప", "#c9a26b"],
  "Ribbed Gourd": ["Ridge gourd", "బీరకాయ", "#6d8f3e"],
  Rice: ["Rice", "బియ్యం", "#e8e0cc"],
  "Snake Gourd": ["Snake gourd", "పొట్లకాయ", "#8fb35a"],
  Tomato: ["Tomato", "టమాటా", "#e2412f"],
};

const UNKNOWN_COLOR = "#a6a8aa";
// "Beet Root" = "Beetroot" = "beet-root": compare names without case, spaces or punctuation.
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
// A variety or grade written as base + hyphen + suffix: "Tomato-618", "Onions-II".
const VARIANT = /^(.*?[A-Za-z)])\s*-\s*([A-Za-z0-9]+)$/;

const exact = new Map(Object.keys(ITEMS).map((k) => [norm(k), k]));
// Base names of listed items, so "Onions-II" finds "Onions-I" through "Onions".
const bases = new Map<string, string>();
for (const k of Object.keys(ITEMS)) {
  const b = norm(k.match(VARIANT)?.[1] ?? k);
  if (!bases.has(b)) bases.set(b, k);
}

/** The listed item a name is, or is a variety of ("Tomato-618" → "Tomato"); null if unlisted. */
export function baseItem(name: string): string | null {
  const hit = exact.get(norm(name));
  if (hit) return hit;
  const v = name.match(VARIANT);
  return (v && bases.get(norm(v[1]))) || null;
}

/** A listed item's page slug, from its English name minus any bracket: "Okra (bhindi)" → "okra". */
export const itemSlug = (key: string) => slugify(ITEMS[key][0].replace(/\s*\(.*\)$/, ""));
const bySlug = new Map(Object.keys(ITEMS).map((k) => [itemSlug(k), k]));
export const itemBySlug = (slug: string) => bySlug.get(slug) ?? null;
/** The page an item name links to (a variety links to its base item's page), or null. */
export const pathForItem = (name: string) => {
  const key = baseItem(name);
  return key ? `/vegetables/${itemSlug(key)}` : null;
};

// Sold per piece or bunch at some bazars and per kg at others; the source doesn't say which.
export const UNIT_VARIES = new Set(["Mulagakada", "Leafy Vegetables"]);
// Fewer bazars than this and an item isn't really "across bazars": the all-branches list leaves
// it out, but search still finds it.
export const RARE = 3;

/**
 * Labels for an item name as rbzts writes it. Known = listed above, or a listed item plus a
 * variety suffix ("Tomato-618" → "Tomato (618)", with Tomato's Telugu and colour). Anything
 * else comes back as its raw name and known: false, and /api/status lists it.
 */
export function describe(name: string): ItemInfo {
  const key = baseItem(name);
  if (!key) return { en: name, te: "", color: UNKNOWN_COLOR, known: false };
  const [en, te, color] = ITEMS[key];
  if (norm(key) === norm(name)) return { en, te, color, known: true };
  return { en: `${en} (${name.match(VARIANT)![2]})`, te, color, known: true };
}
