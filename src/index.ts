import { handleApi } from "./api";
import { runTick } from "./scraper/tick";
import { handleSite, notFound, type SiteEnv } from "./site";

export default {
  async fetch(request, env: Env & SiteEnv): Promise<Response> {
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
    // Pages are rendered here (src/site.ts); everything else is a static file from public/.
    const page = await handleSite(request, env, url);
    if (page) return page;
    const file = await env.ASSETS.fetch(request);
    return file.status === 404 ? notFound({ origin: env.SITE_ORIGIN?.replace(/\/$/, "") || url.origin }, url.pathname) : file;
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
} satisfies ExportedHandler<Env & SiteEnv>;
