// Ready-made JSON for the busiest endpoints. Building /api/overview reads ~920 D1 rows;
// serving the saved copy reads 1. A snapshot is rebuilt on the next request when:
// - the scraper wrote anything the pages show (tick.ts deletes all snapshots), or
// - the IST date rolled over ("today", "reported today" and the 3-day window move), or
// - it is older than MAX_AGE_MS, a backstop for anything the other two miss.

import { istDate } from "./scraper/tick";

const MAX_AGE_MS = 5 * 60_000;

export interface SnapshotRow {
  day: string;
  builtAt: string;
  body: string;
}

export function isFresh(row: SnapshotRow | null, now: Date): row is SnapshotRow {
  return !!row && row.day === istDate(now) && now.getTime() - Date.parse(row.builtAt) < MAX_AGE_MS;
}

/** The saved response body for `key`, rebuilt with `build` when missing or stale. */
export async function snapshot(db: D1Database, key: string, build: () => Promise<unknown>): Promise<string> {
  const now = new Date();
  const row = await db
    .prepare("SELECT day, built_at AS builtAt, body FROM snapshots WHERE key = ?1")
    .bind(key)
    .first<SnapshotRow>()
    .catch(() => null); // e.g. table not migrated yet: serve live rather than fail
  if (isFresh(row, now)) return row.body;

  const body = JSON.stringify(await build());
  // A tick committing while we build can leave this copy slightly stale; MAX_AGE_MS bounds that.
  await db
    .prepare(
      `INSERT INTO snapshots (key, day, built_at, body) VALUES (?1, ?2, ?3, ?4)
       ON CONFLICT(key) DO UPDATE SET day = excluded.day, built_at = excluded.built_at, body = excluded.body`,
    )
    .bind(key, istDate(now), now.toISOString(), body)
    .run()
    .catch((err) => console.error(JSON.stringify({ event: "snapshot_save_failed", key, error: String(err) })));
  return body;
}
