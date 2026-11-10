-- migrations/d1_40_p1_api_data_integrity.sql
-- P1 api/data integrity follow-ups (P1-D01, P1-D02, P1-D03, P1-D05).
--
-- P1-D01: canonical fulfillment_orders shape. Two CREATEs exist in history:
--   d1_27 (supplier/3PL fulfilment: supplier_order_id, warehouse_id, carrier_code,
--   tracking_number, PENDING..RETURNED status) and d1_29 (provider-based dispatch:
--   provider_id NOT NULL, warehouse_code, REQUESTED..FAILED status without SHIPPED).
-- Migrations apply in order, so d1_27 always wins and the d1_29 CREATE is a
-- no-op ghost. The only writer (apps/cloudflare-gateway/src/routes/supplier-3pl.js
-- INSERTs id, supplier_order_id, carrier_code, tracking_number, status, shipped_at)
-- matches the d1_27 shape and would violate the d1_29 shape (provider_id NOT NULL,
-- no 'SHIPPED' in its CHECK). d1_27 is therefore canonical; the d1_29-only
-- satellites (fulfillment_providers, shipment_tracking_events) have zero code
-- references repo-wide and are dropped. The provider seed rows are reproducible
-- from d1_29 §19 if a provider-based flow is ever built.
--
-- P1-D02: d1_03 claimed slugs 'chargers-power' and 'watches-straps' before d1_09b,
-- so INSERT OR IGNORE silently dropped L2 rows sub_cel_03 / sub_wat_03. Re-insert
-- them with unique slugs.
--
-- P1-D03: purchase_order_items.sku_id had no REFERENCES while its siblings do;
-- the checkout writer (services/orders.js) inserts real sku ids, so the rebuild
-- only adds the fence. d1_20 stash pattern with a no-row-lost guard.
--
-- P1-D05: settlements.payout_id has no REFERENCES and IS NULL is the only fence,
-- so a typo id would link a settlement to a payout that does not exist. SQLite
-- cannot ADD REFERENCES, and rebuilding the live settlements table is riskier
-- than the defect; instead this adds BEFORE INSERT / BEFORE UPDATE existence
-- guards in the d1_20 integrity-trigger style. They hold with FK enforcement on
-- or off. The payout writer (routes/finance.js) inserts the payout row and links
-- settlements in one batch, so the new guard sees the payout in the same txn.

PRAGMA defer_foreign_keys = ON;

-- ---------------------------------------------------------------------------------------------
-- P1-D01: canonical-shape guard + drop dead d1_29 §13/§15 satellites
-- ---------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS _v40_guard (ok INTEGER NOT NULL CHECK (ok = 1));
INSERT INTO _v40_guard (ok) SELECT CASE WHEN
  (SELECT COUNT(*) FROM sqlite_master WHERE name = 'fulfillment_orders' AND sql LIKE '%supplier_order_id%') = 1
  THEN 1 ELSE 0 END;
DROP TABLE _v40_guard;

DROP TABLE IF EXISTS shipment_tracking_events;
DROP TABLE IF EXISTS fulfillment_providers;

-- ---------------------------------------------------------------------------------------------
-- P1-D02: restore slug-collision-dropped L2 categories with unique slugs
-- ---------------------------------------------------------------------------------------------
INSERT OR IGNORE INTO categories (id, parent_id, name, slug, depth, sort_order) VALUES
('sub_cel_03', 'cat_cellphones', '고속 충전기 & GaN 어댑터', 'gan-chargers', 1, 3),
('sub_wat_03', 'cat_watches', '스마트워치 스트랩 & 케이스', 'watch-straps', 1, 3);

CREATE TABLE IF NOT EXISTS _v40_guard (ok INTEGER NOT NULL CHECK (ok = 1));
INSERT INTO _v40_guard (ok) SELECT CASE WHEN
  (SELECT COUNT(*) FROM categories WHERE id IN ('sub_cel_03', 'sub_wat_03')) = 2
  THEN 1 ELSE 0 END;
DROP TABLE _v40_guard;

-- ---------------------------------------------------------------------------------------------
-- P1-D03: rebuild purchase_order_items with REFERENCES product_skus(id)
-- ---------------------------------------------------------------------------------------------
CREATE TABLE _v40_stash_poi AS SELECT * FROM purchase_order_items;
DELETE FROM purchase_order_items;
CREATE TABLE purchase_order_items_v40 (
    id TEXT PRIMARY KEY,
    purchase_order_id TEXT NOT NULL REFERENCES purchase_orders(id),
    order_item_id TEXT NOT NULL REFERENCES order_items(id),
    sku_id TEXT NOT NULL REFERENCES product_skus(id),
    supplier_sku_code TEXT NOT NULL,
    quantity INTEGER NOT NULL CHECK (quantity > 0),
    unit_cost INTEGER NOT NULL CHECK (unit_cost >= 0)
);
INSERT INTO purchase_order_items_v40 (id, purchase_order_id, order_item_id, sku_id, supplier_sku_code, quantity, unit_cost)
SELECT id, purchase_order_id, order_item_id, sku_id, supplier_sku_code, quantity, unit_cost FROM _v40_stash_poi;
DROP TABLE purchase_order_items;
ALTER TABLE purchase_order_items_v40 RENAME TO purchase_order_items;

CREATE TABLE IF NOT EXISTS _v40_guard (ok INTEGER NOT NULL CHECK (ok = 1));
INSERT INTO _v40_guard (ok) SELECT CASE WHEN
  (SELECT COUNT(*) FROM purchase_order_items) = (SELECT COUNT(*) FROM _v40_stash_poi)
  THEN 1 ELSE 0 END;
DROP TABLE _v40_guard;
DROP TABLE _v40_stash_poi;

-- ---------------------------------------------------------------------------------------------
-- P1-D05: payout-link existence guards (typo payout_id can no longer ghost-link)
-- ---------------------------------------------------------------------------------------------
CREATE TRIGGER IF NOT EXISTS trg_settlements_payout_known_insert
BEFORE INSERT ON settlements
WHEN NEW.payout_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM payouts WHERE id = NEW.payout_id)
BEGIN SELECT RAISE(ABORT, 'PAYOUT_UNKNOWN'); END;

CREATE TRIGGER IF NOT EXISTS trg_settlements_payout_known_update
BEFORE UPDATE OF payout_id ON settlements
WHEN NEW.payout_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM payouts WHERE id = NEW.payout_id)
BEGIN SELECT RAISE(ABORT, 'PAYOUT_UNKNOWN'); END;
