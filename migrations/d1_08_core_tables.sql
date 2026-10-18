-- migrations/d1_08_core_tables.sql
-- OLMOA Core Extension Tables: Search Autocomplete, Flash Sales, Reviews, Coupons & Claims

CREATE TABLE IF NOT EXISTS search_keywords (
    id TEXT PRIMARY KEY,
    keyword TEXT NOT NULL UNIQUE,
    normalized_keyword TEXT NOT NULL,
    chosung TEXT,
    category_id TEXT REFERENCES categories(id),
    category_name TEXT,
    category_slug TEXT,
    search_count INTEGER NOT NULL DEFAULT 1,
    product_hit_count INTEGER NOT NULL DEFAULT 0,
    is_promoted INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS search_synonyms (
    id TEXT PRIMARY KEY,
    term TEXT NOT NULL,
    canonical_keyword TEXT NOT NULL,
    UNIQUE(term, canonical_keyword)
);

CREATE INDEX IF NOT EXISTS idx_search_kw_norm ON search_keywords(normalized_keyword);
CREATE INDEX IF NOT EXISTS idx_search_kw_chosung ON search_keywords(chosung);
CREATE INDEX IF NOT EXISTS idx_search_kw_count ON search_keywords(search_count DESC);

CREATE TABLE IF NOT EXISTS flash_sale_campaigns (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    banner_url TEXT,
    starts_at TEXT NOT NULL,
    ends_at TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('UPCOMING', 'ACTIVE', 'ENDED')),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS flash_sale_items (
    id TEXT PRIMARY KEY,
    campaign_id TEXT NOT NULL REFERENCES flash_sale_campaigns(id),
    product_id TEXT NOT NULL REFERENCES products(id),
    sku_id TEXT REFERENCES product_skus(id),
    deal_price INTEGER NOT NULL,
    discount_rate INTEGER NOT NULL,
    allocated_stock INTEGER NOT NULL,
    sold_stock INTEGER NOT NULL DEFAULT 0,
    sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS product_reviews (
    id TEXT PRIMARY KEY,
    product_id TEXT NOT NULL REFERENCES products(id),
    user_id TEXT NOT NULL REFERENCES users(id),
    reviewer_name TEXT NOT NULL,
    sku_option_summary TEXT,
    rating REAL NOT NULL CHECK(rating >= 1 AND rating <= 5),
    content TEXT NOT NULL,
    images_json TEXT DEFAULT '[]',
    helpful_count INTEGER NOT NULL DEFAULT 0,
    is_verified_purchase INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_prod_reviews_pid ON product_reviews(product_id);

CREATE TABLE IF NOT EXISTS coupons (
    id TEXT PRIMARY KEY,
    code TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL,
    discount_type TEXT NOT NULL CHECK(discount_type IN ('PERCENT', 'FIXED_AMOUNT')),
    discount_value INTEGER NOT NULL,
    min_order_amount INTEGER NOT NULL DEFAULT 0,
    max_discount_amount INTEGER,
    expires_at TEXT NOT NULL,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS user_coupons (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    coupon_id TEXT NOT NULL REFERENCES coupons(id),
    is_used INTEGER NOT NULL DEFAULT 0,
    used_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS user_credits (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    amount_delta INTEGER NOT NULL,
    balance_after INTEGER NOT NULL,
    reason TEXT NOT NULL,
    reference_id TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS wishlists (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    product_id TEXT NOT NULL REFERENCES products(id),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, product_id)
);

CREATE TABLE IF NOT EXISTS returns (
    id TEXT PRIMARY KEY,
    order_id TEXT NOT NULL REFERENCES orders(id),
    user_id TEXT NOT NULL REFERENCES users(id),
    claim_type TEXT NOT NULL CHECK(claim_type IN ('RETURN', 'EXCHANGE', 'PRICE_ADJUSTMENT')),
    reason TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'REQUESTED' CHECK(status IN ('REQUESTED', 'APPROVED', 'REJECTED', 'REFUNDED')),
    refund_amount INTEGER NOT NULL DEFAULT 0,
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

