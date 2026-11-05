-- migrations/d1_29_global_multichannel_and_supply_chain.sql
-- OLMOA Global Multi-Channel OpenMarket, B2B Supply Chain & 3PL Integration Schema

-- 1. Commerce Platforms Master
CREATE TABLE IF NOT EXISTS commerce_platforms (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    country_code TEXT NOT NULL, -- KR, US, CN, SG, etc.
    platform_type TEXT NOT NULL CHECK (platform_type IN ('DOMESTIC_OPENMARKET', 'GLOBAL_OPENMARKET', 'B2B_SUPPLIER', '3PL_LOGISTICS')),
    auth_type TEXT NOT NULL CHECK (auth_type IN ('OAUTH2', 'API_KEY_SECRET', 'HMAC_SHA256', 'TOKEN_HEADER', 'MANUAL_EDI')),
    api_docs_url TEXT NOT NULL,
    supported_models TEXT NOT NULL DEFAULT 'MODEL_A,MODEL_B', -- Comma-separated: MODEL_A, MODEL_B, MODEL_C
    status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'BETA', 'DEPRECATED', 'BLOCKED_NO_CREDENTIAL')),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 2. Platform API Capabilities Matrix
CREATE TABLE IF NOT EXISTS platform_api_capabilities (
    id TEXT PRIMARY KEY,
    platform_id TEXT NOT NULL REFERENCES commerce_platforms(id) ON DELETE CASCADE,
    capability_type TEXT NOT NULL CHECK (capability_type IN (
        'SELLER_MANAGEMENT', 'PUBLIC_CATALOG', 'SUPPLIER_CATALOG',
        'SUPPLIER_ORDER', 'AFFILIATE', 'ORDER_SYNC', 'TRACKING_SYNC', 'SETTLEMENT_SYNC'
    )),
    is_supported INTEGER NOT NULL DEFAULT 1 CHECK (is_supported IN (0, 1)),
    verification_status TEXT NOT NULL DEFAULT 'VERIFIED_AVAILABLE' CHECK (verification_status IN (
        'VERIFIED_AVAILABLE', 'IMPLEMENTED', 'TESTED_SANDBOX', 'TESTED_LIVE',
        'REQUIRES_CREDENTIAL', 'REQUIRES_PARTNER_APPROVAL', 'REQUIRES_CONTRACT', 'NOT_SUPPORTED', 'UNVERIFIED'
    )),
    rate_limit_per_min INTEGER DEFAULT 60,
    sandbox_supported INTEGER NOT NULL DEFAULT 0 CHECK (sandbox_supported IN (0, 1)),
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 3. Platform Credentials (Encrypted/Masked per Partner/Tenant)
CREATE TABLE IF NOT EXISTS platform_credentials (
    id TEXT PRIMARY KEY,
    partner_id TEXT NOT NULL REFERENCES partners(id) ON DELETE CASCADE,
    platform_id TEXT NOT NULL REFERENCES commerce_platforms(id) ON DELETE CASCADE,
    credential_name TEXT NOT NULL,
    api_key_masked TEXT,
    secret_key_enc TEXT, -- Encrypted/vaulted in production
    access_token_enc TEXT,
    refresh_token_enc TEXT,
    token_expires_at TEXT,
    webhook_secret_enc TEXT,
    seller_account_id TEXT,
    is_sandbox INTEGER NOT NULL DEFAULT 0 CHECK (is_sandbox IN (0, 1)),
    status TEXT NOT NULL DEFAULT 'CONFIGURED' CHECK (status IN ('CONFIGURED', 'VERIFIED', 'EXPIRED', 'BLOCKED_INVALID', 'DISABLED')),
    last_verified_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(partner_id, platform_id, is_sandbox)
);

-- 4. Sales Channels (External & Internal)
CREATE TABLE IF NOT EXISTS sales_channels (
    id TEXT PRIMARY KEY,
    platform_id TEXT NOT NULL REFERENCES commerce_platforms(id) ON DELETE CASCADE,
    channel_code TEXT NOT NULL UNIQUE,
    channel_name TEXT NOT NULL,
    currency TEXT NOT NULL DEFAULT 'KRW',
    commission_bps INTEGER NOT NULL DEFAULT 1000, -- e.g. 1000 = 10%
    is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
    auto_sync_orders INTEGER NOT NULL DEFAULT 0 CHECK (auto_sync_orders IN (0, 1)),
    auto_sync_inventory INTEGER NOT NULL DEFAULT 0 CHECK (auto_sync_inventory IN (0, 1)),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 5. External Channel Category Taxonomy Mapping
CREATE TABLE IF NOT EXISTS channel_categories (
    id TEXT PRIMARY KEY,
    sales_channel_id TEXT NOT NULL REFERENCES sales_channels(id) ON DELETE CASCADE,
    internal_category_id TEXT NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
    external_category_id TEXT NOT NULL,
    external_category_name TEXT NOT NULL,
    external_category_path TEXT,
    is_leaf INTEGER NOT NULL DEFAULT 1 CHECK (is_leaf IN (0, 1)),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(sales_channel_id, internal_category_id)
);

-- 6. Channel Listings (OLMOA Product -> External OpenMarket Listing)
CREATE TABLE IF NOT EXISTS channel_listings (
    id TEXT PRIMARY KEY,
    partner_id TEXT NOT NULL REFERENCES partners(id) ON DELETE CASCADE,
    sales_channel_id TEXT NOT NULL REFERENCES sales_channels(id) ON DELETE CASCADE,
    product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    external_product_id TEXT,
    external_url TEXT,
    listing_title TEXT NOT NULL,
    channel_sale_price INTEGER NOT NULL,
    channel_original_price INTEGER NOT NULL,
    currency TEXT NOT NULL DEFAULT 'KRW',
    stock_allocated INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'PENDING_REVIEW', 'ACTIVE', 'OUT_OF_STOCK', 'SUSPENDED', 'SYNC_FAILED', 'DELETED')),
    review_rejection_reason TEXT,
    last_synced_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(sales_channel_id, product_id)
);

