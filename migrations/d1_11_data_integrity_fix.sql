-- migrations/d1_11_data_integrity_fix.sql
-- Phase 1~4 Comprehensive Data Integrity Remediation & OpenMarket Extended Domain Tables

-- 1. Fix GNB Root Category Slugs (d1_02 vs d1_03 PK Collision Resolution) & Remove Orphan cat_fashion
UPDATE categories SET name = '홈/주방', slug = 'home-kitchen', sort_order = 4 WHERE id = 'cat_home';
UPDATE categories SET name = '뷰티/헬스', slug = 'beauty-health', sort_order = 5 WHERE id = 'cat_beauty';
UPDATE categories SET name = '스포츠/레저', slug = 'sports-outdoors', sort_order = 6 WHERE id = 'cat_sports';
UPDATE categories SET name = '디지털/가전', slug = 'electronics', sort_order = 3 WHERE id = 'cat_electronics';

UPDATE categories SET parent_id = 'cat_women', sort_order = 3 WHERE id = 'cat_f_women';
UPDATE categories SET parent_id = 'cat_men', sort_order = 3 WHERE id = 'cat_f_men';
UPDATE products SET category_id = 'sub_w_tops' WHERE category_id = 'cat_fashion';
DELETE FROM categories WHERE id = 'cat_fashion';

-- 2. Add Second Approved Partner (pt_002) for True Multi-Vendor Split-Order Operations
INSERT OR IGNORE INTO users (id, email, password_hash, full_name, phone, role, is_active)
VALUES ('u_partner_002', 'partner2@olmoa-tech.com', '$2a$10$abcdefghijklmnopqrstuvwxPartnerHash002', 'K-Tech Official', '010-7777-8888', 'ROLE_PARTNER', 1);

INSERT OR IGNORE INTO partners (id, owner_user_id, business_name, business_reg_number, commission_rate, bank_code, bank_account_number, bank_account_holder, status, base_shipping_fee, free_shipping_threshold)
VALUES ('pt_002', 'u_partner_002', 'K-Tech & Lifestyle Official', '214-86-54321', 10.0, 'KOOKMIN', '042-987-654321', 'K-Tech Corp', 'APPROVED', 2500, 30000);

UPDATE products SET partner_id = 'pt_002' WHERE id IN ('prod_002', 'prod_e_01', 'prod_e_02', 'prod_e_03', 'prod_app_01', 'prod_cel_01', 'prod_smt_01', 'prod_gam_01');

