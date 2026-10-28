-- migrations/d1_13_partner_bank_accounts.sql
-- OLMOA Partner Logistics & Settlement Settings

ALTER TABLE partners ADD COLUMN settlement_cycle TEXT DEFAULT 'WEEKLY';
ALTER TABLE partners ADD COLUMN return_shipping_address TEXT DEFAULT '인천광역시 중구 공항동 물류센터 B동 301호';
ALTER TABLE partners ADD COLUMN customer_service_phone TEXT DEFAULT '1588-0000';

-- Update initial demo partners with realistic settlement account & logistics data
UPDATE partners
SET bank_code = '004',
    bank_account_number = '941602-00-184920',
    bank_account_holder = '(주)글로벌다이렉트로지스틱스',
    settlement_cycle = 'WEEKLY',
    return_shipping_address = '인천광역시 중구 자유무역로 123 올모아 글로벌 풀필먼트 2층',
    customer_service_phone = '02-1588-9999'
WHERE id = 'pt_001';

UPDATE partners
SET bank_code = '088',
    bank_account_number = '110-384-920194',
    bank_account_holder = '테크노바인터내셔널',
    settlement_cycle = 'BI_WEEKLY',
    return_shipping_address = '경기도 고양시 일산동구 백마로 195 테크노밸리 물류센터 104호',
    customer_service_phone = '031-900-1234'
WHERE id = 'pt_002';

