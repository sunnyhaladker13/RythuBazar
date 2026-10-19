// Text helpers for the server-rendered pages. Dates are IST yyyy-mm-dd strings, as stored.
// Written by hand rather than with Intl so the Worker's output never depends on its locale data;
// they match what public/app.js prints with Intl ("Mon, 19 Oct", "12:05 pm").

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAY_MS = 864e5;

const utc = (ymd: string) => new Date(`${ymd}T00:00:00Z`);

/** "Mon, 19 Oct" */
export const fmtDate = (ymd: string) => {
  const d = utc(ymd);
  return `${WEEKDAYS[d.getUTCDay()]}, ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
};

/** "19 Oct" */
export const fmtDay = (ymd: string) => {
  const d = utc(ymd);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
};

/** "Wed 7 Oct" */
export const fmtWeekday = (ymd: string) => {
  const d = utc(ymd);
  return `${WEEKDAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
};

/** An ISO timestamp as IST clock time: "12:05 pm". */
export function istTime(iso: string): string {
  const d = new Date(Date.parse(iso) + 330 * 60_000);
  const h = d.getUTCHours();
  return `${h % 12 || 12}:${String(d.getUTCMinutes()).padStart(2, "0")} ${h < 12 ? "am" : "pm"}`;
}

/** A day within the last week, from today's side: "today", "yesterday", "Saturday". */
export const dayWord = (ymd: string, today: string) => {
  const n = daysBetween(ymd, today);
  return n <= 0 ? "today" : n === 1 ? "yesterday" : DAY_NAMES[utc(ymd).getUTCDay()];
};

export const daysBetween = (from: string, to: string) => Math.round((utc(to).getTime() - utc(from).getTime()) / DAY_MS);
export const addDays = (ymd: string, n: number) => new Date(utc(ymd).getTime() + n * DAY_MS).toISOString().slice(0, 10);

export const money = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/\.?0+$/, ""));
export const rupees = (n: number) => `₹${money(n)}`;
export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** "₹23–35", or "₹23" when there's no spread. */
export const range = (min: number, max: number) => (max > min ? `${rupees(min)}–${money(max)}` : rupees(min));

/** "Kothagudem (P. Stdm)" → "kothagudem-p-stdm" */
export const slugify = (s: string) =>
  s
    .toLowerCase()
    .replace(/['.]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

/** "yesterday" → "Yesterday" */
export const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

/** A vegetable's name inside a sentence: "Tomato" → "tomato", but "French beans" keeps its capital. */
export const lower = (name: string) => (/^French\b/.test(name) ? name : name[0].toLowerCase() + name.slice(1));

export type Point = { lat: number; lng: number };

/** Straight-line distance in km. */
export function km(a: Point, b: Point): number {
  const rad = Math.PI / 180;
  const h =
    Math.sin(((b.lat - a.lat) * rad) / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(((b.lng - a.lng) * rad) / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
}

export const kmText = (d: number) => `${d < 10 ? d.toFixed(1) : Math.round(d)} km`;