-- 3. Map Products from L1 Root Categories to Proper L2 Subcategories (Fixes L2 Empty Subcategory Issue)
UPDATE products SET category_id = 'sub_w_dress' WHERE id = 'prod_w_01';
UPDATE products SET category_id = 'sub_w_tops'  WHERE id IN ('prod_w_02', 'prod_w_03');
UPDATE products SET category_id = 'sub_m_tshirts' WHERE id IN ('prod_m_01', 'prod_m_03');
UPDATE products SET category_id = 'sub_m_pants' WHERE id = 'prod_m_02';
UPDATE products SET category_id = 'sub_e_audio' WHERE id = 'prod_e_01';
UPDATE products SET category_id = 'sub_e_power' WHERE id = 'prod_e_02';
UPDATE products SET category_id = 'sub_e_smart' WHERE id = 'prod_e_03';
UPDATE products SET category_id = 'sub_h_kitchen' WHERE id IN ('prod_h_01', 'prod_h_03');
UPDATE products SET category_id = 'sub_h_decor' WHERE id = 'prod_h_02';
UPDATE products SET category_id = 'sub_b_skin'  WHERE id = 'prod_b_01';
UPDATE products SET category_id = 'sub_b_tool'  WHERE id = 'prod_b_02';
UPDATE products SET category_id = 'sub_s_fit'   WHERE id = 'prod_s_01';
UPDATE products SET category_id = 'sub_s_camp'  WHERE id = 'prod_s_02';
UPDATE products SET category_id = 'sub_sb_bags' WHERE id = 'prod_sb_01';
UPDATE products SET category_id = 'sub_sb_shoes' WHERE id = 'prod_sb_02';
UPDATE products SET category_id = 'sub_t_lego'  WHERE id IN ('prod_t_01', 'prod_t_02');
UPDATE products SET category_id = 'sub_a_mount' WHERE id IN ('prod_a_01', 'prod_a_02', 'prod_a_03');
UPDATE products SET category_id = 'sub_j_watch' WHERE id IN ('prod_j_01', 'prod_j_02', 'prod_j_03');
UPDATE products SET category_id = 'sub_bed_01'  WHERE id = 'prod_bed_01';
UPDATE products SET category_id = 'sub_fur_01'  WHERE id = 'prod_fur_01';
UPDATE products SET category_id = 'sub_app_02'  WHERE id = 'prod_app_01';
UPDATE products SET category_id = 'sub_cel_01'  WHERE id = 'prod_cel_01';
UPDATE products SET category_id = 'sub_smh_01'  WHERE id = 'prod_smt_01';
UPDATE products SET category_id = 'sub_hlt_02'  WHERE id = 'prod_hlt_01';
UPDATE products SET category_id = 'sub_bby_01'  WHERE id = 'prod_bby_01';
UPDATE products SET category_id = 'sub_pet_03'  WHERE id = 'prod_pet_01';
UPDATE products SET category_id = 'sub_ofc_03'  WHERE id = 'prod_off_01';
UPDATE products SET category_id = 'sub_bks_03'  WHERE id = 'prod_bok_01';
UPDATE products SET category_id = 'sub_crf_01'  WHERE id = 'prod_crf_01';
UPDATE products SET category_id = 'sub_tol_02'  WHERE id = 'prod_tol_01';
UPDATE products SET category_id = 'sub_ptg_02'  WHERE id = 'prod_pat_01';
UPDATE products SET category_id = 'sub_fod_01'  WHERE id = 'prod_fod_01';
UPDATE products SET category_id = 'sub_gam_01'  WHERE id = 'prod_gam_01';
UPDATE products SET category_id = 'sub_mus_01'  WHERE id = 'prod_mus_01';
UPDATE products SET category_id = 'sub_sec_01'  WHERE id = 'prod_sec_01';
UPDATE products SET category_id = 'sub_trv_01'  WHERE id = 'prod_trv_01';
UPDATE products SET category_id = 'sub_wat_01'  WHERE id = 'prod_wat_01';
UPDATE products SET category_id = 'sub_pty_01'  WHERE id = 'prod_prt_01';
UPDATE products SET category_id = 'sub_ind_01'  WHERE id = 'prod_ind_01';
UPDATE products SET category_id = 'sub_gft_01'  WHERE id = 'prod_gft_01';

