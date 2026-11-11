-- d1_50_wave_e_fds_purchase.sql
-- Wave E: FDS enforcement columns, failed-payment forensics, prohibited HS
-- blocklist, PO RECEIVED status, receipt cancel-required status, purchase
-- receipt ledger type.
-- Rebuilds follow the d1_40 stash + no-row-lost guard pattern. The
-- inventory_ledger IMMUTABLE triggers are dropped for the rebuild and recreated
-- from their exact d1_20 text (verified by name below).

PRAGMA defer_foreign_keys = ON;

-- 1. FDS verdict persisted per order (BLOCK never creates an order; REVIEW/CLEARED do).
ALTER TABLE orders ADD COLUMN fds_score INTEGER;
ALTER TABLE orders ADD COLUMN fds_decision TEXT;
ALTER TABLE orders ADD COLUMN fds_rules_json TEXT;
ALTER TABLE orders ADD COLUMN fds_decided_at TEXT;

-- 2. Failed payment attempts (velocity signal for RULE_01).
ALTER TABLE payment_transactions ADD COLUMN failure_code TEXT;
ALTER TABLE payment_transactions ADD COLUMN attempt_ip TEXT;

-- 3. Operator-managed prohibited HS blocklist (RULE_05). Empty by default:
-- the rule only fires on listed codes (exact or digit-prefix match).
CREATE TABLE IF NOT EXISTS prohibited_hs_codes (
  code TEXT PRIMARY KEY,
  reason TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 4. purchase_orders: add RECEIVED (SELF_SHIP warehouse receipt posts inventory).
CREATE TABLE _v50_stash_po AS SELECT * FROM purchase_orders;
DELETE FROM purchase_orders;
CREATE TABLE purchase_orders_v50 (
    id TEXT PRIMARY KEY,
    po_no TEXT NOT NULL UNIQUE,
    supplier_id TEXT NOT NULL REFERENCES suppliers(id),
    sub_order_id TEXT NOT NULL REFERENCES sub_orders(id),
    operator_entity_id TEXT REFERENCES business_entities(id),
    fulfillment_mode TEXT NOT NULL CHECK (fulfillment_mode IN ('DROP_SHIP', 'SELF_SHIP')),
    dispatch_method TEXT NOT NULL DEFAULT 'MANUAL' CHECK (dispatch_method IN ('MANUAL', 'API')),
    status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'SENT', 'CONFIRMED', 'SHIPPED', 'RECEIVED', 'FAILED', 'CANCELLED')),
    total_cost INTEGER NOT NULL CHECK (total_cost >= 0),
    supplier_order_ref TEXT,
    failure_reason TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO purchase_orders_v50 (id, po_no, supplier_id, sub_order_id, operator_entity_id, fulfillment_mode, dispatch_method, status, total_cost, supplier_order_ref, failure_reason, created_at, updated_at)
SELECT id, po_no, supplier_id, sub_order_id, operator_entity_id, fulfillment_mode, dispatch_method, status, total_cost, supplier_order_ref, failure_reason, created_at, updated_at FROM _v50_stash_po;
DROP TABLE purchase_orders;
ALTER TABLE purchase_orders_v50 RENAME TO purchase_orders;
CREATE UNIQUE INDEX IF NOT EXISTS ux_purchase_orders_sub_supplier ON purchase_orders(sub_order_id, supplier_id);

CREATE TABLE IF NOT EXISTS _v50_guard (ok INTEGER NOT NULL CHECK (ok = 1));
INSERT INTO _v50_guard (ok) SELECT CASE WHEN
  (SELECT COUNT(*) FROM purchase_orders) = (SELECT COUNT(*) FROM _v50_stash_po)
  AND (SELECT COUNT(*) FROM sqlite_master WHERE type = 'index' AND name = 'ux_purchase_orders_sub_supplier') = 1
  THEN 1 ELSE 0 END;
DROP TABLE _v50_guard;
DROP TABLE _v50_stash_po;

