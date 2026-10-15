-- D1 Migration 01: Core Entities
CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    full_name TEXT NOT NULL,
    phone TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('ROLE_CUSTOMER', 'ROLE_PARTNER', 'ROLE_ADMIN')),
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS partners (
    id TEXT PRIMARY KEY,
    owner_user_id TEXT NOT NULL UNIQUE REFERENCES users(id),
    business_name TEXT NOT NULL,
    business_reg_number TEXT NOT NULL UNIQUE,
    commission_rate REAL NOT NULL DEFAULT 10.00,
    bank_code TEXT NOT NULL,
    bank_account_number TEXT NOT NULL,
    bank_account_holder TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'APPROVED' CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED', 'SUSPENDED')),
    base_shipping_fee INTEGER NOT NULL DEFAULT 3000,
    free_shipping_threshold INTEGER NOT NULL DEFAULT 30000,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS categories (
    id TEXT PRIMARY KEY,
    parent_id TEXT REFERENCES categories(id),
    name TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    depth INTEGER NOT NULL DEFAULT 0,
    sort_order INTEGER NOT NULL DEFAULT 0,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS products (
    id TEXT PRIMARY KEY,
    partner_id TEXT NOT NULL REFERENCES partners(id),
    category_id TEXT NOT NULL REFERENCES categories(id),
    title TEXT NOT NULL,
    thumbnail_url TEXT NOT NULL,
    description_html TEXT NOT NULL,
    lowest_original_price INTEGER NOT NULL,
    lowest_sale_price INTEGER NOT NULL,
    total_sold_count INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('DRAFT', 'ACTIVE', 'HIDDEN', 'DELETED')),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS product_skus (
    id TEXT PRIMARY KEY,
    product_id TEXT NOT NULL REFERENCES products(id),
    sku_code TEXT NOT NULL UNIQUE,
    option_combination_json TEXT NOT NULL,
    original_price INTEGER NOT NULL,
    sale_price INTEGER NOT NULL,
    stock_quantity INTEGER NOT NULL DEFAULT 0,
    safety_stock INTEGER NOT NULL DEFAULT 5,
    status TEXT NOT NULL DEFAULT 'IN_STOCK' CHECK (status IN ('IN_STOCK', 'LOW_STOCK', 'OUT_OF_STOCK')),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS inventory_ledger (
    id TEXT PRIMARY KEY,
    sku_id TEXT NOT NULL REFERENCES product_skus(id),
    change_type TEXT NOT NULL CHECK (change_type IN ('PURCHASE_DEDUCT', 'RESTOCK', 'RETURN_RESTOCK', 'MANUAL_ADJUST', 'ORDER_CANCEL')),
    quantity_delta INTEGER NOT NULL,
    balance_after INTEGER NOT NULL,
    reference_id TEXT NOT NULL,
    idempotency_key TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS orders (
    id TEXT PRIMARY KEY,
    order_no TEXT NOT NULL UNIQUE,
    customer_id TEXT NOT NULL REFERENCES users(id),
    total_goods_amount INTEGER NOT NULL,
    total_shipping_amount INTEGER NOT NULL,
    total_discount_amount INTEGER NOT NULL DEFAULT 0,
    total_pay_amount INTEGER NOT NULL,
    currency TEXT NOT NULL DEFAULT 'KRW',
    payment_status TEXT NOT NULL DEFAULT 'PAID' CHECK (payment_status IN ('READY', 'PAID', 'FAILED', 'CANCELLED', 'PARTIAL_REFUNDED')),
    recipient_name TEXT NOT NULL,
    recipient_phone TEXT NOT NULL,
    shipping_address_line1 TEXT NOT NULL,
    shipping_address_line2 TEXT NOT NULL,
    shipping_postal_code TEXT NOT NULL,
    shipping_memo TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS sub_orders (
    id TEXT PRIMARY KEY,
    parent_order_id TEXT NOT NULL REFERENCES orders(id),
    sub_order_no TEXT NOT NULL UNIQUE,
    partner_id TEXT NOT NULL REFERENCES partners(id),
    shipping_fee INTEGER NOT NULL,
    goods_amount INTEGER NOT NULL,
    discount_amount INTEGER NOT NULL DEFAULT 0,
    total_amount INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'PAYMENT_CONFIRMED' CHECK (status IN ('PAYMENT_CONFIRMED', 'PREPARING', 'SHIPPED', 'DELIVERED', 'COMPLETED', 'CANCEL_REQUESTED', 'CANCELLED', 'RETURN_REQUESTED', 'RETURNED')),
    carrier_code TEXT,
    tracking_number TEXT,
    shipped_at TEXT,
    delivered_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS order_items (
    id TEXT PRIMARY KEY,
    sub_order_id TEXT NOT NULL REFERENCES sub_orders(id),
    sku_id TEXT NOT NULL REFERENCES product_skus(id),
    product_title TEXT NOT NULL,
    option_summary TEXT NOT NULL,
    unit_price INTEGER NOT NULL,
    quantity INTEGER NOT NULL,
    total_price INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS settlements (
    id TEXT PRIMARY KEY,
    sub_order_id TEXT NOT NULL UNIQUE REFERENCES sub_orders(id),
    partner_id TEXT NOT NULL REFERENCES partners(id),
    gross_amount INTEGER NOT NULL,
    shipping_fee INTEGER NOT NULL,
    commission_rate REAL NOT NULL,
    commission_amount INTEGER NOT NULL,
    net_payout_amount INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('HOLD', 'PENDING', 'SETTLED', 'CANCELLED')),
    settled_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

