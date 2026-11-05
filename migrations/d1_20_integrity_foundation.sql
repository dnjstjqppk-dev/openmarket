-- migrations/d1_20_integrity_foundation.sql
-- V3.0 Phase 3: transaction-integrity foundation.
--   * Operating business entities (sole proprietor today, corporation later) + immutable change history
--   * Orders / sub-orders / settlements / returns rebuilt with complete state sets (SQLite cannot ALTER a CHECK)
--   * Exact money allocation columns (coupon / credit / PG share per item and per shipping line)
--   * Idempotency keys, payment events, refunds, settlement adjustments, double-entry journal, admin audit log
--   * Direct-sales (MODEL A) suppliers, SKU sourcing mappings with resale authorisation, purchase orders
--   * DB-level guards: stock >= 0, credit balance >= 0, coupon single use, legal payment transitions,
--     refund caps, append-only ledgers
--
-- OPERATIONS NOTE (production): take `wrangler d1 export openmarket-db --remote --output=backup_pre_d1_20.sql`
-- and record the D1 Time Travel bookmark BEFORE applying. Rollback = restore that bookmark. See
-- reports/v3/B_DB_AUDIT.md section "Migration & rollback".

PRAGMA defer_foreign_keys = ON;

-- ---------------------------------------------------------------------------------------------
-- 1. Operating business entities
-- ---------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS business_entities (
    id TEXT PRIMARY KEY,
    role TEXT NOT NULL DEFAULT 'PLATFORM_OPERATOR' CHECK (role IN ('PLATFORM_OPERATOR', 'AFFILIATE')),
    entity_type TEXT NOT NULL CHECK (entity_type IN ('INDIVIDUAL', 'CORPORATION')),
    legal_name TEXT NOT NULL,
    representative_name TEXT NOT NULL,
    business_reg_number TEXT NOT NULL,
    corporate_reg_number TEXT,
    mail_order_reg_number TEXT,
    tax_type TEXT NOT NULL DEFAULT 'GENERAL' CHECK (tax_type IN ('GENERAL', 'SIMPLIFIED', 'TAX_EXEMPT')),
    address TEXT NOT NULL,
    cs_phone TEXT NOT NULL,
    cs_email TEXT NOT NULL,
    privacy_officer_name TEXT,
    privacy_officer_email TEXT,
    hosting_provider TEXT,
    pg_provider TEXT,
    pg_merchant_ref TEXT,
    escrow_service_ref TEXT,
    settlement_bank_ref TEXT,
    terms_version TEXT,
    status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'ACTIVE', 'RETIRED')),
    operating_from TEXT,
    operating_to TEXT,
    successor_entity_id TEXT REFERENCES business_entities(id),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CHECK (entity_type = 'INDIVIDUAL' OR corporate_reg_number IS NOT NULL)
);
-- At most one entity is the legal operator of the platform at any time.
CREATE UNIQUE INDEX IF NOT EXISTS ux_business_entities_active_operator
    ON business_entities(role) WHERE status = 'ACTIVE' AND role = 'PLATFORM_OPERATOR';
CREATE UNIQUE INDEX IF NOT EXISTS ux_business_entities_brn ON business_entities(business_reg_number);

