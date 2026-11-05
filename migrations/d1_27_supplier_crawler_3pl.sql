-- migrations/d1_27_supplier_crawler_3pl.sql
-- Global URL Product Crawler, Supplier PO Integration, 3PL Fulfillment and Inventory Sync Engine.
-- Extends OLMOA with Dropshipping, Multi-adapter parsing, Price/Stock sync and Supplier Settlement ledger.

CREATE TABLE IF NOT EXISTS source_products (
    id TEXT PRIMARY KEY,
    original_url TEXT NOT NULL UNIQUE,
    domain TEXT NOT NULL,
    supplier_id TEXT REFERENCES suppliers(id),
    title TEXT NOT NULL,
    brand TEXT,
    model_name TEXT,
    manufacturer TEXT,
    origin_language TEXT NOT NULL DEFAULT 'ko',
    category_hint TEXT,
    raw_data_json TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_source_products_domain ON source_products(domain);

CREATE TABLE IF NOT EXISTS source_product_snapshots (
    id TEXT PRIMARY KEY,
    source_product_id TEXT NOT NULL REFERENCES source_products(id),
    snapshot_data_json TEXT NOT NULL,
    collected_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    change_summary TEXT
);
CREATE INDEX IF NOT EXISTS idx_snapshots_source_prod ON source_product_snapshots(source_product_id);

CREATE TABLE IF NOT EXISTS product_import_jobs (
    id TEXT PRIMARY KEY,
    partner_id TEXT NOT NULL REFERENCES partners(id),
    supplier_id TEXT REFERENCES suppliers(id),
    source_url TEXT NOT NULL,
    domain TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'FETCHING', 'ANALYZED', 'PUBLISHED', 'FAILED', 'CANCELLED')),
    quality_score INTEGER NOT NULL DEFAULT 0 CHECK (quality_score BETWEEN 0 AND 100),
    extracted_data_json TEXT,
    preview_data_json TEXT,
    published_product_id TEXT REFERENCES products(id),
    error_code TEXT,
    error_message TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_import_jobs_partner ON product_import_jobs(partner_id, status);
CREATE INDEX IF NOT EXISTS idx_import_jobs_status ON product_import_jobs(status);