-- 4. Seed Real Products & SKUs for the 10 New Root Categories in d1_09a (Zero Empty Root Categories)
INSERT OR IGNORE INTO products (id, partner_id, category_id, title, thumbnail_url, description_html, lowest_original_price, lowest_sale_price, total_sold_count, status) VALUES
('prod_crv_01', 'pt_001', 'sub_crv_01', '플러스사이즈 프렌치 랩 V넥 플레어 미디 원피스 (XL~4XL)', 'https://images.unsplash.com/photo-1572804013309-59a88b7e92f1?w=500', '<p>편안한 신축성과 우아한 실루엣의 빅사이즈 전용 플레어 원피스</p>', 46000, 21900, 2840, 'ACTIVE'),
('prod_lng_01', 'pt_001', 'sub_lng_01', '무봉제 노와이어 에어쿨 심리스 브라렛 3팩 세트', 'https://images.unsplash.com/photo-1551803091-e20673f15770?w=500', '<p>자국 없이 피부처럼 밀착되는 통기성 초경량 심리스 브라렛</p>', 39000, 16900, 9120, 'ACTIVE'),
('prod_mbt_01', 'pt_001', 'sub_mbt_01', '남성 빅사이즈 헤비코튼 오버핏 반팔 티셔츠 (2XL~5XL)', 'https://images.unsplash.com/photo-1521572267360-ee0c2909d518?w=500', '<p>체형 보정 어깨 라인과 탄탄한 16수 코튼 빅사이즈 티셔츠</p>', 34000, 15900, 4150, 'ACTIVE'),
('prod_mnu_01', 'pt_001', 'sub_mnu_01', '남성 쿨링 모달 드로즈 언더웨어 5종 패키지', 'https://images.unsplash.com/photo-1624378439575-d8705ad7ae80?w=500', '<p>실키한 렌징 모달 혼방으로 하루 종일 쾌적한 착용감</p>', 42000, 18500, 7630, 'ACTIVE'),
('prod_wsh_01', 'pt_001', 'sub_wsh_01', '여성 초경량 에어쿠션 니트 워킹 스니커즈 (225~255mm)', 'https://images.unsplash.com/photo-1542291026-7eec264c27ff?w=500', '<p>210g 초경량 설계와 발바닥 아치 서포트 메모리폼 인솔</p>', 54000, 23900, 6340, 'ACTIVE'),
('prod_msh_01', 'pt_001', 'sub_msh_02', '남성 카본 플레이트 리바운드 러닝화 (250~290mm)', 'https://images.unsplash.com/photo-1542291026-7eec264c27ff?w=500', '<p>강력한 추진력과 충격 흡수 쿠셔닝 미드솔</p>', 68000, 29900, 5480, 'ACTIVE'),
('prod_kdf_01', 'pt_001', 'sub_kdf_01', '키즈 오가닉 코튼 상하복 데일리 활동복 세트 (100~150호)', 'https://images.unsplash.com/photo-1515488042361-ee00e0ddd4e4?w=500', '<p>민감한 아이 피부를 위한 무형광 순면 100% 상하세트</p>', 32000, 14500, 3920, 'ACTIVE'),
('prod_kds_01', 'pt_001', 'sub_kds_01', '아동 논슬립 벨크로 LED 라이트 스니커즈 운동화', 'https://images.unsplash.com/photo-1542291026-7eec264c27ff?w=500', '<p>아이 혼자 신고 벗기 편한 벨크로 스트랩과 미끄럼 방지 밑창</p>', 38000, 17900, 2780, 'ACTIVE'),
('prod_bag_01', 'pt_001', 'sub_bag_02', '기내용 20인치 폴리카보네이트 TSA락 하드 캐리어', 'https://images.unsplash.com/photo-1553062407-98eeb64c6a62?w=500', '<p>360도 저소음 우레탄 더블휠 및 내충격 PC 바디</p>', 89000, 39900, 4890, 'ACTIVE'),
('prod_bch_01', 'pt_001', 'sub_bch_03', 'UPF50+ 자외선차단 남녀공용 집업 래쉬가드 스윔웨어', 'https://images.unsplash.com/photo-1544441893-675973e31985?w=500', '<p>빠른 건조 기능성 원단과 99% UV 차단 비치웨어</p>', 42000, 18900, 3510, 'ACTIVE');

