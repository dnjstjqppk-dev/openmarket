-- D1 Migration 07: Rich multi-attribute SKU options for key OLMOA products
-- Updates existing placeholder SKUs and adds new multi-attribute variants

-- 1. prod_004: 데일리 오버핏 소프트 기모 후드티 (Color x Size)
UPDATE product_skus SET sku_code = 'HOOD-GRY-M', option_combination_json = '{"색상":"그레이","사이즈":"M"}', original_price = 38000, sale_price = 28900, stock_quantity = 180 WHERE id = 'sku_004_m';
UPDATE product_skus SET sku_code = 'HOOD-GRY-L', option_combination_json = '{"색상":"그레이","사이즈":"L"}', original_price = 38000, sale_price = 28900, stock_quantity = 300 WHERE id = 'sku_004_l';

INSERT OR IGNORE INTO product_skus (id, product_id, sku_code, option_combination_json, original_price, sale_price, stock_quantity, safety_stock, status) VALUES
('sku_004_blk_m', 'prod_004', 'HOOD-BLK-M', '{"색상":"블랙","사이즈":"M"}', 38000, 28900, 150, 10, 'IN_STOCK'),
('sku_004_blk_l', 'prod_004', 'HOOD-BLK-L', '{"색상":"블랙","사이즈":"L"}', 38000, 28900, 220, 10, 'IN_STOCK'),
('sku_004_blk_xl', 'prod_004', 'HOOD-BLK-XL', '{"색상":"블랙","사이즈":"XL"}', 40000, 30900, 80, 5, 'IN_STOCK'),
('sku_004_gry_xl', 'prod_004', 'HOOD-GRY-XL', '{"색상":"그레이","사이즈":"XL"}', 40000, 30900, 0, 5, 'OUT_OF_STOCK'),
('sku_004_nvy_m', 'prod_004', 'HOOD-NVY-M', '{"색상":"네이비","사이즈":"M"}', 38000, 28900, 95, 10, 'IN_STOCK'),
('sku_004_nvy_l', 'prod_004', 'HOOD-NVY-L', '{"색상":"네이비","사이즈":"L"}', 38000, 28900, 140, 10, 'IN_STOCK');

-- 2. prod_w_01: 프렌치 시크 플리츠 롱 원피스 (Color x Size)
UPDATE product_skus SET sku_code = 'OPS-BEG-S', option_combination_json = '{"색상":"베이지","사이즈":"S"}', original_price = 26000, sale_price = 18900, stock_quantity = 120 WHERE id = 'sku_prod_w_01';

INSERT OR IGNORE INTO product_skus (id, product_id, sku_code, option_combination_json, original_price, sale_price, stock_quantity, safety_stock, status) VALUES
('sku_w01_beg_m', 'prod_w_01', 'OPS-BEG-M', '{"색상":"베이지","사이즈":"M"}', 26000, 18900, 200, 10, 'IN_STOCK'),
('sku_w01_beg_l', 'prod_w_01', 'OPS-BEG-L', '{"색상":"베이지","사이즈":"L"}', 26000, 18900, 60, 5, 'IN_STOCK'),
('sku_w01_blk_s', 'prod_w_01', 'OPS-BLK-S', '{"색상":"블랙","사이즈":"S"}', 26000, 18900, 110, 5, 'IN_STOCK'),
('sku_w01_blk_m', 'prod_w_01', 'OPS-BLK-M', '{"색상":"블랙","사이즈":"M"}', 26000, 18900, 240, 10, 'IN_STOCK'),
('sku_w01_blk_l', 'prod_w_01', 'OPS-BLK-L', '{"색상":"블랙","사이즈":"L"}', 26000, 18900, 45, 5, 'IN_STOCK'),
('sku_w01_mnt_m', 'prod_w_01', 'OPS-MNT-M', '{"색상":"세이지민트","사이즈":"M"}', 28000, 19900, 85, 5, 'IN_STOCK');

-- 3. prod_m_01: 헤비웨이트 프리미엄 코튼 무지 오버핏 반팔티 3팩 (Package x Size)
UPDATE product_skus SET sku_code = 'TEE-MIX-M', option_combination_json = '{"패키지":"믹스(화이트/블랙/그레이)","사이즈":"M"}', original_price = 29000, sale_price = 19800, stock_quantity = 300 WHERE id = 'sku_prod_m_01';

