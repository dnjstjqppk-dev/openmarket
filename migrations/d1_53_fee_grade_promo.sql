-- d1_53: fee / coupon / credit / grade / promo tables (work order 2-1).
-- New parallel ledgers; legacy coupons/user_coupons/user_credits stay untouched
-- (no data move in this step). Money is integer KRW; rates are basis points.
-- NOTE: the work order defers to OPENMARKET_FULL_MASTER_SPEC.md appendix A for
-- this DDL, but the appendix carries a different table set, so this file
-- authors the work-order table names directly (see WORK_ORDER_QUESTIONS Q-2-1).

CREATE TABLE IF NOT EXISTS fee_schedules (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    category_id TEXT REFERENCES categories(id),
    rate_bp INTEGER NOT NULL,
    base TEXT NOT NULL DEFAULT 'SALE_PRICE' CHECK (base IN ('SALE_PRICE', 'NET_GOODS')),
    valid_from TEXT,
    valid_to TEXT,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_fee_schedules_cat ON fee_schedules(category_id);

CREATE TABLE IF NOT EXISTS partner_fees (
    id TEXT PRIMARY KEY,
    partner_id TEXT NOT NULL REFERENCES partners(id),
    rate_bp INTEGER NOT NULL,
    valid_from TEXT,
    valid_to TEXT,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_partner_fees_partner ON partner_fees(partner_id);

CREATE TABLE IF NOT EXISTS pg_fee_policies (
    id TEXT PRIMARY KEY,
    method TEXT NOT NULL,
    rate_bp INTEGER NOT NULL DEFAULT 0,
    fixed_fee INTEGER NOT NULL DEFAULT 0,
    pass_to_seller INTEGER NOT NULL DEFAULT 0,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS coupon_definitions (
    id TEXT PRIMARY KEY,
    owner_type TEXT NOT NULL CHECK (owner_type IN ('PLATFORM', 'SELLER')),
    partner_id TEXT REFERENCES partners(id),
    code TEXT UNIQUE,
    title TEXT NOT NULL,
    discount_type TEXT NOT NULL CHECK (discount_type IN ('PERCENT', 'FIXED_AMOUNT')),
    discount_value INTEGER NOT NULL,
    min_order_amount INTEGER NOT NULL DEFAULT 0,
    max_discount_amount INTEGER,
    per_user_limit INTEGER NOT NULL DEFAULT 1,
    total_limit INTEGER,
    valid_from TEXT,
    valid_to TEXT,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS coupon_issued (
    id TEXT PRIMARY KEY,
    definition_id TEXT NOT NULL REFERENCES coupon_definitions(id),
    user_id TEXT NOT NULL REFERENCES users(id),
    status TEXT NOT NULL DEFAULT 'ISSUED' CHECK (status IN ('ISSUED', 'USED', 'EXPIRED', 'REVOKED')),
    issued_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    used_at TEXT,
    order_id TEXT REFERENCES orders(id)
);
CREATE INDEX IF NOT EXISTS idx_coupon_issued_user ON coupon_issued(user_id);

CREATE TABLE IF NOT EXISTS coupon_redemptions (
    id TEXT PRIMARY KEY,
    definition_id TEXT NOT NULL REFERENCES coupon_definitions(id),
    user_id TEXT NOT NULL REFERENCES users(id),
    order_id TEXT NOT NULL REFERENCES orders(id),
    discount_applied INTEGER NOT NULL,
    redeemed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (definition_id, order_id)
);

CREATE TABLE IF NOT EXISTS customer_credits (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL UNIQUE REFERENCES users(id),
    balance INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS credit_ledger (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    amount_delta INTEGER NOT NULL,
    balance_after INTEGER NOT NULL,
    reason TEXT NOT NULL,
    reference_id TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_credit_ledger_user ON credit_ledger(user_id);

CREATE TABLE IF NOT EXISTS earn_policies (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    source TEXT NOT NULL,
    rate_bp INTEGER NOT NULL,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS point_policies (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    min_order_amount INTEGER NOT NULL DEFAULT 0,
    max_use_ratio_bp INTEGER NOT NULL DEFAULT 10000,
    expiry_days INTEGER,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS seller_grades (
    id TEXT PRIMARY KEY,
    partner_id TEXT NOT NULL UNIQUE REFERENCES partners(id),
    grade TEXT NOT NULL,
    score INTEGER NOT NULL DEFAULT 0,
    computed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    valid_from TEXT,
    valid_to TEXT
);

CREATE TABLE IF NOT EXISTS seller_grade_history (
    id TEXT PRIMARY KEY,
    partner_id TEXT NOT NULL REFERENCES partners(id),
    grade TEXT NOT NULL,
    score INTEGER NOT NULL DEFAULT 0,
    reason TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_seller_grade_history_partner ON seller_grade_history(partner_id);

CREATE TABLE IF NOT EXISTS seller_penalties (
    id TEXT PRIMARY KEY,
    partner_id TEXT NOT NULL REFERENCES partners(id),
    rule_code TEXT NOT NULL,
    points INTEGER NOT NULL DEFAULT 0,
    amount INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'APPEALED', 'CONFIRMED', 'WAIVED')),
    order_id TEXT REFERENCES orders(id),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    resolved_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_seller_penalties_partner ON seller_penalties(partner_id);

CREATE TABLE IF NOT EXISTS price_history (
    id TEXT PRIMARY KEY,
    sku_id TEXT NOT NULL REFERENCES product_skus(id),
    old_price INTEGER,
    new_price INTEGER NOT NULL,
    changed_by TEXT,
    changed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_price_history_sku ON price_history(sku_id);

CREATE TABLE IF NOT EXISTS return_labels (
    id TEXT PRIMARY KEY,
    carrier TEXT NOT NULL DEFAULT '',
    tracking_number TEXT NOT NULL DEFAULT '',
    label_url TEXT,
    status TEXT NOT NULL DEFAULT 'READY',
    claim_id TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS bulk_jobs (
    id TEXT PRIMARY KEY,
    partner_id TEXT NOT NULL REFERENCES partners(id),
    job_type TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'QUEUED' CHECK (status IN ('QUEUED', 'PROCESSING', 'COMPLETED', 'FAILED')),
    total_rows INTEGER NOT NULL DEFAULT 0,
    processed_rows INTEGER NOT NULL DEFAULT 0,
    success_rows INTEGER NOT NULL DEFAULT 0,
    failed_rows INTEGER NOT NULL DEFAULT 0,
    error_log TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_bulk_jobs_partner ON bulk_jobs(partner_id);

INSERT OR IGNORE INTO schema_migrations (version, applied_at)
VALUES ('d1_53_fee_grade_promo.sql', CURRENT_TIMESTAMP);
