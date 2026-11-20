-- d1_73_fulfillment_orchestration.sql
-- Phase 3 unmanned PO/invoice orchestration: unified channel-order intake
-- (storefront PG-webhook mirror + smartstore/coupang polls), supplier
-- purchase orders to the sourcing vendor, collected shipment trackings with
-- channel push-back watermarks, and a durable notify outbox.
-- Additive only. Rerun-safe (IF NOT EXISTS per repo convention).

CREATE TABLE IF NOT EXISTS unified_orders (
  id TEXT PRIMARY KEY,
  channel TEXT NOT NULL CHECK (channel IN ('storefront', 'smartstore', 'coupang')),
  external_order_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'NEW'
    CHECK (status IN ('NEW', 'PAID', 'ORDERED', 'SHIPPED', 'CANCELLED')),
  total_krw INTEGER NOT NULL CHECK (total_krw >= 0),
  provider TEXT CHECK (provider IS NULL OR provider IN ('domeme', 'ownerclan', 'onchannel', 'cj-dropshipping')),
  items_json TEXT NOT NULL DEFAULT '[]',
  paid_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (channel, external_order_id)
);
CREATE INDEX IF NOT EXISTS idx_unified_orders_status ON unified_orders(status, paid_at);
CREATE INDEX IF NOT EXISTS idx_unified_orders_channel ON unified_orders(channel, external_order_id);

CREATE TABLE IF NOT EXISTS supplier_pos (
  id TEXT PRIMARY KEY,
  channel_order_id TEXT NOT NULL UNIQUE REFERENCES unified_orders(id),
  provider TEXT NOT NULL CHECK (provider IN ('domeme', 'ownerclan', 'onchannel', 'cj-dropshipping')),
  external_po_id TEXT,
  status TEXT NOT NULL DEFAULT 'DRAFT'
    CHECK (status IN ('DRAFT', 'SENT', 'CONFIRMED', 'FAILED')),
  detail_json TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_supplier_pos_status ON supplier_pos(status, updated_at);

CREATE TABLE IF NOT EXISTS shipment_trackings (
  id TEXT PRIMARY KEY,
  po_id TEXT NOT NULL UNIQUE REFERENCES supplier_pos(id),
  carrier_code TEXT NOT NULL,
  tracking_no TEXT NOT NULL,
  fetched_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  pushed_to_channel_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS notify_outbox (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('PO_SENT', 'PO_FAILED', 'SHIPPED', 'POLL_DEGRADED')),
  ref_id TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'SENT', 'FAILED')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  sent_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_notify_outbox_status ON notify_outbox(status, created_at);

INSERT OR IGNORE INTO schema_migrations (version, applied_at)
VALUES ('d1_73_fulfillment_orchestration.sql', CURRENT_TIMESTAMP);