INSERT OR IGNORE INTO product_skus (id, product_id, sku_code, option_combination_json, original_price, sale_price, stock_quantity, safety_stock, status) VALUES
('sku_m01_mix_l', 'prod_m_01', 'TEE-MIX-L', '{"패키지":"믹스(화이트/블랙/그레이)","사이즈":"L"}', 29000, 19800, 450, 15, 'IN_STOCK'),
('sku_m01_mix_xl', 'prod_m_01', 'TEE-MIX-XL', '{"패키지":"믹스(화이트/블랙/그레이)","사이즈":"XL"}', 31000, 21800, 180, 10, 'IN_STOCK'),
('sku_m01_wht_m', 'prod_m_01', 'TEE-WHT-M', '{"패키지":"올화이트 3팩","사이즈":"M"}', 29000, 19800, 200, 10, 'IN_STOCK'),
('sku_m01_wht_l', 'prod_m_01', 'TEE-WHT-L', '{"패키지":"올화이트 3팩","사이즈":"L"}', 29000, 19800, 320, 10, 'IN_STOCK'),
('sku_m01_blk_l', 'prod_m_01', 'TEE-BLK-L', '{"패키지":"올블랙 3팩","사이즈":"L"}', 29000, 19800, 280, 10, 'IN_STOCK');

-- 4. prod_e_01: 액티브 노이즈 캔슬링 Hi-Fi 무선 블루투스 헤드폰 (Color x Edition)
UPDATE product_skus SET sku_code = 'HP-BLK-STD', option_combination_json = '{"색상":"매트 블랙","패키지":"기본 패키지"}', original_price = 69000, sale_price = 45900, stock_quantity = 150 WHERE id = 'sku_prod_e_01';

INSERT OR IGNORE INTO product_skus (id, product_id, sku_code, option_combination_json, original_price, sale_price, stock_quantity, safety_stock, status) VALUES
('sku_e01_blk_pro', 'prod_e_01', 'HP-BLK-PRO', '{"색상":"매트 블랙","패키지":"하드케이스+고속케이블 세트"}', 79000, 52900, 90, 5, 'IN_STOCK'),
('sku_e01_wht_std', 'prod_e_01', 'HP-WHT-STD', '{"색상":"실버 화이트","패키지":"기본 패키지"}', 69000, 45900, 120, 10, 'IN_STOCK'),
('sku_e01_wht_pro', 'prod_e_01', 'HP-WHT-PRO', '{"색상":"실버 화이트","패키지":"하드케이스+고속케이블 세트"}', 79000, 52900, 75, 5, 'IN_STOCK'),
('sku_e01_blu_std', 'prod_e_01', 'HP-BLU-STD', '{"색상":"미드나잇 블루","패키지":"기본 패키지"}', 69000, 45900, 60, 5, 'IN_STOCK');

-- 5. prod_e_02: 20000mAh 65W 초고속 3포트 보조배터리 (Color x Spec)
UPDATE product_skus SET sku_code = 'BAT-GRY-20K', option_combination_json = '{"색상":"스페이스 그레이","용량":"20,000mAh (65W)"}', original_price = 39000, sale_price = 27900, stock_quantity = 200 WHERE id = 'sku_prod_e_02';

INSERT OR IGNORE INTO product_skus (id, product_id, sku_code, option_combination_json, original_price, sale_price, stock_quantity, safety_stock, status) VALUES
('sku_e02_gry_30k', 'prod_e_02', 'BAT-GRY-30K', '{"색상":"스페이스 그레이","용량":"30,000mAh 울트라 (100W)"}', 52000, 36900, 85, 5, 'IN_STOCK'),
('sku_e02_wht_20k', 'prod_e_02', 'BAT-WHT-20K', '{"색상":"퓨어 화이트","용량":"20,000mAh (65W)"}', 39000, 27900, 160, 10, 'IN_STOCK');

-- 6. prod_sb_02: 쿠셔닝 경량 메쉬 데일리 통기성 런닝화 (Color x Size)
UPDATE product_skus SET sku_code = 'RUN-BLK-250', option_combination_json = '{"색상":"올블랙","사이즈":"250mm"}', original_price = 39000, sale_price = 24900, stock_quantity = 50 WHERE id = 'sku_prod_sb_02';

INSERT OR IGNORE INTO product_skus (id, product_id, sku_code, option_combination_json, original_price, sale_price, stock_quantity, safety_stock, status) VALUES
('sku_sb02_blk_260', 'prod_sb_02', 'RUN-BLK-260', '{"색상":"올블랙","사이즈":"260mm"}', 39000, 24900, 120, 10, 'IN_STOCK'),
('sku_sb02_blk_270', 'prod_sb_02', 'RUN-BLK-270', '{"색상":"올블랙","사이즈":"270mm"}', 39000, 24900, 180, 10, 'IN_STOCK'),
('sku_sb02_blk_280', 'prod_sb_02', 'RUN-BLK-280', '{"색상":"올블랙","사이즈":"280mm"}', 39000, 24900, 70, 5, 'IN_STOCK'),
('sku_sb02_wht_260', 'prod_sb_02', 'RUN-WHT-260', '{"색상":"화이트/블루","사이즈":"260mm"}', 39000, 24900, 90, 5, 'IN_STOCK'),
('sku_sb02_wht_270', 'prod_sb_02', 'RUN-WHT-270', '{"색상":"화이트/블루","사이즈":"270mm"}', 39000, 24900, 140, 10, 'IN_STOCK');

