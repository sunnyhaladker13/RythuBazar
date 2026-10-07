import { handleApi } from "./api";
import { runTick } from "./scraper/tick";

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) return handleApi(request, env, url);
    return env.ASSETS.fetch(request);
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