INSERT OR IGNORE INTO product_skus (id, product_id, sku_code, option_combination_json, original_price, sale_price, stock_quantity, safety_stock, status) VALUES
('sku_crv_01_2xl', 'prod_crv_01', 'CRV-OPS-2XL', '{"색상":"네이비","사이즈":"2XL"}', 46000, 21900, 180, 10, 'IN_STOCK'),
('sku_crv_01_3xl', 'prod_crv_01', 'CRV-OPS-3XL', '{"색상":"네이비","사이즈":"3XL"}', 46000, 21900, 150, 10, 'IN_STOCK'),
('sku_lng_01_m',   'prod_lng_01', 'LNG-BRA-M',   '{"구성":"스킨/블랙/아이보리 3팩","사이즈":"M"}', 39000, 16900, 320, 15, 'IN_STOCK'),
('sku_lng_01_l',   'prod_lng_01', 'LNG-BRA-L',   '{"구성":"스킨/블랙/아이보리 3팩","사이즈":"L"}', 39000, 16900, 280, 15, 'IN_STOCK'),
('sku_mbt_01_3xl', 'prod_mbt_01', 'MBT-TEE-3XL', '{"색상":"블랙","사이즈":"3XL"}', 34000, 15900, 240, 10, 'IN_STOCK'),
('sku_mnu_01_xl',  'prod_mnu_01', 'MNU-DRW-XL',  '{"패키지":"5종 믹스","사이즈":"XL(105)"}', 42000, 18500, 400, 15, 'IN_STOCK'),
('sku_wsh_01_240', 'prod_wsh_01', 'WSH-SNK-240', '{"색상":"화이트베이지","사이즈":"240mm"}', 54000, 23900, 210, 10, 'IN_STOCK'),
('sku_msh_01_270', 'prod_msh_01', 'MSH-RUN-270', '{"색상":"네온블랙","사이즈":"270mm"}', 68000, 29900, 190, 10, 'IN_STOCK'),
('sku_kdf_01_120', 'prod_kdf_01', 'KDF-SET-120', '{"색상":"크림베어","사이즈":"120호"}', 32000, 14500, 160, 10, 'IN_STOCK'),
('sku_kds_01_180', 'prod_kds_01', 'KDS-LED-180', '{"색상":"블루스타","사이즈":"180mm"}', 38000, 17900, 140, 10, 'IN_STOCK'),
('sku_bag_01_slv', 'prod_bag_01', 'BAG-CAR-20S', '{"색상":"실버메탈","규격":"20인치 기내용"}', 89000, 39900, 120, 5, 'IN_STOCK'),
('sku_bch_01_l',   'prod_bch_01', 'BCH-RSH-L',   '{"색상":"오션네이비","사이즈":"L"}', 42000, 18900, 220, 10, 'IN_STOCK');

-- 5. Synchronize Product-Level Lowest Prices with SKU Prices (Eliminates Discount Rate Drift)
UPDATE products SET
  lowest_sale_price = (SELECT MIN(sale_price) FROM product_skus WHERE product_id = products.id),
  lowest_original_price = (SELECT MIN(original_price) FROM product_skus WHERE product_id = products.id)
WHERE id IN (SELECT DISTINCT product_id FROM product_skus);

-- 6. Fix Mismapped Reviews (rev_004 & rev_005) and Seed Verified Reviews for Flagship Products
UPDATE product_reviews SET product_id = 'prod_m_03', sku_option_summary = '블랙 / L (100)' WHERE id = 'rev_004';
UPDATE product_reviews SET product_id = 'prod_e_02', sku_option_summary = '스페이스 그레이 / 20,000mAh (65W)' WHERE id = 'rev_005';

INSERT OR IGNORE INTO product_reviews (id, product_id, user_id, reviewer_name, sku_option_summary, rating, content, images_json, helpful_count, is_verified_purchase, created_at) VALUES
('rev_006', 'prod_002', 'u_customer_001', '한*민', '65W 3-Port / 블랙', 4.9, '맥북 프로랑 아이폰 동시에 물려도 발열이 거의 없고 충전 속도가 정말 빠릅니다. 크기도 작아서 출장 필수템이에요!', '["https://images.unsplash.com/photo-1583863788434-e58a36330cf0?w=300"]', 29, 1, datetime('now', '-2 days')),
('rev_007', 'prod_003', 'u_customer_001', '오*주', '4-Pieces 세트', 4.8, '버튼 한 번만 누르면 알아서 진공을 잡아줘서 샐러드 야채가 일주일 넘게 아삭합니다. 냉장고 정리하기 딱 좋아요.', '["https://images.unsplash.com/photo-1584269600464-37b1b58a9fe7?w=300"]', 19, 1, datetime('now', '-3 days')),
('rev_008', 'prod_004', 'u_customer_001', '강*현', '블랙 / L', 4.9, '기모가 부드럽고 세탁기 돌려도 목 늘어남이나 수축이 전혀 없네요. 그레이 색상도 추가 구매했습니다.', '["https://images.unsplash.com/photo-1556905055-8f358a7a47b2?w=300"]', 42, 1, datetime('now', '-1 day')),
('rev_009', 'prod_w_01', 'u_customer_001', '윤*아', '베이지 / M', 4.9, '플리츠 주름이 고급스럽고 허리 리본 묶으면 라인이 정말 예쁩니다. 결혼식 하객룩으로 최고예요.', '[]', 21, 1, datetime('now', '-4 days')),
('rev_010', 'prod_e_01', 'u_customer_001', '임*호', '매트 블랙 / 기본 패키지', 4.9, '배터리가 진짜 오래 가고 귀를 완전히 감싸줘서 비행기나 카페에서 집중할 때 너무 좋습니다.', '[]', 35, 1, datetime('now', '-2 days'));

