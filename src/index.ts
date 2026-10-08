import { handleApi } from "./api";
import { runTick } from "./scraper/tick";
import { defaultMeta, shareMeta, withShareTags } from "./share";

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) {
      // Fail open: a limiter outage must not take the API down with it.
      const { success } = await env.API_LIMITER.limit({
        key: request.headers.get("cf-connecting-ip") ?? "unknown",
      }).catch(() => ({ success: true }));
      if (!success) {
        return new Response(JSON.stringify({ error: "too many requests" }), {
          status: 429,
          headers: { "Content-Type": "application/json; charset=utf-8", "Retry-After": "60" },
        });
      }
      return handleApi(request, env, url);
    }
    const page = await env.ASSETS.fetch(request);
    if (url.pathname !== "/" || !page.headers.get("content-type")?.startsWith("text/html")) return page;
    // A failed lookup must never break the page; fall back to the generic preview.
    const meta = await shareMeta(env.DB, url).catch(() => defaultMeta(url));
    return withShareTags(page, meta);
  },

  async scheduled(_controller, env, ctx): Promise<void> {
    ctx.waitUntil(
      runTick(env, "cron").then(
        (summary) => console.log(JSON.stringify({ event: "scrape_tick", ...summary })),
        (err) => {
          console.error(JSON.stringify({ event: "scrape_tick_failed", error: String(err) }));
          throw err;
        },
      ),
    );
  },
} satisfies ExportedHandler<Env>;