-- 7. Channel Listing Errors
CREATE TABLE IF NOT EXISTS channel_listing_errors (
    id TEXT PRIMARY KEY,
    listing_id TEXT NOT NULL REFERENCES channel_listings(id) ON DELETE CASCADE,
    error_code TEXT NOT NULL,
    error_message TEXT NOT NULL,
    raw_payload_json TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 8. Channel Orders (Orders from External OpenMarkets)
CREATE TABLE IF NOT EXISTS channel_orders (
    id TEXT PRIMARY KEY,
    sales_channel_id TEXT NOT NULL REFERENCES sales_channels(id) ON DELETE CASCADE,
    partner_id TEXT NOT NULL REFERENCES partners(id) ON DELETE CASCADE,
    external_order_id TEXT NOT NULL,
    external_order_no TEXT NOT NULL,
    buyer_name TEXT NOT NULL,
    buyer_phone_masked TEXT,
    recipient_name TEXT NOT NULL,
    recipient_phone_masked TEXT,
    shipping_address TEXT NOT NULL,
    customs_id_pccc TEXT, -- Personal Customs Clearance Code
    total_order_amount INTEGER NOT NULL,
    channel_commission_amount INTEGER NOT NULL DEFAULT 0,
    settlement_expected_amount INTEGER NOT NULL DEFAULT 0,
    currency TEXT NOT NULL DEFAULT 'KRW',
    order_status TEXT NOT NULL DEFAULT 'COLLECTED' CHECK (order_status IN ('COLLECTED', 'CONFIRMED', 'PO_DISPATCHED', 'SHIPPED', 'DELIVERED', 'CANCELLED', 'RETURNED')),
    raw_payload_json TEXT,
    collected_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(sales_channel_id, external_order_id)
);

-- 9. Channel Order Items
CREATE TABLE IF NOT EXISTS channel_order_items (
    id TEXT PRIMARY KEY,
    channel_order_id TEXT NOT NULL REFERENCES channel_orders(id) ON DELETE CASCADE,
    internal_sku_id TEXT REFERENCES product_skus(id),
    external_sku_code TEXT,
    product_title TEXT NOT NULL,
    option_summary TEXT,
    quantity INTEGER NOT NULL CHECK (quantity > 0),
    unit_price INTEGER NOT NULL,
    total_price INTEGER NOT NULL,
    supplier_po_item_id TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 10. Multi-Channel Inventory Sources & Allocation
CREATE TABLE IF NOT EXISTS inventory_sources (
    id TEXT PRIMARY KEY,
    sku_id TEXT NOT NULL REFERENCES product_skus(id) ON DELETE CASCADE,
    source_type TEXT NOT NULL CHECK (source_type IN ('OLMOA_WAREHOUSE', 'SUPPLIER_DROPSHIP', 'PARTNER_DIRECT', '3PL_HUB')),
    supplier_id TEXT REFERENCES suppliers(id),
    physical_stock INTEGER NOT NULL DEFAULT 0 CHECK (physical_stock >= 0),
    reserved_stock INTEGER NOT NULL DEFAULT 0 CHECK (reserved_stock >= 0),
    available_stock INTEGER GENERATED ALWAYS AS (physical_stock - reserved_stock) VIRTUAL,
    safety_stock INTEGER NOT NULL DEFAULT 5,
    last_verified_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 11. Multi-Channel Inventory Reservations
CREATE TABLE IF NOT EXISTS inventory_reservations (
    id TEXT PRIMARY KEY,
    sku_id TEXT NOT NULL REFERENCES product_skus(id) ON DELETE CASCADE,
    channel_id TEXT NOT NULL REFERENCES sales_channels(id) ON DELETE CASCADE,
    order_reference_id TEXT NOT NULL,
    reserved_quantity INTEGER NOT NULL CHECK (reserved_quantity > 0),
    status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'COMMITTED', 'RELEASED', 'EXPIRED')),
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(channel_id, order_reference_id, sku_id)
);

-- 12. Multi-Channel Inventory Sync Jobs
CREATE TABLE IF NOT EXISTS inventory_sync_jobs (
    id TEXT PRIMARY KEY,
    sales_channel_id TEXT NOT NULL REFERENCES sales_channels(id) ON DELETE CASCADE,
    sku_id TEXT NOT NULL REFERENCES product_skus(id) ON DELETE CASCADE,
    previous_stock INTEGER NOT NULL,
    synced_stock INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'SUCCESS', 'FAILED', 'SKIPPED')),
    error_message TEXT,
    synced_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 13. Fulfillment Providers Master
