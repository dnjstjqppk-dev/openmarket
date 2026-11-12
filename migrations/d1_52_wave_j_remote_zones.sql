-- d1_52_wave_j_remote_zones.sql
-- NEW-20: remote/island delivery surcharge zones, matched by longest postal
-- prefix (2-5 digits). Surcharges apply per seller sub-order on top of the
-- base-or-free shipping fee. Operator-managed seed: Jeju + Ulleungdo with
-- typical courier amounts; the admin API owns the rows afterwards.
-- Additive only. Rerun-safe.

CREATE TABLE IF NOT EXISTS shipping_remote_zones (
  postal_prefix TEXT PRIMARY KEY,
  zone_name TEXT NOT NULL,
  surcharge_amount INTEGER NOT NULL CHECK (surcharge_amount >= 0),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT OR IGNORE INTO shipping_remote_zones (postal_prefix, zone_name, surcharge_amount)
VALUES ('63', '제주', 3000), ('402', '울릉도', 5000);

-- J-2: delivery logs record which app was targeted (CUSTOMER/PARTNER).
ALTER TABLE notification_delivery_logs ADD COLUMN app TEXT;

INSERT OR IGNORE INTO schema_migrations (version, applied_at)
VALUES ('d1_52_wave_j_remote_zones.sql', CURRENT_TIMESTAMP);
