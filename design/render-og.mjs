// Renders design/og-card.html to public/og.png (1200×630). Convert to JPEG after:
//   node design/render-og.mjs && sips -s format jpeg -s formatOptions 85 public/og.png --out public/og.jpg && rm public/og.png
// Needs Playwright (any install) and Chrome: PLAYWRIGHT=/path/to/node_modules/playwright node design/render-og.mjs
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT ?? "playwright");
const here = (p) => fileURLToPath(new URL(p, import.meta.url));

const browser = await chromium.launch({ channel: "chrome" });
const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
await page.goto(pathToFileURL(here("./og-card.html")).href, { waitUntil: "networkidle" });
await page.evaluate(() => document.fonts.ready);
await page.locator(".card").screenshot({ path: here("../public/og.png") });
await browser.close();
