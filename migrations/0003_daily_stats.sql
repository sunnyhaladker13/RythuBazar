-- One row per item per day across all bazars that reported it that day: the history behind
-- the trend lines and the item chart. The scraper's write batch keeps the days it touches
-- current (tick.ts), so reading 30 days of one item is 30 rows instead of ~1,200 prices.
CREATE TABLE daily_stats (
  item    TEXT    NOT NULL,
  date    TEXT    NOT NULL,   -- IST yyyy-mm-dd
  median  REAL    NOT NULL,   -- the "typical" price
  min     REAL    NOT NULL,
  max     REAL    NOT NULL,
  markets INTEGER NOT NULL,   -- bazars that reported the item that day
  PRIMARY KEY (item, date)
) WITHOUT ROWID;
CREATE INDEX daily_stats_date ON daily_stats(date);

-- Backfill from the history so far (one-time full read of prices).
INSERT INTO daily_stats (item, date, median, min, max, markets)
WITH r AS (
  SELECT item, date, price,
         ROW_NUMBER() OVER (PARTITION BY item, date ORDER BY price) AS rn,
         COUNT(*) OVER (PARTITION BY item, date) AS n
    FROM prices
)
SELECT item, date, AVG(CASE WHEN rn IN ((n + 1) / 2, (n + 2) / 2) THEN price END), MIN(price), MAX(price), MAX(n)
  FROM r GROUP BY item, date;
