-- d1_72_multichannel_rotation.sql
-- Phase 2 multichannel distribution + rotation engine: outbound listings that
-- publish d1_71 sourcing_offers to smartstore/coupang, with rotation and
-- delta-sync watermarks, plus a full-catalog keyset pagination index.
-- NOTE: d1_29 channel_listings is the seller-side grain (sales_channel +
-- product); this table is the sourcing-offer grain (channel + offer), so it
-- intentionally does NOT reuse that table or its status CHECK.
-- Additive only. Rerun-safe (IF NOT EXISTS per repo convention).

CREATE TABLE IF NOT EXISTS sourcing_channel_listings (
  id TEXT PRIMARY KEY,
  offer_id TEXT NOT NULL REFERENCES sourcing_offers(id),
  product_id TEXT REFERENCES products(id),
  channel TEXT NOT NULL CHECK (channel IN ('smartstore', 'coupang')),
  external_listing_id TEXT,
  status TEXT NOT NULL DEFAULT 'DRAFT'
    CHECK (status IN ('DRAFT', 'LIVE', 'PAUSED', 'ROTATED_OUT')),
  margin_bps INTEGER CHECK (margin_bps IS NULL OR margin_bps >= 0),
  last_sale_at TEXT,
  synced_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (channel, offer_id)
);
CREATE INDEX IF NOT EXISTS idx_sourcing_listings_rotation
  ON sourcing_channel_listings(status, last_sale_at);
CREATE INDEX IF NOT EXISTS idx_sourcing_listings_sync
  ON sourcing_channel_listings(channel, status, synced_at);

-- Full-catalog keyset pagination: status filter + (updated_at, id) cursor.
CREATE INDEX IF NOT EXISTS idx_products_full_catalog
  ON products(status, updated_at, id);

INSERT OR IGNORE INTO schema_migrations (version, applied_at)
VALUES ('d1_72_multichannel_rotation.sql', CURRENT_TIMESTAMP);