CREATE TABLE IF NOT EXISTS fulfillment_providers (
    id TEXT PRIMARY KEY,
    code TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    country_code TEXT NOT NULL DEFAULT 'KR',
    service_type TEXT NOT NULL CHECK (service_type IN ('DOMESTIC_COURIER', 'GLOBAL_EXPRESS', 'FREIGHT_FORWARDER', 'POSTAL')),
    tracking_url_template TEXT NOT NULL,
    api_supported INTEGER NOT NULL DEFAULT 0 CHECK (api_supported IN (0, 1)),
    is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 14. Fulfillment Dispatch Orders
CREATE TABLE IF NOT EXISTS fulfillment_orders (
    id TEXT PRIMARY KEY,
    provider_id TEXT NOT NULL REFERENCES fulfillment_providers(id),
    sub_order_id TEXT REFERENCES sub_orders(id),
    channel_order_id TEXT REFERENCES channel_orders(id),
    supplier_order_id TEXT REFERENCES supplier_orders(id),
    warehouse_code TEXT NOT NULL DEFAULT 'DEFAULT_HUB',
    tracking_number TEXT,
    status TEXT NOT NULL DEFAULT 'REQUESTED' CHECK (status IN ('REQUESTED', 'PICKING', 'PACKED', 'DISPATCHED', 'IN_TRANSIT', 'DELIVERED', 'FAILED')),
    label_pdf_url TEXT,
    shipping_cost_krw INTEGER NOT NULL DEFAULT 3000,
    dispatched_at TEXT,
    delivered_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 15. Shipment Tracking Timeline Events
CREATE TABLE IF NOT EXISTS shipment_tracking_events (
    id TEXT PRIMARY KEY,
    fulfillment_order_id TEXT NOT NULL REFERENCES fulfillment_orders(id) ON DELETE CASCADE,
    tracking_number TEXT NOT NULL,
    milestone TEXT NOT NULL CHECK (milestone IN ('PICKED_UP', 'DEPARTED_FACILITY', 'CUSTOMS_CLEARED', 'OUT_FOR_DELIVERY', 'DELIVERED', 'EXCEPTION')),
    location TEXT,
    detail_message TEXT NOT NULL,
    event_timestamp TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 16. Integration Webhook Events
CREATE TABLE IF NOT EXISTS integration_webhook_events (
    id TEXT PRIMARY KEY,
    platform_id TEXT NOT NULL REFERENCES commerce_platforms(id),
    event_type TEXT NOT NULL,
    signature_header TEXT,
    signature_valid INTEGER NOT NULL DEFAULT 1 CHECK (signature_valid IN (0, 1)),
    payload_json TEXT NOT NULL,
    processed_status TEXT NOT NULL DEFAULT 'RECEIVED' CHECK (processed_status IN ('RECEIVED', 'PROCESSED', 'FAILED', 'IGNORED_DUPLICATE')),
    error_message TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 17. Integration Audit Trail
CREATE TABLE IF NOT EXISTS integration_audit_logs (
    id TEXT PRIMARY KEY,
    platform_id TEXT NOT NULL REFERENCES commerce_platforms(id),
    action TEXT NOT NULL,
    actor_id TEXT,
    target_id TEXT,
    ip_address TEXT,
    details_json TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 18. Seed Commerce Platforms (Domestic, Global, B2B, 3PL)
INSERT OR IGNORE INTO commerce_platforms (id, name, country_code, platform_type, auth_type, api_docs_url, supported_models, status) VALUES
    ('naver_smartstore', '네이버 스마트스토어', 'KR', 'DOMESTIC_OPENMARKET', 'OAUTH2', 'https://api.commerce.naver.com/docs', 'MODEL_A,MODEL_B', 'ACTIVE'),
    ('coupang_wing', '쿠팡 윙 오픈API', 'KR', 'DOMESTIC_OPENMARKET', 'HMAC_SHA256', 'https://developers.coupang.com', 'MODEL_A,MODEL_B', 'ACTIVE'),
    ('eleven_street', '11번가 오픈API', 'KR', 'DOMESTIC_OPENMARKET', 'API_KEY_SECRET', 'https://openapi.11st.co.kr', 'MODEL_A,MODEL_B', 'ACTIVE'),
    ('gmarket_auction', 'G마켓/옥션 ESM 2.0', 'KR', 'DOMESTIC_OPENMARKET', 'TOKEN_HEADER', 'https://api.esmplus.com', 'MODEL_A,MODEL_B', 'ACTIVE'),
    ('lotte_on', '롯데온 오픈API', 'KR', 'DOMESTIC_OPENMARKET', 'API_KEY_SECRET', 'https://openapi.lotteon.com', 'MODEL_A,MODEL_B', 'ACTIVE'),
    ('ssg_com', 'SSG.COM 파트너API', 'KR', 'DOMESTIC_OPENMARKET', 'API_KEY_SECRET', 'https://po.ssgadm.com', 'MODEL_A,MODEL_B', 'ACTIVE'),
    ('amazon_sp_api', 'Amazon Selling Partner API (SP-API)', 'US', 'GLOBAL_OPENMARKET', 'OAUTH2', 'https://developer-docs.amazon.com/sp-api', 'MODEL_A,MODEL_B', 'ACTIVE'),
    ('ebay_rest', 'eBay REST APIs', 'US', 'GLOBAL_OPENMARKET', 'OAUTH2', 'https://developer.ebay.com/api-docs', 'MODEL_A,MODEL_B', 'ACTIVE'),
    ('aliexpress_open', 'AliExpress Open Platform', 'CN', 'GLOBAL_OPENMARKET', 'HMAC_SHA256', 'https://open.aliexpress.com', 'MODEL_A,MODEL_B', 'ACTIVE'),
    ('temu_partner', 'Temu Partner / Seller API', 'CN', 'GLOBAL_OPENMARKET', 'OAUTH2', 'https://partner.temu.com', 'MODEL_A,MODEL_B', 'ACTIVE'),
    ('shopee_v2', 'Shopee Open Platform API v2', 'SG', 'GLOBAL_OPENMARKET', 'HMAC_SHA256', 'https://open.shopee.com', 'MODEL_A,MODEL_B', 'ACTIVE'),
    ('lazada_open', 'Lazada Open Platform', 'SG', 'GLOBAL_OPENMARKET', 'HMAC_SHA256', 'https://open.lazada.com', 'MODEL_A,MODEL_B', 'ACTIVE'),
    ('walmart_marketplace', 'Walmart Marketplace API', 'US', 'GLOBAL_OPENMARKET', 'TOKEN_HEADER', 'https://developer.walmart.com', 'MODEL_A,MODEL_B', 'ACTIVE'),
    ('tiktok_shop', 'TikTok Shop Partner API', 'US', 'GLOBAL_OPENMARKET', 'HMAC_SHA256', 'https://partner.tiktokshop.com', 'MODEL_A,MODEL_B', 'ACTIVE'),
    ('domeggook_domeme', '도매꾹/도매매 B2B 공급망', 'KR', 'B2B_SUPPLIER', 'API_KEY_SECRET', 'https://domeggook.com/main/api', 'MODEL_A,MODEL_C', 'ACTIVE'),
    ('onchannel_b2b', '온채널 위탁배송 B2B', 'KR', 'B2B_SUPPLIER', 'API_KEY_SECRET', 'https://www.onchannel.co.kr/b2b', 'MODEL_A,MODEL_C', 'ACTIVE'),
    ('ownerclan_b2b', '오너클랜 B2B 공급망', 'KR', 'B2B_SUPPLIER', 'API_KEY_SECRET', 'https://ownerclan.com/v2/b2b_api', 'MODEL_A,MODEL_C', 'ACTIVE'),
    ('alibaba_1688', '1688 / Alibaba B2B Sourcing', 'CN', 'B2B_SUPPLIER', 'OAUTH2', 'https://open.1688.com', 'MODEL_A,MODEL_C', 'ACTIVE');

-- 19. Seed Fulfillment Providers
INSERT OR IGNORE INTO fulfillment_providers (id, code, name, country_code, service_type, tracking_url_template, api_supported, is_active) VALUES
    ('fp_cj_logistics', 'CJ_LOGISTICS', 'CJ대한통운', 'KR', 'DOMESTIC_COURIER', 'https://trace.cjlogistics.com/next/tracking.html?wblNo={tracking}', 1, 1),
    ('fp_hanjin', 'HANJIN', '한진택배', 'KR', 'DOMESTIC_COURIER', 'https://www.hanjin.com/kor/CMS/DeliveryMgr/WaybillResult.do?wblnum={tracking}', 1, 1),
    ('fp_lotte_global', 'LOTTE_GLOBAL', '롯데글로벌로지스', 'KR', 'DOMESTIC_COURIER', 'https://www.lotteglogis.com/home/reservation/tracking/linkView?InvNo={tracking}', 1, 1),
    ('fp_post_kr', 'POST_KR', '우체국택배', 'KR', 'POSTAL', 'https://service.epost.go.kr/trace.RetrieveDomRcvtraceList.comm?sid1={tracking}', 1, 1),
    ('fp_dhl', 'DHL_EXPRESS', 'DHL Express', 'US', 'GLOBAL_EXPRESS', 'https://www.dhl.com/en/express/tracking.html?AWB={tracking}', 1, 1),
    ('fp_fedex', 'FEDEX', 'FedEx Worldwide', 'US', 'GLOBAL_EXPRESS', 'https://www.fedex.com/fedextrack/?trknbr={tracking}', 1, 1),
    ('fp_ups', 'UPS', 'UPS Worldwide', 'US', 'GLOBAL_EXPRESS', 'https://www.ups.com/track?tracknum={tracking}', 1, 1),
    ('fp_sf_express', 'SF_EXPRESS', 'SF Express (순풍택배)', 'CN', 'GLOBAL_EXPRESS', 'https://www.sf-international.com/kr/ko/dynamic_function/waybill/?waybillNo={tracking}', 1, 1);

-- 20. Seed Sales Channels
INSERT OR IGNORE INTO sales_channels (id, platform_id, channel_code, channel_name, currency, commission_bps, is_active) VALUES
    ('sc_olmoa_direct', 'naver_smartstore', 'OLMOA_MAIN', 'OLMOA 글로벌 직영 스토어', 'KRW', 0, 1),
    ('sc_naver_smartstore', 'naver_smartstore', 'NAVER_SMARTSTORE', '네이버 스마트스토어 채널', 'KRW', 550, 1),
    ('sc_coupang_wing', 'coupang_wing', 'COUPANG_MARKETPLACE', '쿠팡 오픈마켓 윙 채널', 'KRW', 1080, 1),
    ('sc_eleven_street', 'eleven_street', 'ELEVEN_STREET_KR', '11번가 오픈마켓 채널', 'KRW', 1200, 1),
    ('sc_gmarket_auction', 'gmarket_auction', 'GMARKET_ESM', 'G마켓/옥션 ESM 채널', 'KRW', 1300, 1),
    ('sc_amazon_us', 'amazon_sp_api', 'AMAZON_US_FBA_MFN', 'Amazon US 마켓플레이스', 'USD', 1500, 1),
    ('sc_shopee_sg', 'shopee_v2', 'SHOPEE_SG_CROSSBORDER', 'Shopee 싱가포르 크로스보더', 'SGD', 800, 1);

-- 21. Seed Expanded 12 Global Multi-Channel Feature Flags (Default Safe States)
INSERT OR IGNORE INTO feature_flags (key, name, category, description, is_enabled, requires_credential, credential_configured, risk_level) VALUES
    ('marketplace_connectors', '글로벌 오픈마켓 커넥터 공통 엔진', 'CONNECTORS', '국내외 18개 오픈마켓/공급망 커넥터 인터페이스 및 상태 모니터링', 1, 0, 1, 'LOW'),
    ('marketplace_product_import', '외부 마켓 상품 정보 수집', 'CONNECTORS', '공식 API 권한 기반 외부 오픈마켓 상품 카탈로그 수집 허용', 0, 1, 0, 'MEDIUM'),
    ('marketplace_listing_publish', '외부 오픈마켓 상품 자동 등록/배포', 'LISTING', 'OLMOA 상품을 외부 판매채널(네이버/쿠팡/아마존 등)에 자동 등록 및 전송', 0, 1, 0, 'HIGH'),
    ('marketplace_order_sync', '외부 오픈마켓 주문 자동 수집', 'ORDERS', '외부 판매채널에서 발생한 주문을 OLMOA로 주기적 폴링 및 웹훅 수집', 0, 1, 0, 'MEDIUM'),
    ('supplier_catalog_sync', 'B2B 공급사 카탈로그 동기화', 'SUPPLY_CHAIN', '도매꾹/온채널/오너클랜/1688 등 B2B 공급사 상품 카탈로그 자동 갱신', 0, 1, 0, 'MEDIUM'),
    ('supplier_order_manual', '공급업체 수동 검토 발주', 'SUPPLY_CHAIN', '관리자/판매자가 발주서 및 공급원가를 검토한 후 승인 발주', 1, 0, 1, 'LOW'),
    ('supplier_order_auto', '공급업체 무인 자동 발주', 'SUPPLY_CHAIN', '소비자 결제 완료 즉시 외부 B2B 공급사에 전자 발주서 자동 전송 (무단 발주 방지 기본 OFF)', 0, 1, 0, 'HIGH'),
    ('global_inventory_sync', '멀티채널 통합 재고 자동 동기화', 'INVENTORY', 'OLMOA 및 외부 판매채널 간 품절 및 재고 차감 실시간 자동 동기화', 0, 1, 0, 'HIGH'),
    ('global_price_sync', '멀티채널 판매가격 자동 동기화', 'PRICING', '환율 및 공급가 변동에 따른 외부 채널별 판매가격 자동 갱신 (역마진 방지 기본 OFF)', 0, 1, 0, 'HIGH'),
    ('global_shipping_sync', '다중 물류사 배송 추적 자동 수집', 'LOGISTICS', '국내외 8개 택배사(CJ, 한진, 롯데, 우체국, DHL, FedEx 등) 배송 상태 실시간 추적', 0, 0, 1, 'LOW'),
    ('crossborder_fulfillment', '크로스보더 3PL 통관·배송 연동', 'LOGISTICS', '해외 직구/역직구 개인통관고유부호(PCCC) 검증 및 전자 상업송장 자동 발행', 0, 0, 1, 'MEDIUM'),
    ('global_settlement_sync', '외부 판매채널 정산 데이터 수집', 'FINANCE', '외부 오픈마켓 수수료 및 정산 확정 데이터 자동 수집 및 장부 대조', 0, 1, 0, 'HIGH');