CREATE TABLE IF NOT EXISTS business_entity_events (
    id TEXT PRIMARY KEY,
    entity_id TEXT NOT NULL REFERENCES business_entities(id),
    event_type TEXT NOT NULL,
    before_json TEXT,
    after_json TEXT,
    actor_user_id TEXT,
    note TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ---------------------------------------------------------------------------------------------
-- 2. Users / partners / products / coupons: additive columns
-- ---------------------------------------------------------------------------------------------
ALTER TABLE users ADD COLUMN failed_login_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN locked_until TEXT;
ALTER TABLE users ADD COLUMN token_version INTEGER NOT NULL DEFAULT 0;

ALTER TABLE partners ADD COLUMN sales_model TEXT NOT NULL DEFAULT 'MARKETPLACE' CHECK (sales_model IN ('MARKETPLACE', 'DIRECT'));
ALTER TABLE partners ADD COLUMN commission_rate_bps INTEGER;
ALTER TABLE partners ADD COLUMN operator_entity_id TEXT REFERENCES business_entities(id);
ALTER TABLE partners ADD COLUMN payout_account_verified INTEGER NOT NULL DEFAULT 0;
ALTER TABLE partners ADD COLUMN payout_change_request_json TEXT;
UPDATE partners SET commission_rate_bps = CAST(ROUND(commission_rate * 100) AS INTEGER) WHERE commission_rate_bps IS NULL;

ALTER TABLE products ADD COLUMN review_status TEXT NOT NULL DEFAULT 'APPROVED' CHECK (review_status IN ('PENDING', 'APPROVED', 'REJECTED'));
ALTER TABLE products ADD COLUMN review_note TEXT;

-- Remove duplicate coupon grants before enforcing one grant per (user, coupon).
DELETE FROM user_coupons WHERE rowid NOT IN (SELECT MIN(rowid) FROM user_coupons GROUP BY user_id, coupon_id);
CREATE UNIQUE INDEX IF NOT EXISTS ux_user_coupons_user_coupon ON user_coupons(user_id, coupon_id);
ALTER TABLE user_coupons ADD COLUMN used_order_id TEXT;

-- ---------------------------------------------------------------------------------------------
-- 2b. Rebuild safety under D1's always-on foreign keys (V3.1 fix, found by rehearsing on the production backup)
--     "copy -> DROP old parent -> RENAME new" leaves SQLite's deferred-FK counter non-zero whenever child rows
--     exist (DROP's implicit DELETE counts them as violations; RENAME never decrements), so COMMIT fails.
--     Instead: stash every affected table, empty them child-first, rebuild, then restore parent-first.
--     No DROP ever happens while a child row exists, and every restored row has its parent already present.
-- ---------------------------------------------------------------------------------------------
CREATE TABLE _v20_stash_orders AS SELECT * FROM orders;
CREATE TABLE _v20_stash_sub_orders AS SELECT * FROM sub_orders;
CREATE TABLE _v20_stash_order_items AS SELECT * FROM order_items;
CREATE TABLE _v20_stash_settlements AS SELECT * FROM settlements;
CREATE TABLE _v20_stash_returns AS SELECT * FROM returns;
CREATE TABLE _v20_stash_payment_tx AS SELECT * FROM payment_transactions;
CREATE TABLE _v20_stash_milestones AS SELECT * FROM milestone_tracking_logs;
DELETE FROM order_items;
DELETE FROM milestone_tracking_logs;
DELETE FROM payment_transactions;
DELETE FROM settlements;
DELETE FROM returns;
DELETE FROM sub_orders;
DELETE FROM orders;

-- ---------------------------------------------------------------------------------------------
-- 3. Orders (rebuild: payment state set + money allocation + entity attribution)
-- ---------------------------------------------------------------------------------------------
CREATE TABLE orders_v20 (
    id TEXT PRIMARY KEY,
    order_no TEXT NOT NULL UNIQUE,
    customer_id TEXT NOT NULL REFERENCES users(id),
    operator_entity_id TEXT REFERENCES business_entities(id),
    total_goods_amount INTEGER NOT NULL CHECK (total_goods_amount >= 0),
    total_shipping_amount INTEGER NOT NULL CHECK (total_shipping_amount >= 0),
    total_discount_amount INTEGER NOT NULL DEFAULT 0 CHECK (total_discount_amount >= 0),
    volume_discount_amount INTEGER NOT NULL DEFAULT 0 CHECK (volume_discount_amount >= 0),
    coupon_discount_amount INTEGER NOT NULL DEFAULT 0 CHECK (coupon_discount_amount >= 0),
    credit_used_amount INTEGER NOT NULL DEFAULT 0 CHECK (credit_used_amount >= 0),
    total_pay_amount INTEGER NOT NULL CHECK (total_pay_amount >= 0),
    refunded_pg_amount INTEGER NOT NULL DEFAULT 0 CHECK (refunded_pg_amount >= 0),
    refunded_credit_amount INTEGER NOT NULL DEFAULT 0 CHECK (refunded_credit_amount >= 0),
    currency TEXT NOT NULL DEFAULT 'KRW',
    payment_status TEXT NOT NULL DEFAULT 'READY' CHECK (payment_status IN ('READY', 'PAID', 'FAILED', 'EXPIRED', 'CANCELLED', 'PARTIAL_REFUNDED', 'REFUNDED', 'DELIVERED')),
    applied_user_coupon_id TEXT,
    checkout_idempotency_key TEXT,
    payment_expires_at TEXT,
    paid_at TEXT,
    cancelled_at TEXT,
    is_sandbox INTEGER NOT NULL DEFAULT 0,
    legacy_record INTEGER NOT NULL DEFAULT 0,
    terms_version TEXT,
    recipient_name TEXT NOT NULL,
    recipient_phone TEXT NOT NULL,
    shipping_address_line1 TEXT NOT NULL,
    shipping_address_line2 TEXT NOT NULL,
    shipping_postal_code TEXT NOT NULL,
    shipping_memo TEXT,
    pccc TEXT,
    pccc_verified INTEGER DEFAULT 0,
    customs_duty_type TEXT DEFAULT 'DDU',
    estimated_duty_amount INTEGER DEFAULT 0,
    settlement_currency TEXT DEFAULT 'KRW',
    fx_rate REAL DEFAULT 1.0,
    payment_key TEXT,
    pg_provider TEXT DEFAULT 'TOSS',
    pg_receipt_url TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CHECK (refunded_pg_amount <= total_pay_amount),
    CHECK (refunded_credit_amount <= credit_used_amount)
);
INSERT INTO orders_v20 (
    id, order_no, customer_id, operator_entity_id, total_goods_amount, total_shipping_amount, total_discount_amount,
    total_pay_amount, currency, payment_status, legacy_record, recipient_name, recipient_phone,
    shipping_address_line1, shipping_address_line2, shipping_postal_code, shipping_memo, pccc, pccc_verified,
    customs_duty_type, estimated_duty_amount, settlement_currency, fx_rate, payment_key, pg_provider, pg_receipt_url,
    created_at, updated_at)
SELECT id, order_no, customer_id, NULL, total_goods_amount, total_shipping_amount, total_discount_amount,
    total_pay_amount, currency, payment_status, 1, recipient_name, recipient_phone,
    shipping_address_line1, shipping_address_line2, shipping_postal_code, shipping_memo, pccc, pccc_verified,
    customs_duty_type, estimated_duty_amount, settlement_currency, fx_rate, payment_key, pg_provider, pg_receipt_url,
    created_at, updated_at
FROM _v20_stash_orders;
DROP TABLE orders;
ALTER TABLE orders_v20 RENAME TO orders;
INSERT INTO payment_transactions SELECT * FROM _v20_stash_payment_tx;
CREATE UNIQUE INDEX IF NOT EXISTS ux_orders_checkout_idem ON orders(customer_id, checkout_idempotency_key) WHERE checkout_idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_orders_customer_created ON orders(customer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_status_expiry ON orders(payment_status, payment_expires_at);
CREATE INDEX IF NOT EXISTS idx_orders_entity ON orders(operator_entity_id, created_at);

-- ---------------------------------------------------------------------------------------------
-- 4. Sub-orders (rebuild)
-- ---------------------------------------------------------------------------------------------
CREATE TABLE sub_orders_v20 (
    id TEXT PRIMARY KEY,
    parent_order_id TEXT NOT NULL REFERENCES orders(id),
    sub_order_no TEXT NOT NULL UNIQUE,
    partner_id TEXT NOT NULL REFERENCES partners(id),
    sales_model TEXT NOT NULL DEFAULT 'MARKETPLACE' CHECK (sales_model IN ('MARKETPLACE', 'DIRECT')),
    operator_entity_id TEXT REFERENCES business_entities(id),
    shipping_fee INTEGER NOT NULL CHECK (shipping_fee >= 0),
    goods_amount INTEGER NOT NULL CHECK (goods_amount >= 0),
    discount_amount INTEGER NOT NULL DEFAULT 0,
    total_amount INTEGER NOT NULL,
    coupon_discount_allocated INTEGER NOT NULL DEFAULT 0,
    shipping_credit_alloc INTEGER NOT NULL DEFAULT 0,
    shipping_pg_alloc INTEGER NOT NULL DEFAULT 0,
    shipping_refunded INTEGER NOT NULL DEFAULT 0 CHECK (shipping_refunded IN (0, 1)),
    status TEXT NOT NULL DEFAULT 'PAYMENT_PENDING' CHECK (status IN ('PAYMENT_PENDING', 'PAYMENT_CONFIRMED', 'PREPARING', 'SHIPPED', 'IN_TRANSIT', 'DELIVERED', 'PURCHASE_CONFIRMED', 'COMPLETED', 'CANCEL_REQUESTED', 'CANCELLED', 'RETURN_REQUESTED', 'RETURNED', 'EXPIRED')),
    carrier_code TEXT,
    tracking_number TEXT,
    shipped_at TEXT,
    delivered_at TEXT,
    purchase_confirmed_at TEXT,
    cancelled_at TEXT,
    milestone_status TEXT DEFAULT 'PREPARING',
    flight_vessel_no TEXT,
    customs_clearance_no TEXT,
    origin_country TEXT DEFAULT 'KR',
    destination_country TEXT DEFAULT 'KR',
    last_milestone_location TEXT,
    last_milestone_updated_at TEXT,
    estimated_delivery_date TEXT,
    is_late_compensated INTEGER DEFAULT 0,
    late_compensation_amount INTEGER DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO sub_orders_v20 (
    id, parent_order_id, sub_order_no, partner_id, shipping_fee, goods_amount, discount_amount, total_amount, status,
    carrier_code, tracking_number, shipped_at, delivered_at, milestone_status, flight_vessel_no, customs_clearance_no,
    origin_country, destination_country, last_milestone_location, last_milestone_updated_at, estimated_delivery_date,
    is_late_compensated, late_compensation_amount, created_at, updated_at)
SELECT id, parent_order_id, sub_order_no, partner_id, shipping_fee, goods_amount, discount_amount, total_amount, status,
    carrier_code, tracking_number, shipped_at, delivered_at, milestone_status, flight_vessel_no, customs_clearance_no,
    origin_country, destination_country, last_milestone_location, last_milestone_updated_at, estimated_delivery_date,
    is_late_compensated, late_compensation_amount, created_at, updated_at
FROM _v20_stash_sub_orders;
DROP TABLE sub_orders;
ALTER TABLE sub_orders_v20 RENAME TO sub_orders;
-- Children of sub_orders come back unchanged (before the additive ALTERs below, so SELECT * columns line up).
INSERT INTO order_items SELECT * FROM _v20_stash_order_items;
INSERT INTO milestone_tracking_logs SELECT * FROM _v20_stash_milestones;
CREATE INDEX IF NOT EXISTS idx_sub_orders_parent ON sub_orders(parent_order_id);
CREATE INDEX IF NOT EXISTS idx_sub_orders_partner_status ON sub_orders(partner_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sub_orders_delivered ON sub_orders(status, delivered_at);

-- ---------------------------------------------------------------------------------------------
-- 5. Order items: exact allocation + refund tracking (additive)
-- ---------------------------------------------------------------------------------------------
ALTER TABLE order_items ADD COLUMN product_id TEXT;
ALTER TABLE order_items ADD COLUMN base_unit_price INTEGER;
ALTER TABLE order_items ADD COLUMN volume_discount_pct INTEGER NOT NULL DEFAULT 0;
ALTER TABLE order_items ADD COLUMN coupon_alloc INTEGER NOT NULL DEFAULT 0;
ALTER TABLE order_items ADD COLUMN credit_alloc INTEGER NOT NULL DEFAULT 0;
ALTER TABLE order_items ADD COLUMN pg_alloc INTEGER NOT NULL DEFAULT 0;
ALTER TABLE order_items ADD COLUMN refunded_quantity INTEGER NOT NULL DEFAULT 0;
ALTER TABLE order_items ADD COLUMN refunded_pg_amount INTEGER NOT NULL DEFAULT 0;
ALTER TABLE order_items ADD COLUMN refunded_credit_amount INTEGER NOT NULL DEFAULT 0;
ALTER TABLE order_items ADD COLUMN refunded_coupon_amount INTEGER NOT NULL DEFAULT 0;
ALTER TABLE order_items ADD COLUMN unit_cost INTEGER;
CREATE INDEX IF NOT EXISTS idx_order_items_sub ON order_items(sub_order_id);
CREATE INDEX IF NOT EXISTS idx_order_items_sku ON order_items(sku_id);

-- ---------------------------------------------------------------------------------------------
-- 6. Settlements (rebuild) + adjustments + payouts
-- ---------------------------------------------------------------------------------------------
CREATE TABLE settlements_v20 (
    id TEXT PRIMARY KEY,
    sub_order_id TEXT NOT NULL UNIQUE REFERENCES sub_orders(id),
    partner_id TEXT NOT NULL REFERENCES partners(id),
    operator_entity_id TEXT REFERENCES business_entities(id),
    gross_amount INTEGER NOT NULL,
    shipping_fee INTEGER NOT NULL,
    commission_rate REAL NOT NULL,
    commission_rate_bps INTEGER,
    commission_amount INTEGER NOT NULL,
    net_payout_amount INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'HOLD' CHECK (status IN ('HOLD', 'PENDING', 'ELIGIBLE_FOR_PAYOUT', 'SETTLED', 'PAID_OUT', 'CANCELLED')),
    eligible_at TEXT,
    payout_id TEXT,
    settled_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO settlements_v20 (id, sub_order_id, partner_id, gross_amount, shipping_fee, commission_rate, commission_rate_bps,
    commission_amount, net_payout_amount, status, settled_at, created_at, updated_at)
SELECT id, sub_order_id, partner_id, gross_amount, shipping_fee, commission_rate,
    CAST(ROUND(CASE WHEN commission_rate < 1 THEN commission_rate * 10000 ELSE commission_rate * 100 END) AS INTEGER),
    commission_amount, net_payout_amount, status, settled_at, created_at, updated_at
FROM _v20_stash_settlements;
DROP TABLE settlements;
ALTER TABLE settlements_v20 RENAME TO settlements;
CREATE INDEX IF NOT EXISTS idx_settlements_partner_status ON settlements(partner_id, status);

CREATE TABLE IF NOT EXISTS settlement_adjustments (
    id TEXT PRIMARY KEY,
    settlement_id TEXT NOT NULL REFERENCES settlements(id),
    partner_id TEXT NOT NULL REFERENCES partners(id),
    refund_id TEXT,
    gross_delta INTEGER NOT NULL,
    commission_delta INTEGER NOT NULL,
    shipping_delta INTEGER NOT NULL,
    net_delta INTEGER NOT NULL,
    reason TEXT NOT NULL,
    applied_payout_id TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_settlement_adj_partner ON settlement_adjustments(partner_id, applied_payout_id);

CREATE TABLE IF NOT EXISTS payouts (
    id TEXT PRIMARY KEY,
    partner_id TEXT NOT NULL REFERENCES partners(id),
    operator_entity_id TEXT REFERENCES business_entities(id),
    amount INTEGER NOT NULL,
    settlement_count INTEGER NOT NULL,
    adjustment_count INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'APPROVED' CHECK (status IN ('APPROVED', 'TRANSFERRED', 'FAILED')),
    bank_transfer_ref TEXT,
    approved_by TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ---------------------------------------------------------------------------------------------
-- 7. Returns / claims (rebuild)
-- ---------------------------------------------------------------------------------------------
CREATE TABLE returns_v20 (
    id TEXT PRIMARY KEY,
    order_id TEXT NOT NULL REFERENCES orders(id),
    sub_order_id TEXT REFERENCES sub_orders(id),
    user_id TEXT NOT NULL REFERENCES users(id),
    claim_type TEXT NOT NULL CHECK (claim_type IN ('RETURN', 'EXCHANGE', 'PRICE_ADJUSTMENT')),
    reason TEXT NOT NULL,
    items_json TEXT,
    status TEXT NOT NULL DEFAULT 'REQUESTED' CHECK (status IN ('REQUESTED', 'APPROVED', 'REJECTED', 'REFUNDED', 'CANCELLED')),
    refund_amount INTEGER NOT NULL DEFAULT 0,
    refund_id TEXT,
    notes TEXT,
    is_returnless INTEGER DEFAULT 0,
    returnless_reason TEXT,
    processed_by TEXT,
    processed_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO returns_v20 (id, order_id, user_id, claim_type, reason, status, refund_amount, notes, is_returnless, returnless_reason, created_at)
SELECT id, order_id, user_id, claim_type, reason, status, refund_amount, notes, is_returnless, returnless_reason, created_at FROM _v20_stash_returns;
DROP TABLE returns;
ALTER TABLE returns_v20 RENAME TO returns;

-- Every stashed row must be back (a silent loss here would be a data-loss migration): abort otherwise.
CREATE TABLE IF NOT EXISTS _v20_guard (ok INTEGER NOT NULL CHECK (ok = 1));
INSERT INTO _v20_guard (ok) SELECT CASE WHEN
      (SELECT COUNT(*) FROM orders) = (SELECT COUNT(*) FROM _v20_stash_orders)
  AND (SELECT COUNT(*) FROM sub_orders) = (SELECT COUNT(*) FROM _v20_stash_sub_orders)
  AND (SELECT COUNT(*) FROM order_items) = (SELECT COUNT(*) FROM _v20_stash_order_items)
  AND (SELECT COUNT(*) FROM settlements) = (SELECT COUNT(*) FROM _v20_stash_settlements)
  AND (SELECT COUNT(*) FROM returns) = (SELECT COUNT(*) FROM _v20_stash_returns)
  AND (SELECT COUNT(*) FROM payment_transactions) = (SELECT COUNT(*) FROM _v20_stash_payment_tx)
  AND (SELECT COUNT(*) FROM milestone_tracking_logs) = (SELECT COUNT(*) FROM _v20_stash_milestones)
  THEN 1 ELSE 0 END;
DROP TABLE _v20_guard;
DROP TABLE _v20_stash_orders;
DROP TABLE _v20_stash_sub_orders;
DROP TABLE _v20_stash_order_items;
DROP TABLE _v20_stash_settlements;
DROP TABLE _v20_stash_returns;
DROP TABLE _v20_stash_payment_tx;
DROP TABLE _v20_stash_milestones;
CREATE INDEX IF NOT EXISTS idx_returns_order ON returns(order_id);
CREATE UNIQUE INDEX IF NOT EXISTS ux_returns_one_price_adjustment ON returns(order_id) WHERE claim_type = 'PRICE_ADJUSTMENT' AND status != 'REJECTED';

-- ---------------------------------------------------------------------------------------------
-- 8. Payments: capture uniqueness, sandbox flag, raw PG events, refunds
-- ---------------------------------------------------------------------------------------------
ALTER TABLE payment_transactions ADD COLUMN is_sandbox INTEGER NOT NULL DEFAULT 0;
ALTER TABLE payment_transactions ADD COLUMN cancelled_amount INTEGER NOT NULL DEFAULT 0;
CREATE UNIQUE INDEX IF NOT EXISTS ux_payment_capture_per_order ON payment_transactions(order_id) WHERE status != 'FAILED';

CREATE TABLE IF NOT EXISTS payment_events (
    id TEXT PRIMARY KEY,
    provider TEXT NOT NULL,
    event_key TEXT NOT NULL UNIQUE,
    event_type TEXT NOT NULL,
    order_id TEXT,
    payment_key TEXT,
    verified INTEGER NOT NULL DEFAULT 0,
    outcome TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS refunds (
    id TEXT PRIMARY KEY,
    order_id TEXT NOT NULL REFERENCES orders(id),
    sub_order_id TEXT REFERENCES sub_orders(id),
    claim_id TEXT,
    operator_entity_id TEXT REFERENCES business_entities(id),
    reason_code TEXT NOT NULL,
    goods_amount INTEGER NOT NULL DEFAULT 0 CHECK (goods_amount >= 0),
    shipping_amount INTEGER NOT NULL DEFAULT 0 CHECK (shipping_amount >= 0),
    coupon_reversal_amount INTEGER NOT NULL DEFAULT 0 CHECK (coupon_reversal_amount >= 0),
    pg_amount INTEGER NOT NULL DEFAULT 0 CHECK (pg_amount >= 0),
    credit_amount INTEGER NOT NULL DEFAULT 0 CHECK (credit_amount >= 0),
    items_json TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'DONE', 'FAILED')),
    pg_transaction_key TEXT,
    is_sandbox INTEGER NOT NULL DEFAULT 0,
    idempotency_key TEXT NOT NULL UNIQUE,
    requested_by TEXT NOT NULL,
    failure_reason TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    completed_at TEXT,
    CHECK (goods_amount + shipping_amount = coupon_reversal_amount + pg_amount + credit_amount)
);
CREATE INDEX IF NOT EXISTS idx_refunds_order ON refunds(order_id);

-- ---------------------------------------------------------------------------------------------
-- 9. Idempotency, journal, audit
-- ---------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS idempotency_keys (
    scope TEXT NOT NULL,
    idem_key TEXT NOT NULL,
    principal_id TEXT NOT NULL,
    reference_id TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (scope, idem_key)
);

CREATE TABLE IF NOT EXISTS journal_entries (
    id TEXT PRIMARY KEY,
    txn_id TEXT NOT NULL,
    txn_type TEXT NOT NULL,
    entity_id TEXT REFERENCES business_entities(id),
    account_code TEXT NOT NULL,
    debit INTEGER NOT NULL DEFAULT 0 CHECK (debit >= 0),
    credit INTEGER NOT NULL DEFAULT 0 CHECK (credit >= 0),
    order_id TEXT,
    sub_order_id TEXT,
    partner_id TEXT,
    refund_id TEXT,
    memo TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CHECK ((debit = 0) <> (credit = 0))
);
CREATE INDEX IF NOT EXISTS idx_journal_txn ON journal_entries(txn_id);
CREATE INDEX IF NOT EXISTS idx_journal_entity_account ON journal_entries(entity_id, account_code);
CREATE INDEX IF NOT EXISTS idx_journal_order ON journal_entries(order_id);

CREATE TABLE IF NOT EXISTS admin_audit_log (
    id TEXT PRIMARY KEY,
    actor_user_id TEXT NOT NULL,
    actor_role TEXT NOT NULL,
    action TEXT NOT NULL,
    target_type TEXT NOT NULL,
    target_id TEXT,
    before_json TEXT,
    after_json TEXT,
    ip TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_admin_audit_target ON admin_audit_log(target_type, target_id);

-- ---------------------------------------------------------------------------------------------
-- 10. MODEL A: suppliers, sourcing mappings, purchase orders
-- ---------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS suppliers (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    business_reg_number TEXT,
    contact_name TEXT,
    contact_phone TEXT,
    contact_email TEXT,
    contract_ref TEXT,
    api_integration_status TEXT NOT NULL DEFAULT 'NONE' CHECK (api_integration_status IN ('NONE', 'SANDBOX', 'LIVE')),
    status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'SUSPENDED', 'TERMINATED')),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS supplier_sku_mappings (
    id TEXT PRIMARY KEY,
    sku_id TEXT NOT NULL REFERENCES product_skus(id),
    supplier_id TEXT NOT NULL REFERENCES suppliers(id),
    supplier_sku_code TEXT NOT NULL,
    unit_cost INTEGER NOT NULL CHECK (unit_cost >= 0),
    fulfillment_mode TEXT NOT NULL DEFAULT 'DROP_SHIP' CHECK (fulfillment_mode IN ('DROP_SHIP', 'SELF_SHIP')),
    resale_authorized INTEGER NOT NULL DEFAULT 0 CHECK (resale_authorized IN (0, 1)),
    image_use_authorized INTEGER NOT NULL DEFAULT 0 CHECK (image_use_authorized IN (0, 1)),
    authorization_evidence TEXT,
    valid_until TEXT,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_supplier_mapping_active_sku ON supplier_sku_mappings(sku_id) WHERE is_active = 1;

CREATE TABLE IF NOT EXISTS purchase_orders (
    id TEXT PRIMARY KEY,
    po_no TEXT NOT NULL UNIQUE,
    supplier_id TEXT NOT NULL REFERENCES suppliers(id),
    sub_order_id TEXT NOT NULL REFERENCES sub_orders(id),
    operator_entity_id TEXT REFERENCES business_entities(id),
    fulfillment_mode TEXT NOT NULL CHECK (fulfillment_mode IN ('DROP_SHIP', 'SELF_SHIP')),
    dispatch_method TEXT NOT NULL DEFAULT 'MANUAL' CHECK (dispatch_method IN ('MANUAL', 'API')),
    status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'SENT', 'CONFIRMED', 'SHIPPED', 'FAILED', 'CANCELLED')),
    total_cost INTEGER NOT NULL CHECK (total_cost >= 0),
    supplier_order_ref TEXT,
    failure_reason TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_purchase_orders_sub_supplier ON purchase_orders(sub_order_id, supplier_id);

CREATE TABLE IF NOT EXISTS purchase_order_items (
    id TEXT PRIMARY KEY,
    purchase_order_id TEXT NOT NULL REFERENCES purchase_orders(id),
    order_item_id TEXT NOT NULL REFERENCES order_items(id),
    sku_id TEXT NOT NULL,
    supplier_sku_code TEXT NOT NULL,
    quantity INTEGER NOT NULL CHECK (quantity > 0),
    unit_cost INTEGER NOT NULL CHECK (unit_cost >= 0)
);

-- ---------------------------------------------------------------------------------------------
-- 11. Integrity triggers (atomic guards evaluated inside the same D1 batch)
-- ---------------------------------------------------------------------------------------------
CREATE TRIGGER IF NOT EXISTS trg_sku_stock_nonnegative
BEFORE UPDATE OF stock_quantity ON product_skus
WHEN NEW.stock_quantity < 0
BEGIN SELECT RAISE(ABORT, 'STOCK_INSUFFICIENT'); END;

CREATE TRIGGER IF NOT EXISTS trg_credit_balance_nonnegative
BEFORE INSERT ON user_credits
WHEN NEW.amount_delta < 0
 AND (SELECT COALESCE(SUM(amount_delta), 0) FROM user_credits WHERE user_id = NEW.user_id) + NEW.amount_delta < 0
BEGIN SELECT RAISE(ABORT, 'CREDIT_INSUFFICIENT'); END;

CREATE TRIGGER IF NOT EXISTS trg_user_coupon_single_use
BEFORE UPDATE OF is_used ON user_coupons
WHEN OLD.is_used = 1 AND NEW.is_used = 1
BEGIN SELECT RAISE(ABORT, 'COUPON_ALREADY_USED'); END;

CREATE TRIGGER IF NOT EXISTS trg_orders_payment_transition
BEFORE UPDATE OF payment_status ON orders
WHEN NOT (
       (OLD.payment_status = 'READY' AND NEW.payment_status IN ('PAID', 'FAILED', 'EXPIRED', 'CANCELLED'))
    OR (OLD.payment_status = 'PAID' AND NEW.payment_status IN ('PARTIAL_REFUNDED', 'REFUNDED', 'CANCELLED'))
    OR (OLD.payment_status = 'PARTIAL_REFUNDED' AND NEW.payment_status IN ('PARTIAL_REFUNDED', 'REFUNDED', 'CANCELLED'))
    OR (OLD.payment_status = 'DELIVERED' AND NEW.payment_status IN ('PARTIAL_REFUNDED', 'REFUNDED'))
)
BEGIN SELECT RAISE(ABORT, 'ILLEGAL_PAYMENT_TRANSITION'); END;

CREATE TRIGGER IF NOT EXISTS trg_order_items_refund_caps
BEFORE UPDATE ON order_items
WHEN NEW.refunded_quantity > NEW.quantity
  OR NEW.refunded_quantity < 0
  OR NEW.refunded_pg_amount > NEW.pg_alloc
  OR NEW.refunded_credit_amount > NEW.credit_alloc
  OR NEW.refunded_coupon_amount > NEW.coupon_alloc
BEGIN SELECT RAISE(ABORT, 'REFUND_EXCEEDS_PAID'); END;

-- Append-only ledgers: corrections are new rows, never edits.
CREATE TRIGGER IF NOT EXISTS trg_inventory_ledger_no_update BEFORE UPDATE ON inventory_ledger BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_LEDGER'); END;
CREATE TRIGGER IF NOT EXISTS trg_inventory_ledger_no_delete BEFORE DELETE ON inventory_ledger BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_LEDGER'); END;
CREATE TRIGGER IF NOT EXISTS trg_journal_no_update BEFORE UPDATE ON journal_entries BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_LEDGER'); END;
CREATE TRIGGER IF NOT EXISTS trg_journal_no_delete BEFORE DELETE ON journal_entries BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_LEDGER'); END;
CREATE TRIGGER IF NOT EXISTS trg_admin_audit_no_update BEFORE UPDATE ON admin_audit_log BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_LEDGER'); END;
CREATE TRIGGER IF NOT EXISTS trg_admin_audit_no_delete BEFORE DELETE ON admin_audit_log BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_LEDGER'); END;
CREATE TRIGGER IF NOT EXISTS trg_entity_events_no_update BEFORE UPDATE ON business_entity_events BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_LEDGER'); END;
CREATE TRIGGER IF NOT EXISTS trg_entity_events_no_delete BEFORE DELETE ON business_entity_events BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_LEDGER'); END;
CREATE TRIGGER IF NOT EXISTS trg_payment_events_no_update BEFORE UPDATE ON payment_events BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_LEDGER'); END;
CREATE TRIGGER IF NOT EXISTS trg_payment_events_no_delete BEFORE DELETE ON payment_events BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_LEDGER'); END;
CREATE TRIGGER IF NOT EXISTS trg_payment_tx_no_delete BEFORE DELETE ON payment_transactions BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_LEDGER'); END;
CREATE TRIGGER IF NOT EXISTS trg_payment_tx_frozen_fields
BEFORE UPDATE OF amount, order_id, payment_key, provider ON payment_transactions
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_LEDGER'); END;
CREATE TRIGGER IF NOT EXISTS trg_refunds_no_delete BEFORE DELETE ON refunds BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_LEDGER'); END;
CREATE TRIGGER IF NOT EXISTS trg_refunds_frozen_amounts
BEFORE UPDATE OF order_id, goods_amount, shipping_amount, coupon_reversal_amount, pg_amount, credit_amount, items_json ON refunds
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_LEDGER'); END;
CREATE TRIGGER IF NOT EXISTS trg_user_credits_no_update BEFORE UPDATE ON user_credits BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_LEDGER'); END;
CREATE TRIGGER IF NOT EXISTS trg_user_credits_no_delete BEFORE DELETE ON user_credits BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_LEDGER'); END;
-- Entity attribution of an order can never be rewritten (no bulk re-attribution on incorporation).
CREATE TRIGGER IF NOT EXISTS trg_orders_entity_frozen
BEFORE UPDATE OF operator_entity_id ON orders
WHEN OLD.operator_entity_id IS NOT NULL AND (NEW.operator_entity_id IS NULL OR NEW.operator_entity_id != OLD.operator_entity_id)
BEGIN SELECT RAISE(ABORT, 'ENTITY_ATTRIBUTION_IMMUTABLE'); END;
CREATE TRIGGER IF NOT EXISTS trg_settlements_entity_frozen
BEFORE UPDATE OF operator_entity_id ON settlements
WHEN OLD.operator_entity_id IS NOT NULL AND (NEW.operator_entity_id IS NULL OR NEW.operator_entity_id != OLD.operator_entity_id)
BEGIN SELECT RAISE(ABORT, 'ENTITY_ATTRIBUTION_IMMUTABLE'); END;

CREATE TRIGGER IF NOT EXISTS trg_sub_orders_shipping_refund_once
BEFORE UPDATE OF shipping_refunded ON sub_orders
WHEN OLD.shipping_refunded = 1 AND NEW.shipping_refunded = 1
BEGIN SELECT RAISE(ABORT, 'SHIPPING_ALREADY_REFUNDED'); END;

-- ---------------------------------------------------------------------------------------------
-- 12. Opening balance: credits that existed before the journal was introduced become a liability
--     so that SUM(user_credits) reconciles exactly with the CUSTOMER_CREDIT_LIABILITY account.
-- ---------------------------------------------------------------------------------------------
INSERT INTO journal_entries (id, txn_id, txn_type, entity_id, account_code, debit, credit, memo)
SELECT 'jrn_opening_credit_dr', 'txn_opening_credit', 'OPENING_BALANCE', NULL, 'LEGACY_OPENING_EQUITY', SUM(amount_delta), 0, 'pre-d1_20 customer credit balance'
FROM user_credits HAVING COALESCE(SUM(amount_delta), 0) > 0;
INSERT INTO journal_entries (id, txn_id, txn_type, entity_id, account_code, debit, credit, memo)
SELECT 'jrn_opening_credit_cr', 'txn_opening_credit', 'OPENING_BALANCE', NULL, 'CUSTOMER_CREDIT_LIABILITY', 0, SUM(amount_delta), 'pre-d1_20 customer credit balance'
FROM user_credits HAVING COALESCE(SUM(amount_delta), 0) > 0;

-- ---------------------------------------------------------------------------------------------
-- 13. In-batch assertions: `INSERT INTO batch_assertions(code) SELECT 'X' WHERE <violation>` aborts the batch.
-- ---------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS batch_assertions (id INTEGER PRIMARY KEY, code TEXT NOT NULL);
CREATE TRIGGER IF NOT EXISTS trg_batch_assertion_abort BEFORE INSERT ON batch_assertions
BEGIN SELECT RAISE(ABORT, 'BATCH_ASSERTION_FAILED'); END;