-- 7. OpenMarket Extended Tables: Product Q&A, Customer Support Inquiries & Seller Notices
CREATE TABLE IF NOT EXISTS product_qna (
    id TEXT PRIMARY KEY,
    product_id TEXT NOT NULL REFERENCES products(id),
    partner_id TEXT NOT NULL REFERENCES partners(id),
    user_id TEXT NOT NULL REFERENCES users(id),
    questioner_name TEXT NOT NULL,
    question TEXT NOT NULL,
    answer TEXT,
    is_secret INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'WAITING' CHECK(status IN ('WAITING', 'ANSWERED')),
    answered_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO product_qna (id, product_id, partner_id, user_id, questioner_name, question, answer, is_secret, status, answered_at, created_at) VALUES
('qna_001', 'prod_001', 'pt_001', 'u_customer_001', '김*수', '아이폰 15 프로랑 멀티포인트 동시 연결 지원되나요?', '안녕하세요 고객님! 네, 블루투스 5.3 기반 최대 2대 기기 멀티포인트 동시 연결을 완벽 지원합니다.', 0, 'ANSWERED', datetime('now', '-2 days'), datetime('now', '-3 days')),
('qna_002', 'prod_004', 'pt_001', 'u_customer_001', '박*영', '평소 100 사이즈 입는데 오버핏이면 M이 맞을까요 L이 맞을까요?', '안녕하세요! 본 상품은 여유 있는 세미 오버핏으로 정사이즈 100 기준 자연스러운 핏은 M, 루즈한 오버핏은 L 사이즈를 추천드립니다.', 0, 'ANSWERED', datetime('now', '-1 day'), datetime('now', '-2 days')),
('qna_003', 'prod_002', 'pt_002', 'u_customer_001', '이*훈', '220V 한국형 돼지코 플러그 기본 사양인가요?', '네 고객님! KC 안전인증 완료된 국내 정식 규격 220V 플러그 일체형 제품으로 별도 어댑터 없이 바로 사용하실 수 있습니다.', 0, 'ANSWERED', datetime('now', '-1 day'), datetime('now', '-1 day'));

CREATE TABLE IF NOT EXISTS support_inquiries (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    order_id TEXT,
    category TEXT NOT NULL CHECK(category IN ('DELIVERY', 'REFUND_RETURN', 'PRICE_MATCH', 'PAYMENT', 'PARTNER_JOIN', 'OTHER')),
    subject TEXT NOT NULL,
    content TEXT NOT NULL,
    answer TEXT,
    status TEXT NOT NULL DEFAULT 'OPEN' CHECK(status IN ('OPEN', 'ANSWERED', 'CLOSED')),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO support_inquiries (id, user_id, order_id, category, subject, content, answer, status, created_at) VALUES
('inq_001', 'u_customer_001', NULL, 'PRICE_MATCH', '30일 최저가 보상제 적립금 지급 기준 문의', '구매 후 가격이 내려가면 언제든 신청 가능한가요?', '네! 결제 완료일로부터 30일 이내 올모아 판매가가 인하된 경우 [주문 상세 > 최저가 차액 보상 신청] 버튼 클릭 시 차액 100%가 즉시 올모아 크레딧으로 자동 환급됩니다.', 'ANSWERED', datetime('now', '-2 days'));

-- Ensure all demo customer aliases exist in users table for FK and ownership parity
INSERT OR IGNORE INTO users (id, email, password_hash, full_name, phone, role, is_active) VALUES
('cust_demo_001', 'alex.kim@olmoa.com', '$2a$10$demoHashCust001', 'Alex Kim', '010-8282-5959', 'ROLE_CUSTOMER', 1),
('u_cust_001', 'cust1@olmoa.com', '$2a$10$demoHashCust002', '김고객', '010-1111-2222', 'ROLE_CUSTOMER', 1);
