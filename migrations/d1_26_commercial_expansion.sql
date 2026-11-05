-- migrations/d1_26_commercial_expansion.sql
-- Commercial Expansion Phase 1 ~ 3:
-- 1. Cash Receipts & Electronic Tax Invoices (세금계산서·현금영수증)
-- 2. Fully-Managed (전탁) & Semi-Managed Supply Model Columns
-- 3. Reverse Bidding Engine (공급자 역경매 비딩)
-- 4. MD Price Counter-Offer Negotiations (공급가 협상 워크벤치)
-- 5. Package Consolidation Logistics (합배송 허브 라우팅)

PRAGMA defer_foreign_keys = ON;

-- 1. Tax Invoices & Cash Receipts
CREATE TABLE IF NOT EXISTS tax_invoices (
    id TEXT PRIMARY KEY,
    invoice_type TEXT NOT NULL CHECK (invoice_type IN ('CASH_RECEIPT', 'TAX_INVOICE_PURCHASE', 'TAX_INVOICE_SALES')),
    order_id TEXT REFERENCES orders(id),
    partner_id TEXT REFERENCES partners(id),
    buyer_identifier TEXT NOT NULL,         -- 전화번호 / 사업자등록번호 / 현금영수증 카드번호
    identifier_type TEXT NOT NULL CHECK (identifier_type IN ('PHONE', 'BUSINESS_REG_NO', 'PERSONAL_ID')),
    supply_amount INTEGER NOT NULL CHECK (supply_amount >= 0),
    vat_amount INTEGER NOT NULL CHECK (vat_amount >= 0),
    total_amount INTEGER NOT NULL CHECK (total_amount >= 0),
    issue_status TEXT NOT NULL DEFAULT 'REQUESTED' CHECK (issue_status IN ('REQUESTED', 'ISSUED', 'CANCELLED', 'FAILED')),
    hometax_approval_no TEXT,               -- 국세청 승인번호 (18~24자리)
    item_title TEXT NOT NULL,
    issuer_entity_id TEXT,
    memo TEXT,
    issued_at TEXT,
    cancelled_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_tax_invoices_order ON tax_invoices(order_id);
CREATE INDEX IF NOT EXISTS idx_tax_invoices_partner ON tax_invoices(partner_id, issue_status);
CREATE INDEX IF NOT EXISTS idx_tax_invoices_created ON tax_invoices(created_at);

-- 2. Products / SKUs Supply Model & Wholesale Pricing
ALTER TABLE products ADD COLUMN supply_model TEXT NOT NULL DEFAULT 'MARKETPLACE' CHECK (supply_model IN ('MARKETPLACE', 'FULLY_MANAGED', 'SEMI_MANAGED'));
ALTER TABLE products ADD COLUMN target_margin_bps INTEGER NOT NULL DEFAULT 1500 CHECK (target_margin_bps >= 0 AND target_margin_bps <= 9000);
ALTER TABLE product_skus ADD COLUMN wholesale_supply_price INTEGER NOT NULL DEFAULT 0 CHECK (wholesale_supply_price >= 0);

-- 3. Dynamic Reverse Bidding Engine
CREATE TABLE IF NOT EXISTS bidding_campaigns (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    category_id TEXT NOT NULL REFERENCES categories(id),
    reference_product_id TEXT REFERENCES products(id),
    target_spec_json TEXT NOT NULL DEFAULT '{}',
    ceiling_supply_price INTEGER NOT NULL CHECK (ceiling_supply_price > 0),
    min_moq INTEGER NOT NULL DEFAULT 100,
    status TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'EVALUATING', 'AWARDED', 'CANCELLED', 'CLOSED')),
    winning_bid_id TEXT,
    starts_at TEXT NOT NULL,
    ends_at TEXT NOT NULL,
    created_by TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_bidding_campaigns_status ON bidding_campaigns(status, ends_at);

CREATE TABLE IF NOT EXISTS supplier_bids (
    id TEXT PRIMARY KEY,
    campaign_id TEXT NOT NULL REFERENCES bidding_campaigns(id),
    partner_id TEXT NOT NULL REFERENCES partners(id),
    bid_supply_price INTEGER NOT NULL CHECK (bid_supply_price > 0),
    moq INTEGER NOT NULL DEFAULT 100,
    production_lead_days INTEGER NOT NULL DEFAULT 7,
    sample_offered INTEGER NOT NULL DEFAULT 1 CHECK (sample_offered IN (0, 1)),
    bid_notes TEXT,
    status TEXT NOT NULL DEFAULT 'SUBMITTED' CHECK (status IN ('SUBMITTED', 'SHORTLISTED', 'WON', 'LOST', 'RETRACTED')),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_supplier_bids_campaign ON supplier_bids(campaign_id, bid_supply_price);
CREATE INDEX IF NOT EXISTS idx_supplier_bids_partner ON supplier_bids(partner_id, status);

-- 4. MD Price Counter-Offer Negotiations
CREATE TABLE IF NOT EXISTS price_negotiations (
    id TEXT PRIMARY KEY,
    product_id TEXT NOT NULL REFERENCES products(id),
    partner_id TEXT NOT NULL REFERENCES partners(id),
    sku_id TEXT REFERENCES product_skus(id),
    current_sale_price INTEGER NOT NULL,
    suggested_target_price INTEGER NOT NULL CHECK (suggested_target_price > 0),
    external_market_benchmark TEXT,          -- e.g. "1688 평균 3,800원 / 알리익스프레스 4,200원"
    discount_rate_suggested REAL,
    md_proposal_notes TEXT NOT NULL,
    partner_response_notes TEXT,
    status TEXT NOT NULL DEFAULT 'PROPOSED' CHECK (status IN ('PROPOSED', 'ACCEPTED', 'REJECTED', 'SUPERSEDED')),
    proposed_by TEXT NOT NULL,
    responded_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_price_nego_product ON price_negotiations(product_id);
CREATE INDEX IF NOT EXISTS idx_price_nego_partner ON price_negotiations(partner_id, status);

-- 5. Package Consolidation Logistics (합배송 허브 라우팅)
ALTER TABLE sub_orders ADD COLUMN consolidation_hub_id TEXT;
ALTER TABLE sub_orders ADD COLUMN consolidated_tracking_number TEXT;
ALTER TABLE sub_orders ADD COLUMN is_consolidated INTEGER NOT NULL DEFAULT 0 CHECK (is_consolidated IN (0, 1));
ALTER TABLE sub_orders ADD COLUMN consolidation_status TEXT CHECK (consolidation_status IS NULL OR consolidation_status IN ('COLLECTING_AT_HUB', 'CONSOLIDATED', 'DISPATCHED_SINGLE_BOX'));
