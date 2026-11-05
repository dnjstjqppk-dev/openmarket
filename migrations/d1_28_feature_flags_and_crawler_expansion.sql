-- migrations/d1_28_feature_flags_and_crawler_expansion.sql
-- Comprehensive Feature Flags Engine, Bulk Crawl Batches, Asset Management, and AI Processing Schemas.

-- 1. Feature Flags Table
CREATE TABLE IF NOT EXISTS feature_flags (
    key TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT 'CRAWLER_3PL',
    description TEXT NOT NULL,
    is_enabled INTEGER NOT NULL DEFAULT 0 CHECK (is_enabled IN (0, 1)),
    requires_credential INTEGER NOT NULL DEFAULT 0 CHECK (requires_credential IN (0, 1)),
    credential_configured INTEGER NOT NULL DEFAULT 0 CHECK (credential_configured IN (0, 1)),
    risk_level TEXT NOT NULL DEFAULT 'LOW' CHECK (risk_level IN ('LOW', 'MEDIUM', 'HIGH')),
    updated_by TEXT,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Initial 9 Core Feature Flags requested by PO
INSERT OR IGNORE INTO feature_flags (key, name, category, description, is_enabled, requires_credential, credential_configured, risk_level) VALUES
    ('url_crawler', 'URL 상품 수집', 'CRAWLER', '단일 URL 입력 기반 상품 정보 자동 수집 및 메타데이터 파싱', 1, 0, 1, 'LOW'),
    ('bulk_crawler', '대량 상품 수집', 'CRAWLER', '최대 50개 URL 일괄 수집 및 배치 큐 처리', 0, 0, 1, 'MEDIUM'),
    ('ai_translation', 'AI 자동 번역 및 가공', 'AI_ENGINE', '다국어 상품명 번역 및 AI 상세 설명 요약 가공 (API 키 미설정 시 로컬 사전식 가공 모드 동작)', 0, 1, 0, 'LOW'),
    ('auto_publish', '상품 자동 등록', 'CATALOG', '수집 즉시 별도 검토 승인 없이 정식 판매 카탈로그 자동 등록', 0, 0, 1, 'HIGH'),
    ('auto_pricing', '자동 가격 조정', 'PRICING', '공급원가 및 환율 변동 시 목표 마진율 기준 판매가 자동 재산출', 0, 0, 1, 'MEDIUM'),
    ('stock_sync', '재고 자동 동기화', 'INVENTORY', '외부 공급업체 웹훅 및 주기적 크롤링 기반 재고 수량 자동 갱신', 0, 0, 1, 'MEDIUM'),
    ('auto_supplier_po', '공급업체 자동 발주', 'FULFILLMENT', '소비자 주문 결제 확인 시 외부 공급업체 발주서(PO) 자동 디스패치', 0, 0, 1, 'HIGH'),
    ('fulfillment_3pl', '3PL 배송 연동', 'FULFILLMENT', '3PL 물류센터 연동 및 실시간 운송장 번호 자동 채번·출고', 0, 1, 0, 'HIGH'),
    ('auto_settlement', '반품·정산 자동화', 'FINANCE', '위탁배송 구매확정 및 반품 시 공급사·판매자 정산 대금 자동 확정', 0, 0, 1, 'HIGH');

-- 2. Feature Flags Audit Log Table
CREATE TABLE IF NOT EXISTS feature_flag_audit_logs (
    id TEXT PRIMARY KEY,
    flag_key TEXT NOT NULL REFERENCES feature_flags(key),
    old_value INTEGER NOT NULL,
    new_value INTEGER NOT NULL,
    actor_user_id TEXT,
    reason TEXT,
    ip_address TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 3. Product Media & Imported Asset Tracking Table
CREATE TABLE IF NOT EXISTS product_import_assets (
    id TEXT PRIMARY KEY,
    import_job_id TEXT REFERENCES product_import_jobs(id),
    product_id TEXT REFERENCES products(id),
    original_url TEXT NOT NULL,
    stored_path TEXT,
    media_type TEXT NOT NULL DEFAULT 'IMAGE' CHECK (media_type IN ('IMAGE', 'VIDEO', 'DOCUMENT')),
    byte_size INTEGER DEFAULT 0,
    width INTEGER,
    height INTEGER,
    status TEXT NOT NULL DEFAULT 'DISCOVERED' CHECK (status IN ('DISCOVERED', 'DOWNLOADED', 'FAILED')),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 4. AI Multi-language Enhancement Log Table
CREATE TABLE IF NOT EXISTS ai_product_enhancements (
    id TEXT PRIMARY KEY,
    import_job_id TEXT REFERENCES product_import_jobs(id),
    product_id TEXT REFERENCES products(id),
    source_language TEXT NOT NULL DEFAULT 'EN',
    target_language TEXT NOT NULL DEFAULT 'KO',
    original_title TEXT NOT NULL,
    translated_title TEXT,
    enhanced_summary TEXT,
    bullets_json TEXT,
    provider TEXT NOT NULL DEFAULT 'RULE_BASED_LOCALIZER' CHECK (provider IN ('RULE_BASED_LOCALIZER', 'VERTEX_AI', 'OPENAI', 'CLOUDFLARE_AI')),
    status TEXT NOT NULL DEFAULT 'COMPLETED' CHECK (status IN ('COMPLETED', 'BLOCKED_NO_CREDENTIAL', 'FAILED')),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
