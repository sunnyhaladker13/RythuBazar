-- Ids are the rbzts dropdown values (ddlDist / ddlRbz).
CREATE TABLE districts (
  id              INTEGER PRIMARY KEY,
  name            TEXT    NOT NULL,
  market_count    INTEGER NOT NULL DEFAULT 0,
  last_attempt_at TEXT,             -- ISO UTC; set only when the whole district was processed
  last_error      TEXT
);

CREATE TABLE markets (
  id                 INTEGER PRIMARY KEY,
  district_id        INTEGER NOT NULL REFERENCES districts(id),
  name               TEXT    NOT NULL,
  active             INTEGER NOT NULL DEFAULT 1,  -- 0 once it disappears from the dropdown
  last_checked_at    TEXT,                         -- ISO UTC
  last_reported_date TEXT,                         -- IST yyyy-mm-dd of last non-empty table
  last_item_count    INTEGER NOT NULL DEFAULT 0,
  last_hash          TEXT                          -- hash of last price table, skips no-op writes
);
CREATE INDEX markets_district ON markets(district_id);

-- Retail "Our Rate", ₹/kg, one row per market/day/item.
CREATE TABLE prices (
  market_id     INTEGER NOT NULL REFERENCES markets(id),
  date          TEXT    NOT NULL,   -- IST yyyy-mm-dd (rbzts "reported" date)
  item          TEXT    NOT NULL,
  price         REAL    NOT NULL,
  first_seen_at TEXT    NOT NULL,
  updated_at    TEXT    NOT NULL,
  PRIMARY KEY (market_id, date, item)
) WITHOUT ROWID;
CREATE INDEX prices_item_date ON prices(item, date);

CREATE TABLE scrape_runs (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at   TEXT    NOT NULL,
  finished_at  TEXT    NOT NULL,
  trigger      TEXT    NOT NULL,    -- cron | manual
  districts    INTEGER NOT NULL,    -- districts fetched
  markets      INTEGER NOT NULL,    -- markets fetched
  reported     INTEGER NOT NULL,    -- of those, with a price table
  price_rows   INTEGER NOT NULL,    -- price rows sent for upsert
  fetches      INTEGER NOT NULL,
  budget_hit   INTEGER NOT NULL,
  errors       TEXT
);

-- Single-row lease so overlapping cron ticks (slow upstream) don't duplicate work.
CREATE TABLE scrape_lock (
  id    INTEGER PRIMARY KEY CHECK (id = 1),
  until TEXT    NOT NULL           -- ISO UTC; '' = free
);
INSERT INTO scrape_lock (id, until) VALUES (1, '');
