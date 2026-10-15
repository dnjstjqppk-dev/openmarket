CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    full_name VARCHAR(100) NOT NULL,
    phone VARCHAR(30) NOT NULL,
    role VARCHAR(20) NOT NULL CHECK (role IN ('ROLE_CUSTOMER', 'ROLE_PARTNER', 'ROLE_ADMIN')),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE partners (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE RESTRICT,
    business_name VARCHAR(150) NOT NULL,
    business_reg_number VARCHAR(40) NOT NULL UNIQUE,
    commission_rate NUMERIC(5, 2) NOT NULL DEFAULT 10.00 CHECK (commission_rate >= 0.00 AND commission_rate <= 50.00),
    bank_code VARCHAR(20) NOT NULL,
    bank_account_number VARCHAR(60) NOT NULL,
    bank_account_holder VARCHAR(100) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED', 'SUSPENDED')),
    base_shipping_fee BIGINT NOT NULL DEFAULT 3000 CHECK (base_shipping_fee >= 0),
    free_shipping_threshold BIGINT NOT NULL DEFAULT 30000 CHECK (free_shipping_threshold >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE categories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    parent_id UUID REFERENCES categories(id) ON DELETE RESTRICT,
    name VARCHAR(100) NOT NULL,
    slug VARCHAR(120) NOT NULL UNIQUE,
    depth INT NOT NULL DEFAULT 0 CHECK (depth >= 0 AND depth <= 4),
    sort_order INT NOT NULL DEFAULT 0,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE products (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    partner_id UUID NOT NULL REFERENCES partners(id) ON DELETE RESTRICT,
    category_id UUID NOT NULL REFERENCES categories(id) ON DELETE RESTRICT,
    title VARCHAR(200) NOT NULL,
    thumbnail_url TEXT NOT NULL,
    description_html TEXT NOT NULL,
    lowest_original_price BIGINT NOT NULL CHECK (lowest_original_price >= 0),
    lowest_sale_price BIGINT NOT NULL CHECK (lowest_sale_price >= 0 AND lowest_sale_price <= lowest_original_price),
    total_sold_count BIGINT NOT NULL DEFAULT 0 CHECK (total_sold_count >= 0),
    status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('DRAFT', 'ACTIVE', 'HIDDEN', 'DELETED')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE product_skus (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    sku_code VARCHAR(64) NOT NULL UNIQUE,
    option_combination JSONB NOT NULL,
    original_price BIGINT NOT NULL CHECK (original_price >= 0),
    sale_price BIGINT NOT NULL CHECK (sale_price >= 0 AND sale_price <= original_price),
    stock_quantity INT NOT NULL DEFAULT 0 CHECK (stock_quantity >= 0),
    status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'OUT_OF_STOCK', 'HIDDEN')),
    version INT NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE flash_sale_campaigns (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title VARCHAR(150) NOT NULL,
    starts_at TIMESTAMPTZ NOT NULL,
    ends_at TIMESTAMPTZ NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'SCHEDULED' CHECK (status IN ('SCHEDULED', 'LIVE', 'ENDED', 'CANCELLED')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (ends_at > starts_at)
);

CREATE TABLE flash_sale_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id UUID NOT NULL REFERENCES flash_sale_campaigns(id) ON DELETE CASCADE,
    sku_id UUID NOT NULL REFERENCES product_skus(id) ON DELETE RESTRICT,
    flash_price BIGINT NOT NULL CHECK (flash_price >= 0),
    allocated_stock INT NOT NULL CHECK (allocated_stock > 0),
    remaining_stock INT NOT NULL CHECK (remaining_stock >= 0 AND remaining_stock <= allocated_stock),
    per_user_limit INT NOT NULL DEFAULT 1 CHECK (per_user_limit > 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (campaign_id, sku_id)
);

CREATE TABLE sdui_layouts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    target_platform VARCHAR(15) NOT NULL CHECK (target_platform IN ('WEB', 'MOBILE', 'ALL')),
    version INT NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT FALSE,
    blocks_payload JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (target_platform, version)
);

CREATE TABLE orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    buyer_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    idempotency_key UUID NOT NULL UNIQUE,
    total_item_amount BIGINT NOT NULL CHECK (total_item_amount >= 0),
    total_shipping_fee BIGINT NOT NULL CHECK (total_shipping_fee >= 0),
    total_pay_amount BIGINT NOT NULL CHECK (total_pay_amount = total_item_amount + total_shipping_fee),
    payment_method VARCHAR(30) NOT NULL,
    pg_transaction_id VARCHAR(120) UNIQUE,
    recipient_name VARCHAR(80) NOT NULL,
    recipient_phone VARCHAR(25) NOT NULL,
    shipping_address VARCHAR(300) NOT NULL,
    payment_status VARCHAR(25) NOT NULL DEFAULT 'PAYMENT_PENDING' CHECK (
        payment_status IN ('PAYMENT_PENDING', 'PAID', 'PARTIALLY_REFUNDED', 'REFUNDED', 'FAILED')
    ),
    paid_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE sub_orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id UUID NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
    partner_id UUID NOT NULL REFERENCES partners(id) ON DELETE RESTRICT,
    sub_item_amount BIGINT NOT NULL CHECK (sub_item_amount >= 0),
    shipping_fee BIGINT NOT NULL CHECK (shipping_fee >= 0),
    sub_total_amount BIGINT NOT NULL CHECK (sub_total_amount = sub_item_amount + shipping_fee),
    applied_commission_rate NUMERIC(5, 2) NOT NULL,
    status VARCHAR(30) NOT NULL DEFAULT 'PAYMENT_PENDING' CHECK (
        status IN (
            'PAYMENT_PENDING', 'PAID', 'PREPARING', 'SHIPPED',
            'DELIVERED', 'PURCHASE_CONFIRMED', 'CANCELLED', 'RETURN_REQUESTED', 'REFUNDED'
        )
    ),
    carrier_code VARCHAR(30),
    tracking_number VARCHAR(50),
    shipped_at TIMESTAMPTZ,
    delivered_at TIMESTAMPTZ,
    purchase_confirmed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (order_id, partner_id)
);

CREATE TABLE order_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sub_order_id UUID NOT NULL REFERENCES sub_orders(id) ON DELETE CASCADE,
    product_id UUID NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
    sku_id UUID NOT NULL REFERENCES product_skus(id) ON DELETE RESTRICT,
    flash_sale_item_id UUID REFERENCES flash_sale_items(id) ON DELETE SET NULL,
    sku_option_snapshot JSONB NOT NULL,
    unit_price BIGINT NOT NULL CHECK (unit_price >= 0),
    quantity INT NOT NULL CHECK (quantity > 0),
    line_total_amount BIGINT NOT NULL CHECK (line_total_amount = unit_price * quantity),
    claim_status VARCHAR(25) NOT NULL DEFAULT 'NONE' CHECK (
        claim_status IN ('NONE', 'CANCELLED', 'RETURN_REQUESTED', 'REFUNDED')
    ),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE ledger_accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_code VARCHAR(50) NOT NULL UNIQUE,
    account_type VARCHAR(30) NOT NULL CHECK (
        account_type IN ('PG_RECEIVABLE', 'PLATFORM_ESCROW', 'PLATFORM_REVENUE', 'PARTNER_PAYABLE', 'PARTNER_PAID')
    ),
    partner_id UUID REFERENCES partners(id) ON DELETE RESTRICT,
    balance BIGINT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE ledger_transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    reference_type VARCHAR(30) NOT NULL CHECK (
        reference_type IN ('ORDER_PAYMENT', 'PURCHASE_CONFIRM', 'ORDER_REFUND', 'PARTNER_SETTLEMENT_PAYOUT')
    ),
    reference_id UUID NOT NULL,
    description VARCHAR(255) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (reference_type, reference_id)
);