-- 5. tax_invoices: add CANCEL_REQUIRED (issued receipt voided by a later refund).
CREATE TABLE _v50_stash_ti AS SELECT * FROM tax_invoices;
DELETE FROM tax_invoices;
CREATE TABLE tax_invoices_v50 (
    id TEXT PRIMARY KEY,
    invoice_type TEXT NOT NULL CHECK (invoice_type IN ('CASH_RECEIPT', 'TAX_INVOICE_PURCHASE', 'TAX_INVOICE_SALES')),
    order_id TEXT REFERENCES orders(id),
    partner_id TEXT REFERENCES partners(id),
    buyer_identifier TEXT NOT NULL,
    identifier_type TEXT NOT NULL CHECK (identifier_type IN ('PHONE', 'BUSINESS_REG_NO', 'PERSONAL_ID')),
    supply_amount INTEGER NOT NULL CHECK (supply_amount >= 0),
    vat_amount INTEGER NOT NULL CHECK (vat_amount >= 0),
    total_amount INTEGER NOT NULL CHECK (total_amount >= 0),
    issue_status TEXT NOT NULL DEFAULT 'REQUESTED' CHECK (issue_status IN ('REQUESTED', 'ISSUED', 'CANCELLED', 'CANCEL_REQUIRED', 'FAILED')),
    hometax_approval_no TEXT,
    item_title TEXT NOT NULL,
    issuer_entity_id TEXT,
    memo TEXT,
    issued_at TEXT,
    cancelled_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    period_start TEXT,
    period_end TEXT
);
INSERT INTO tax_invoices_v50 (id, invoice_type, order_id, partner_id, buyer_identifier, identifier_type, supply_amount, vat_amount, total_amount, issue_status, hometax_approval_no, item_title, issuer_entity_id, memo, issued_at, cancelled_at, created_at, period_start, period_end)
SELECT id, invoice_type, order_id, partner_id, buyer_identifier, identifier_type, supply_amount, vat_amount, total_amount, issue_status, hometax_approval_no, item_title, issuer_entity_id, memo, issued_at, cancelled_at, created_at, period_start, period_end FROM _v50_stash_ti;
DROP TABLE tax_invoices;
ALTER TABLE tax_invoices_v50 RENAME TO tax_invoices;
CREATE INDEX IF NOT EXISTS idx_tax_invoices_order ON tax_invoices(order_id);
CREATE INDEX IF NOT EXISTS idx_tax_invoices_partner ON tax_invoices(partner_id, issue_status);
CREATE INDEX IF NOT EXISTS idx_tax_invoices_created ON tax_invoices(created_at);
CREATE UNIQUE INDEX IF NOT EXISTS ux_tax_invoices_partner_period
  ON tax_invoices(partner_id, invoice_type, period_start, period_end)
  WHERE partner_id IS NOT NULL AND period_start IS NOT NULL;

CREATE TABLE IF NOT EXISTS _v50_guard (ok INTEGER NOT NULL CHECK (ok = 1));
INSERT INTO _v50_guard (ok) SELECT CASE WHEN
  (SELECT COUNT(*) FROM tax_invoices) = (SELECT COUNT(*) FROM _v50_stash_ti)
  AND (SELECT COUNT(*) FROM sqlite_master WHERE type = 'index' AND name IN ('idx_tax_invoices_order','idx_tax_invoices_partner','idx_tax_invoices_created','ux_tax_invoices_partner_period')) = 4
  THEN 1 ELSE 0 END;
DROP TABLE _v50_guard;
DROP TABLE _v50_stash_ti;

-- 6. inventory_ledger: add PURCHASE_RECEIVE (SELF_SHIP warehouse receipt).
DROP TRIGGER IF EXISTS trg_inventory_ledger_no_update;
DROP TRIGGER IF EXISTS trg_inventory_ledger_no_delete;
CREATE TABLE _v50_stash_il AS SELECT * FROM inventory_ledger;
DELETE FROM inventory_ledger;
CREATE TABLE inventory_ledger_v50 (
    id TEXT PRIMARY KEY,
    sku_id TEXT NOT NULL REFERENCES product_skus(id),
    change_type TEXT NOT NULL CHECK (change_type IN ('PURCHASE_DEDUCT', 'RESTOCK', 'RETURN_RESTOCK', 'MANUAL_ADJUST', 'ORDER_CANCEL', 'PURCHASE_RECEIVE')),
    quantity_delta INTEGER NOT NULL,
    balance_after INTEGER NOT NULL,
    reference_id TEXT NOT NULL,
    idempotency_key TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO inventory_ledger_v50 (id, sku_id, change_type, quantity_delta, balance_after, reference_id, idempotency_key, created_at)
SELECT id, sku_id, change_type, quantity_delta, balance_after, reference_id, idempotency_key, created_at FROM _v50_stash_il;
DROP TABLE inventory_ledger;
ALTER TABLE inventory_ledger_v50 RENAME TO inventory_ledger;
CREATE TRIGGER IF NOT EXISTS trg_inventory_ledger_no_update BEFORE UPDATE ON inventory_ledger BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_LEDGER'); END;
CREATE TRIGGER IF NOT EXISTS trg_inventory_ledger_no_delete BEFORE DELETE ON inventory_ledger BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_LEDGER'); END;

CREATE TABLE IF NOT EXISTS _v50_guard (ok INTEGER NOT NULL CHECK (ok = 1));
INSERT INTO _v50_guard (ok) SELECT CASE WHEN
  (SELECT COUNT(*) FROM inventory_ledger) = (SELECT COUNT(*) FROM _v50_stash_il)
  AND (SELECT COUNT(*) FROM sqlite_master WHERE type = 'trigger' AND name IN ('trg_inventory_ledger_no_update','trg_inventory_ledger_no_delete')) = 2
  THEN 1 ELSE 0 END;
DROP TABLE _v50_guard;
DROP TABLE _v50_stash_il;

INSERT OR IGNORE INTO schema_migrations (version, applied_at)
VALUES ('d1_50_wave_e_fds_purchase.sql', CURRENT_TIMESTAMP);
