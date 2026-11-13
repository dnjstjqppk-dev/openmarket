-- d1_54_shipping_policies.sql
-- Work order 2-2: seller shipping templates, bundle keys, sub-order shipping
-- breakdown, and return collection/inspection stages.
-- Additive only. Rerun-safe (single-apply ALTERs per repo convention).

CREATE TABLE IF NOT EXISTS shipping_policies (
  id TEXT PRIMARY KEY,
  partner_id TEXT NOT NULL REFERENCES partners(id),
  name TEXT NOT NULL,
  method TEXT NOT NULL CHECK (method IN ('PARCEL', 'DIRECT', 'OVERSEAS')),
  carrier_code TEXT,
  fee_type TEXT NOT NULL CHECK (fee_type IN ('FREE', 'PAID', 'CONDITIONAL', 'PER_QTY')),
  base_fee INTEGER NOT NULL DEFAULT 0 CHECK (base_fee >= 0),
  free_threshold INTEGER CHECK (free_threshold IS NULL OR free_threshold >= 0),
  qty_unit INTEGER CHECK (qty_unit IS NULL OR qty_unit > 0),
  remote_surcharge INTEGER CHECK (remote_surcharge IS NULL OR remote_surcharge >= 0),
  return_fee INTEGER NOT NULL DEFAULT 0 CHECK (return_fee >= 0),
  exchange_fee INTEGER NOT NULL DEFAULT 0 CHECK (exchange_fee >= 0),
  processing_days INTEGER NOT NULL DEFAULT 0 CHECK (processing_days BETWEEN 0 AND 14),
  today_cutoff TEXT,
  origin_address TEXT,
  return_address TEXT,
  is_default INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0, 1)),
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_shipping_policies_default
  ON shipping_policies(partner_id) WHERE is_default = 1;
CREATE INDEX IF NOT EXISTS idx_shipping_policies_partner ON shipping_policies(partner_id);

ALTER TABLE products ADD COLUMN shipping_policy_id TEXT;
ALTER TABLE products ADD COLUMN bundle_group_key TEXT;

ALTER TABLE sub_orders ADD COLUMN confirmed_at TEXT;
ALTER TABLE sub_orders ADD COLUMN ship_by_deadline TEXT;
ALTER TABLE sub_orders ADD COLUMN shipping_breakdown_json TEXT;

ALTER TABLE order_items ADD COLUMN shipping_group_key TEXT;

ALTER TABLE returns ADD COLUMN collection_requested_at TEXT;
ALTER TABLE returns ADD COLUMN collection_carrier TEXT;
ALTER TABLE returns ADD COLUMN collection_tracking_number TEXT;
ALTER TABLE returns ADD COLUMN collection_completed_at TEXT;
ALTER TABLE returns ADD COLUMN inspected_at TEXT;
ALTER TABLE returns ADD COLUMN inspection_result TEXT;
ALTER TABLE returns ADD COLUMN inspection_memo TEXT;
ALTER TABLE returns ADD COLUMN inspection_photos_json TEXT;

INSERT OR IGNORE INTO schema_migrations (version, applied_at)
VALUES ('d1_54_shipping_policies.sql', CURRENT_TIMESTAMP);
