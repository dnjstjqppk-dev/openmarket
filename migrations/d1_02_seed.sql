-- D1 Migration 02: Initial Seed Data

-- Admin User
INSERT OR IGNORE INTO users (id, email, password_hash, full_name, phone, role, is_active)
VALUES ('u_admin_001', 'admin@openmarket.com', '$2a$10$abcdefghijklmnopqrstuvwxAdminHash001', 'Super Admin', '010-1111-2222', 'ROLE_ADMIN', 1);

-- Partner User
INSERT OR IGNORE INTO users (id, email, password_hash, full_name, phone, role, is_active)
VALUES ('u_partner_001', 'seller@temu-supply.com', '$2a$10$abcdefghijklmnopqrstuvwxPartnerHash001', 'Global Supplier', '010-3333-4444', 'ROLE_PARTNER', 1);

-- Customer User
INSERT OR IGNORE INTO users (id, email, password_hash, full_name, phone, role, is_active)
VALUES ('u_customer_001', 'customer@example.com', '$2a$10$abcdefghijklmnopqrstuvwxCustomerHash001', 'Jane Doe', '010-5555-6666', 'ROLE_CUSTOMER', 1);

-- Partner Company
INSERT OR IGNORE INTO partners (id, owner_user_id, business_name, business_reg_number, commission_rate, bank_code, bank_account_number, bank_account_holder, status)
VALUES ('pt_001', 'u_partner_001', 'Global Direct Logistics Ltd.', '101-88-99999', 10.0, 'SHINHAN', '110-123-456789', 'Global Direct', 'APPROVED');

-- Root Categories
INSERT OR IGNORE INTO categories (id, parent_id, name, slug, depth, sort_order)
VALUES 
('cat_fashion', NULL, '의류/패션', 'fashion', 0, 1),
('cat_electronics', NULL, '전자/디지털', 'electronics', 0, 2),
('cat_home', NULL, '홈/인테리어', 'home', 0, 3),
('cat_beauty', NULL, '뷰티/케어', 'beauty', 0, 4),
('cat_sports', NULL, '스포츠/레저', 'sports', 0, 5);

-- Sub Categories
INSERT OR IGNORE INTO categories (id, parent_id, name, slug, depth, sort_order)
VALUES 
('cat_f_men', 'cat_fashion', '남성패션', 'mens-fashion', 1, 1),
('cat_f_women', 'cat_fashion', '여성패션', 'womens-fashion', 1, 2),
('cat_e_gadgets', 'cat_electronics', '스마트기기', 'smart-gadgets', 1, 1),
('cat_e_audio', 'cat_electronics', '음향기기', 'audio-video', 1, 2),
('cat_h_kitchen', 'cat_home', '주방용품', 'kitchenware', 1, 1);

-- Seed Products
INSERT OR IGNORE INTO products (id, partner_id, category_id, title, thumbnail_url, description_html, lowest_original_price, lowest_sale_price, total_sold_count, status)
VALUES 
('prod_001', 'pt_001', 'cat_e_audio', '초경량 액티브 노이즈캔슬링 무선 이어폰 Pro 3', 'https://images.unsplash.com/photo-1590658268037-6bf12165a8df?w=500', '<p>Hi-Fi 무손실 음원 지원 및 48시간 연속 재생</p>', 129000, 49900, 1420, 'ACTIVE'),
('prod_002', 'pt_001', 'cat_e_gadgets', '울트라 슬림 65W GaN 고속 충전기 3포트 멀티허브', 'https://images.unsplash.com/photo-1583863788434-e58a36330cf0?w=500', '<p>PD 3.0 초고속 충전 지원 맥북/아이폰/갤럭시 동시 충전</p>', 59000, 24500, 3100, 'ACTIVE'),
('prod_003', 'pt_001', 'cat_h_kitchen', '스마트 타이머 진공 밀폐 보관용기 4종 세트', 'https://images.unsplash.com/photo-1584269600464-37b1b58a9fe7?w=500', '<p>원터치 자동 진공 감압으로 5배 더 오래 신선하게 유지</p>', 45000, 19900, 890, 'ACTIVE'),
('prod_004', 'pt_001', 'cat_f_women', '데일리 오버핏 소프트 기모 후드티 (10컬러)', 'https://images.unsplash.com/photo-1556905055-8f358a7a47b2?w=500', '<p>프리미엄 코튼 100% 텐타 덤블 가공으로 변형 방지</p>', 69000, 28900, 5210, 'ACTIVE');

-- Seed SKUs
INSERT OR IGNORE INTO product_skus (id, product_id, sku_code, option_combination_json, original_price, sale_price, stock_quantity, safety_stock, status)
VALUES 
('sku_001_w', 'prod_001', 'EAR-PRO3-WHT', '{"color":"White"}', 129000, 49900, 500, 10, 'IN_STOCK'),
('sku_001_b', 'prod_001', 'EAR-PRO3-BLK', '{"color":"Black"}', 129000, 49900, 320, 10, 'IN_STOCK'),
('sku_002_65w', 'prod_002', 'GAN-65W-BLK', '{"spec":"65W 3-Port"}', 59000, 24500, 1200, 20, 'IN_STOCK'),
('sku_003_set', 'prod_003', 'VAC-CAN-4SET', '{"set":"4-Pieces"}', 45000, 19900, 450, 15, 'IN_STOCK'),
('sku_004_m', 'prod_004', 'HOOD-GRY-M', '{"color":"Grey","size":"M"}', 69000, 28900, 200, 10, 'IN_STOCK'),
('sku_004_l', 'prod_004', 'HOOD-GRY-L', '{"color":"Grey","size":"L"}', 69000, 28900, 350, 10, 'IN_STOCK');