CREATE TABLE ledger_entries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    transaction_id UUID NOT NULL REFERENCES ledger_transactions(id) ON DELETE RESTRICT,
    account_id UUID NOT NULL REFERENCES ledger_accounts(id) ON DELETE RESTRICT,
    direction VARCHAR(10) NOT NULL CHECK (direction IN ('DEBIT', 'CREDIT')),
    amount BIGINT NOT NULL CHECK (amount > 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE settlements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    partner_id UUID NOT NULL REFERENCES partners(id) ON DELETE RESTRICT,
    period_start DATE NOT NULL,
    period_end DATE NOT NULL,
    gross_sales_amount BIGINT NOT NULL CHECK (gross_sales_amount >= 0),
    shipping_fee_amount BIGINT NOT NULL CHECK (shipping_fee_amount >= 0),
    commission_amount BIGINT NOT NULL CHECK (commission_amount >= 0),
    refund_deduction_amount BIGINT NOT NULL DEFAULT 0 CHECK (refund_deduction_amount >= 0),
    net_payout_amount BIGINT NOT NULL CHECK (
        net_payout_amount = gross_sales_amount + shipping_fee_amount - commission_amount - refund_deduction_amount
    ),
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'APPROVED', 'PAID', 'HELD')),
    ledger_transaction_id UUID REFERENCES ledger_transactions(id) ON DELETE RESTRICT,
    paid_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (partner_id, period_start, period_end)
);
