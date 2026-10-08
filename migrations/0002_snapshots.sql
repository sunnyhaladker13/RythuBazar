-- Ready-made JSON for the busiest endpoints (src/snapshot.ts): a page view reads one
-- row here instead of ~1k rows of prices. Safe to empty at any time; it rebuilds itself.
CREATE TABLE snapshots (
  key      TEXT PRIMARY KEY,   -- 'overview' | 'markets'
  day      TEXT NOT NULL,      -- IST yyyy-mm-dd it was built for
  built_at TEXT NOT NULL,      -- ISO UTC
  body     TEXT NOT NULL       -- the endpoint's JSON response
);
