-- migrations/d1_12_addresses_notifications_banners.sql
-- OLMOA Address Management, Notifications & Dynamic Promotion Banners

-- 1. Multi-Address Book for Customers
CREATE TABLE IF NOT EXISTS user_addresses (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    recipient_name TEXT NOT NULL,
    phone TEXT NOT NULL,
    postal_code TEXT NOT NULL,
    address_line1 TEXT NOT NULL,
    address_line2 TEXT,
    is_default INTEGER NOT NULL DEFAULT 0,
    delivery_note TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_user_addresses_user_id ON user_addresses(user_id);

-- 2. Customer Notifications & Alerts
CREATE TABLE IF NOT EXISTS notifications (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('ORDER_STATUS', 'DISCOUNT', 'CREDIT_GRANTED', 'SYSTEM')),
    is_read INTEGER NOT NULL DEFAULT 0,
    action_url TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications(user_id);

-- 3. Dynamic Homepage Promotion Banners
CREATE TABLE IF NOT EXISTS banners (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    subtitle TEXT,
    badge_text TEXT,
    image_url TEXT NOT NULL,
    link_url TEXT NOT NULL,
    bg_gradient TEXT NOT NULL DEFAULT 'from-orange-500 to-red-600',
    display_order INTEGER NOT NULL DEFAULT 0,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Seed default addresses for demo customer
INSERT OR REPLACE INTO user_addresses (id, user_id, recipient_name, phone, postal_code, address_line1, address_line2, is_default, delivery_note)
VALUES
('addr_001', 'u_customer_001', '김고객', '010-1234-5678', '06236', '서울특별시 강남구 테헤란로 152', '강남파이낸스센터 12층', 1, '문 앞에 놓아주세요'),
('addr_002', 'u_customer_001', '김고객 (본가)', '010-1234-5678', '48058', '부산광역시 해운대구 센텀중앙로 90', '센텀스퀘어 502호', 0, '배송 전 연락바랍니다');

-- Seed initial notifications for demo customer
INSERT OR REPLACE INTO notifications (id, user_id, title, message, type, is_read, action_url)
VALUES
('noti_001', 'u_customer_001', '🎉 웰컴 10,000원 적립금 지급 완료', '신규 회원가입을 축하드립니다! 첫 주문 시 즉시 사용 가능한 10,000원 크레딧이 적립되었습니다.', 'CREDIT_GRANTED', 0, '/coupons'),
('noti_002', 'u_customer_001', '⚡ 번개특가 한정수량 오픈', '관심 카테고리 [디지털 가전] 파격 특가가 오픈되었습니다. 50% 이상 할인 찬스를 놓치지 마세요!', 'DISCOUNT', 0, '/channel/lightning-deals'),
('noti_003', 'u_customer_001', '🛡️ 90일 무료반품 보장 안내', '올모아의 모든 상품은 구매 후 90일 동안 안심 무료 반품이 보장됩니다.', 'SYSTEM', 1, '/policy/returns');

-- Seed dynamic promotional banners
INSERT OR REPLACE INTO banners (id, title, subtitle, badge_text, image_url, link_url, bg_gradient, display_order, is_active)
VALUES
('bnr_001', '2026 글로벌 메가 쇼핑 페스티벌', '전 세계 공장 직발송 최저가 도전! 최대 85% 파격 할인', 'MEGA SALE', 'https://images.unsplash.com/photo-1607082348824-0a96f2a4b9da?w=1200&q=80', '/channel/lightning-deals', 'from-[#FF5000] via-[#FF2E00] to-[#CC0000]', 1, 1),
('bnr_002', '30,000원 이상 무조건 무료배송', '복수 판매자 주문도 묶음 안심 배송 + 30일 최저가 차액보상', 'FREE SHIPPING', 'https://images.unsplash.com/photo-1526304640581-d334cdbbf45e?w=1200&q=80', '/categories', 'from-[#111111] via-[#222222] to-[#3B82F6]', 2, 1),
('bnr_003', '신규회원 100,000원 웰컴 쿠폰팩', '가입 즉시 10,000원 적립금 + 첫 구매 20% 추가 할인', 'WELCOME PACK', 'https://images.unsplash.com/photo-1556742049-0a67c5574f73?w=1200&q=80', '/register', 'from-[#E60023] via-[#D10020] to-[#FF8C00]', 3, 1);

