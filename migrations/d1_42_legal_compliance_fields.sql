-- d1_42_legal_compliance_fields.sql
-- NEW-10/11/12: electronic-commerce legal display fields + Phase-1 policy alignment.
-- Additive only (new nullable columns + data hygiene UPDATEs).

-- NEW-10: seller identity for the public store (representative + mail-order
-- number already exist from d1_23; address + CS email are new).
ALTER TABLE partners ADD COLUMN business_address TEXT;
ALTER TABLE partners ADD COLUMN cs_email TEXT;

-- NEW-11: product notice (상품정보제공고시) key-value JSON, e.g.
-- {"품목": "의류", "제조국": "대한민국", "A/S 책임자": "OOO 02-..."}.
ALTER TABLE products ADD COLUMN notice_info_json TEXT;

-- NEW-12: KC certification flag + number.
ALTER TABLE products ADD COLUMN kc_certified INTEGER NOT NULL DEFAULT 0 CHECK (kc_certified IN (0, 1));
ALTER TABLE products ADD COLUMN kc_cert_number TEXT;

-- Hygiene: rows still carrying the d1_13 invented defaults are unknown, not
-- real contact data. NULL them so the UI reports "not registered" honestly.
UPDATE partners SET customer_service_phone = NULL WHERE customer_service_phone = '1588-0000';
UPDATE partners SET return_shipping_address = NULL WHERE return_shipping_address = '인천광역시 중구 공항동 물류센터 B동 301호';

-- Phase-1 policy alignment: the d1_11 seed answer promises instant 100%
-- credit refunds, which NEW-P0-01 replaced with approval-gated capped grants.
UPDATE support_inquiries
SET answer = '결제일로부터 30일 이내, 24시간 이상 유지된 판매가 인하에 한해 주문 상세에서 1회 신청할 수 있으며, 운영자 승인 시 결제액의 최대 10%(상한 10,000원)까지 적립됩니다.'
WHERE id = 'inq_001';