CREATE TABLE IF NOT EXISTS product_import_errors (
    id TEXT PRIMARY KEY,
    job_id TEXT NOT NULL REFERENCES product_import_jobs(id),
    step TEXT NOT NULL,
    error_code TEXT NOT NULL,
    error_detail TEXT,
    occurred_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_import_errors_job ON product_import_errors(job_id);

CREATE TABLE IF NOT EXISTS pricing_rules (
    id TEXT PRIMARY KEY,
    partner_id TEXT REFERENCES partners(id),
    supplier_id TEXT REFERENCES suppliers(id),
    name TEXT NOT NULL,
    rule_type TEXT NOT NULL DEFAULT 'PERCENTAGE_ADD' CHECK (rule_type IN ('PERCENTAGE_ADD', 'FIXED_ADD', 'CATEGORY_BASED', 'TIERED')),
    margin_bps INTEGER NOT NULL DEFAULT 2000 CHECK (margin_bps >= 0),
    fixed_add_amount INTEGER NOT NULL DEFAULT 0 CHECK (fixed_add_amount >= 0),
    minimum_margin_amount INTEGER NOT NULL DEFAULT 0 CHECK (minimum_margin_amount >= 0),
    rounding_unit INTEGER NOT NULL DEFAULT 100 CHECK (rounding_unit IN (1, 10, 100, 1000)),
    is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS supplier_integrations (
    id TEXT PRIMARY KEY,
    supplier_id TEXT NOT NULL REFERENCES suppliers(id),
    integration_type TEXT NOT NULL DEFAULT 'PORTAL' CHECK (integration_type IN ('API', 'PORTAL', 'CSV_FEED', 'SFTP', 'EMAIL')),
    endpoint_url TEXT,
    auth_config_json TEXT,
    sync_interval_hours INTEGER NOT NULL DEFAULT 6 CHECK (sync_interval_hours >= 1),
    last_synced_at TEXT,
    status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE', 'ERROR')),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_supplier_integrations_supplier ON supplier_integrations(supplier_id);

CREATE TABLE IF NOT EXISTS supplier_orders (
    id TEXT PRIMARY KEY,
    po_no TEXT NOT NULL UNIQUE,
    supplier_id TEXT NOT NULL REFERENCES suppliers(id),
    sub_order_id TEXT NOT NULL REFERENCES sub_orders(id),
    idempotency_key TEXT NOT NULL UNIQUE,
    fulfillment_mode TEXT NOT NULL DEFAULT 'DROPSHIP' CHECK (fulfillment_mode IN ('DROPSHIP', '3PL_WAREHOUSE')),
    status TEXT NOT NULL DEFAULT 'REQUESTED' CHECK (status IN ('REQUESTED', 'ACCEPTED', 'REJECTED', 'PICKING', 'IN_TRANSIT', 'DELIVERED', 'CANCELLED')),
    total_supply_cost INTEGER NOT NULL CHECK (total_supply_cost >= 0),
    currency TEXT NOT NULL DEFAULT 'KRW',
    carrier_code TEXT,
    tracking_number TEXT,
    supplier_order_ref TEXT,
    rejection_reason TEXT,
    retry_count INTEGER NOT NULL DEFAULT 0 CHECK (retry_count >= 0),
    dispatched_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_supplier_orders_supplier ON supplier_orders(supplier_id, status);
CREATE INDEX IF NOT EXISTS idx_supplier_orders_sub_order ON supplier_orders(sub_order_id);

CREATE TABLE IF NOT EXISTS supplier_order_items (
    id TEXT PRIMARY KEY,
    supplier_order_id TEXT NOT NULL REFERENCES supplier_orders(id),
    order_item_id TEXT REFERENCES order_items(id),
    sku_id TEXT NOT NULL REFERENCES product_skus(id),
    supplier_sku_code TEXT NOT NULL,
    product_title TEXT NOT NULL,
    option_summary TEXT,
    quantity INTEGER NOT NULL CHECK (quantity > 0),
    unit_supply_price INTEGER NOT NULL CHECK (unit_supply_price >= 0),
    total_price INTEGER NOT NULL CHECK (total_price >= 0),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_soi_supplier_order ON supplier_order_items(supplier_order_id);

CREATE TABLE IF NOT EXISTS fulfillment_orders (
    id TEXT PRIMARY KEY,
    supplier_order_id TEXT NOT NULL REFERENCES supplier_orders(id),
    warehouse_id TEXT,
    carrier_code TEXT NOT NULL DEFAULT 'CJ대한통운',
    tracking_number TEXT,
    status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'PICKING', 'PACKED', 'SHIPPED', 'DELIVERED', 'RETURNED')),
    shipped_at TEXT,
    delivered_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_fulfillment_orders_supplier_order ON fulfillment_orders(supplier_order_id);

CREATE TABLE IF NOT EXISTS supplier_inventory_sync_logs (
    id TEXT PRIMARY KEY,
    supplier_id TEXT NOT NULL REFERENCES suppliers(id),
    sku_id TEXT NOT NULL REFERENCES product_skus(id),
    old_stock INTEGER,
    new_stock INTEGER,
    old_price INTEGER,
    new_price INTEGER,
    sync_type TEXT NOT NULL DEFAULT 'API_PULL' CHECK (sync_type IN ('API_PULL', 'WEBHOOK', 'PAGE_RECHECK', 'MANUAL')),
    sync_status TEXT NOT NULL DEFAULT 'SUCCESS' CHECK (sync_status IN ('SUCCESS', 'PRICE_JUMP_ALERT', 'OUT_OF_STOCK', 'FAILED')),
    alert_message TEXT,
    synced_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_sync_logs_supplier_sku ON supplier_inventory_sync_logs(supplier_id, sku_id);

CREATE TABLE IF NOT EXISTS supplier_settlements (
    id TEXT PRIMARY KEY,
    supplier_id TEXT NOT NULL REFERENCES suppliers(id),
    supplier_order_id TEXT NOT NULL REFERENCES supplier_orders(id),
    period_month TEXT NOT NULL,
    gross_supply_amount INTEGER NOT NULL CHECK (gross_supply_amount >= 0),
    shipping_fee_amount INTEGER NOT NULL DEFAULT 0 CHECK (shipping_fee_amount >= 0),
    deduction_amount INTEGER NOT NULL DEFAULT 0 CHECK (deduction_amount >= 0),
    net_payable_amount INTEGER NOT NULL CHECK (net_payable_amount >= 0),
    status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'SETTLED', 'PAID_OUT')),
    settled_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_supplier_settlements_supplier ON supplier_settlements(supplier_id, period_month);
