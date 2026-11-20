-- d1_71_sourcing_normalize.sql
-- Phase 1 B2B sourcing normalization pipeline: canonical offers from
-- domeme / ownerclan / onchannel / cj-dropshipping, channel margin policy
-- (operator-entered, never hardcoded), and pre-checkout guard audit log.
-- Additive only. Rerun-safe (IF NOT EXISTS per repo convention).

CREATE TABLE IF NOT EXISTS sourcing_offers (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL CHECK (provider IN ('domeme', 'ownerclan', 'onchannel', 'cj-dropshipping')),
  external_id TEXT NOT NULL,
  title TEXT NOT NULL,
  cost_krw INTEGER NOT NULL CHECK (cost_krw >= 0),
  currency TEXT NOT NULL DEFAULT 'KRW',
  stock_qty INTEGER NOT NULL DEFAULT 0 CHECK (stock_qty >= 0),
  status TEXT NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED', 'PUBLISHED')),
  image_r2_key TEXT,
  channel_quotes_json TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (provider, external_id)
);
CREATE INDEX IF NOT EXISTS idx_sourcing_offers_status ON sourcing_offers(status, updated_at);
CREATE INDEX IF NOT EXISTS idx_sourcing_offers_provider ON sourcing_offers(provider, external_id);

CREATE TABLE IF NOT EXISTS sourcing_channel_policy (
  channel TEXT PRIMARY KEY,
  margin_bps INTEGER NOT NULL CHECK (margin_bps >= 0 AND margin_bps <= 100000),
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS sourcing_precheck_log (
  id TEXT PRIMARY KEY,
  offer_id TEXT NOT NULL REFERENCES sourcing_offers(id),
  decision TEXT NOT NULL CHECK (decision IN ('ALLOW', 'DENY', 'RECHECK')),
  reason TEXT NOT NULL,
  stock_qty INTEGER,
  checked_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_sourcing_precheck_offer ON sourcing_precheck_log(offer_id, checked_at);

INSERT OR IGNORE INTO schema_migrations (version, applied_at)
VALUES ('d1_71_sourcing_normalize.sql', CURRENT_TIMESTAMP);
