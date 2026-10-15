-- 000006_global_marketing_and_import_sync.up.sql
-- Global Multi-Currency, Tax Rules, Coupons, and Bulk Import/Sync Engine

CREATE TABLE IF NOT EXISTS currencies (
    code VARCHAR(3) PRIMARY KEY,
    name VARCHAR(50) NOT NULL,
    symbol VARCHAR(10) NOT NULL,
    decimal_digits INT NOT NULL DEFAULT 0,
    is_active BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS exchange_rates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    base_currency VARCHAR(3) NOT NULL REFERENCES currencies(code),
    target_currency VARCHAR(3) NOT NULL REFERENCES currencies(code),
    rate NUMERIC(18, 6) NOT NULL CHECK (rate > 0),
    source VARCHAR(50) NOT NULL DEFAULT 'SYSTEM_ECB',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (base_currency, target_currency, created_at)
);

CREATE TABLE IF NOT EXISTS countries (
    code VARCHAR(2) PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    default_currency VARCHAR(3) NOT NULL REFERENCES currencies(code),
    is_shipping_available BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS promotions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title VARCHAR(150) NOT NULL,
    description TEXT,
    discount_type VARCHAR(20) NOT NULL CHECK (discount_type IN ('PERCENT', 'FIXED_AMOUNT')),
    discount_value BIGINT NOT NULL CHECK (discount_value > 0),
    min_order_amount BIGINT NOT NULL DEFAULT 0,
    max_discount_amount BIGINT,
    starts_at TIMESTAMPTZ NOT NULL,
    ends_at TIMESTAMPTZ NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS coupons (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code VARCHAR(50) NOT NULL UNIQUE,
    promotion_id UUID NOT NULL REFERENCES promotions(id) ON DELETE CASCADE,
    total_quantity INT NOT NULL CHECK (total_quantity > 0),
    issued_quantity INT NOT NULL DEFAULT 0 CHECK (issued_quantity <= total_quantity),
    per_user_limit INT NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS coupon_redemptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    coupon_id UUID NOT NULL REFERENCES coupons(id) ON DELETE RESTRICT,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    discount_applied BIGINT NOT NULL CHECK (discount_applied > 0),
    redeemed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (coupon_id, order_id)
);

CREATE TABLE IF NOT EXISTS import_batches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    partner_id UUID NOT NULL REFERENCES partners(id) ON DELETE CASCADE,
    file_name VARCHAR(255) NOT NULL,
    file_type VARCHAR(20) NOT NULL CHECK (file_type IN ('EXCEL', 'CSV', 'JSON')),
    total_rows INT NOT NULL DEFAULT 0,
    processed_rows INT NOT NULL DEFAULT 0,
    success_rows INT NOT NULL DEFAULT 0,
    failed_rows INT NOT NULL DEFAULT 0,
    status VARCHAR(20) NOT NULL DEFAULT 'QUEUED' CHECK (status IN ('QUEUED', 'PROCESSING', 'COMPLETED', 'FAILED')),
    error_summary TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS import_rows (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    batch_id UUID NOT NULL REFERENCES import_batches(id) ON DELETE CASCADE,
    row_number INT NOT NULL,
    raw_data JSONB NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'SUCCESS', 'FAILED')),
    error_message TEXT
);

CREATE TABLE IF NOT EXISTS supplier_sync_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    partner_id UUID NOT NULL REFERENCES partners(id) ON DELETE CASCADE,
    sync_type VARCHAR(30) NOT NULL CHECK (sync_type IN ('PRODUCT_CATALOG', 'STOCK_LEVEL', 'PRICE_REFRESH')),
    items_synced INT NOT NULL DEFAULT 0,
    status VARCHAR(20) NOT NULL DEFAULT 'SUCCESS' CHECK (status IN ('SUCCESS', 'PARTIAL', 'FAILED')),
    error_detail TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS feature_flags (
    key VARCHAR(80) PRIMARY KEY,
    description VARCHAR(255) NOT NULL,
    is_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

