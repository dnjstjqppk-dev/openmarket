-- d1_60_search_trending_recent.sql
-- Work order 2-8: hourly search counts, banned words, price history, views index.
-- Additive only. Rerun-safe (single-apply ALTERs per repo convention).

CREATE TABLE IF NOT EXISTS search_keyword_hourly (
  keyword TEXT NOT NULL,
  hour TEXT NOT NULL,
  search_count INTEGER NOT NULL DEFAULT 0 CHECK (search_count >= 0),
  PRIMARY KEY (keyword, hour)
);
CREATE INDEX IF NOT EXISTS idx_search_hourly_hour ON search_keyword_hourly(hour);

CREATE TABLE IF NOT EXISTS trending_banned_words (
  word TEXT PRIMARY KEY,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS sku_price_history (
  id TEXT PRIMARY KEY,
  sku_id TEXT NOT NULL REFERENCES product_skus(id),
  original_price INTEGER NOT NULL,
  sale_price INTEGER NOT NULL,
  changed_by TEXT,
  changed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_price_history_sku ON sku_price_history(sku_id, changed_at);

CREATE INDEX IF NOT EXISTS idx_product_views_user_time ON product_views(user_id, viewed_at);

INSERT OR IGNORE INTO schema_migrations (version, applied_at)
VALUES ('d1_60_search_trending_recent.sql', CURRENT_TIMESTAMP);
