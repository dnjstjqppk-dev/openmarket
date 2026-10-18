-- migrations/d1_09a_new_roots_and_subcategories.sql
-- 10 Temu Missing Root Categories (depth=0) & L2 Subcategories

INSERT OR IGNORE INTO categories (id, parent_id, name, slug, depth, sort_order) VALUES
('cat_curve', NULL, '여성 빅사이즈/플러스 패션', 'womens-curve-clothing', 0, 34),
('cat_lingerie', NULL, '여성 언더웨어 & 라운지웨어', 'womens-lingerie-lounge', 0, 35),
('cat_men_plus', NULL, '남성 빅사이즈 & 톨 패션', 'mens-big-tall', 0, 36),
('cat_men_und', NULL, '남성 언더웨어 & 파자마', 'mens-underwear-sleepwear', 0, 37),
('cat_women_shoes', NULL, '여성 신발', 'womens-shoes', 0, 38),
('cat_men_shoes', NULL, '남성 신발', 'mens-shoes', 0, 39),
('cat_kids_fash', NULL, '키즈 & 주니어 패션', 'kids-fashion', 0, 40),
('cat_kids_shoes', NULL, '키즈 & 아동 신발', 'kids-shoes', 0, 41),
('cat_bags', NULL, '가방 & 캐리어', 'bags-luggage', 0, 42),
('cat_beach', NULL, '비치웨어 & 스윔웨어', 'beachwear', 0, 43);

-- L2 for 10 Missing Root Categories
INSERT OR IGNORE INTO categories (id, parent_id, name, slug, depth, sort_order) VALUES
('sub_crv_01', 'cat_curve', '빅사이즈 드레스/원피스', 'curve-dresses', 1, 1),
('sub_crv_02', 'cat_curve', '빅사이즈 티셔츠/탑', 'curve-tshirts', 1, 2),
('sub_crv_03', 'cat_curve', '빅사이즈 팬츠/레깅스', 'curve-pants', 1, 3),
('sub_crv_04', 'cat_curve', '빅사이즈 아우터/자켓', 'curve-outerwear', 1, 4),
('sub_crv_05', 'cat_curve', '빅사이즈 스윔웨어', 'curve-swimwear', 1, 5),

('sub_lng_01', 'cat_lingerie', '브라 & 브라렛', 'womens-bras', 1, 1),
('sub_lng_02', 'cat_lingerie', '팬티 & 세트', 'womens-panties', 1, 2),
('sub_lng_03', 'cat_lingerie', '란제리 세트', 'womens-lingerie-sets', 1, 3),
('sub_lng_04', 'cat_lingerie', '파자마 & 슬립웨어', 'womens-sleepwear', 1, 4),
('sub_lng_05', 'cat_lingerie', '보정속옷/쉐이프웨어', 'womens-shapewear', 1, 5),
('sub_lng_06', 'cat_lingerie', '스타킹 & 삭스', 'womens-hosiery', 1, 6),

('sub_mbt_01', 'cat_men_plus', '남성 빅사이즈 티셔츠', 'mens-plus-tshirts', 1, 1),
('sub_mbt_02', 'cat_men_plus', '남성 빅사이즈 후드/맨투맨', 'mens-plus-hoodies', 1, 2),
('sub_mbt_03', 'cat_men_plus', '남성 빅사이즈 팬츠/카고', 'mens-plus-pants', 1, 3),
('sub_mbt_04', 'cat_men_plus', '남성 빅사이즈 데님/진', 'mens-plus-jeans', 1, 4),
('sub_mbt_05', 'cat_men_plus', '남성 빅사이즈 자켓/코트', 'mens-plus-jackets', 1, 5),

('sub_mnu_01', 'cat_men_und', '남성 드로즈 & 트렁크', 'mens-boxers-briefs', 1, 1),
('sub_mnu_02', 'cat_men_und', '남성 이너웨어 & 나시', 'mens-undershirts', 1, 2),
('sub_mnu_03', 'cat_men_und', '남성 보온/기모 언더웨어', 'mens-thermals', 1, 3),
('sub_mnu_04', 'cat_men_und', '남성 파자마 & 가운', 'mens-sleepwear', 1, 4),
('sub_mnu_05', 'cat_men_und', '남성 데일리 삭스', 'mens-socks', 1, 5),

('sub_wsh_01', 'cat_women_shoes', '여성 스니커즈/운동화', 'womens-sneakers', 1, 1),
('sub_wsh_02', 'cat_women_shoes', '여성 부츠 & 앵클부츠', 'womens-boots', 1, 2),
('sub_wsh_03', 'cat_women_shoes', '여성 샌들 & 슬리퍼', 'womens-sandals', 1, 3),
('sub_wsh_04', 'cat_women_shoes', '여성 플랫 & 로퍼', 'womens-flats-loafers', 1, 4),
('sub_wsh_05', 'cat_women_shoes', '여성 펌프스 & 힐', 'womens-pumps-heels', 1, 5),

('sub_msh_01', 'cat_men_shoes', '남성 캐주얼 스니커즈', 'mens-casual-shoes', 1, 1),
('sub_msh_02', 'cat_men_shoes', '남성 러닝 & 스포츠화', 'mens-running-shoes', 1, 2),
('sub_msh_03', 'cat_men_shoes', '남성 로퍼 & 슬립온', 'mens-loafers', 1, 3),
('sub_msh_04', 'cat_men_shoes', '남성 워크 & 안전화', 'mens-work-boots', 1, 4),
('sub_msh_05', 'cat_men_shoes', '남성 정장/옥스포드화', 'mens-formal-shoes', 1, 5),

('sub_kdf_01', 'cat_kids_fash', '여아 드레스 & 세트', 'girls-dresses', 1, 1),
('sub_kdf_02', 'cat_kids_fash', '남아 티셔츠 & 탑', 'boys-tops', 1, 2),
('sub_kdf_03', 'cat_kids_fash', '키즈 아우터 & 자켓', 'kids-jackets-coats', 1, 3),
('sub_kdf_04', 'cat_kids_fash', '키즈 팬츠 & 레깅스', 'kids-pants', 1, 4),
('sub_kdf_05', 'cat_kids_fash', '키즈 파자마 & 이너웨어', 'kids-underwear-pajamas', 1, 5),

('sub_kds_01', 'cat_kids_shoes', '여아 스니커즈 & 운동화', 'girls-sneakers', 1, 1),
('sub_kds_02', 'cat_kids_shoes', '남아 스니커즈 & 농구화', 'boys-sneakers', 1, 2),
('sub_kds_03', 'cat_kids_shoes', '키즈 샌들 & 아쿠아슈즈', 'kids-sandals-slippers', 1, 3),
('sub_kds_04', 'cat_kids_shoes', '키즈 부츠 & 방한화', 'kids-boots', 1, 4),
('sub_kds_05', 'cat_kids_shoes', '베이비 첫걸음 보행기화', 'baby-shoes', 1, 5),

('sub_bag_01', 'cat_bags', '여성 크로스백 & 숄더백', 'womens-crossbody-bags', 1, 1),
('sub_bag_02', 'cat_bags', '여성 토트백 & 핸드백', 'womens-handbags', 1, 2),
('sub_bag_03', 'cat_bags', '노트북 백팩 & 데일리백', 'laptop-backpacks', 1, 3),
('sub_bag_04', 'cat_bags', '남성 지갑 & 메신저백', 'mens-bags-wallets', 1, 4),
('sub_bag_05', 'cat_bags', '캐리어 & 여행용 러기지', 'travel-suitcases', 1, 5),
('sub_bag_06', 'cat_bags', '파우치 & 화장품 오거나이저', 'toiletry-makeup-bags', 1, 6),

('sub_bch_01', 'cat_beach', '여성 비키니 & 세트', 'womens-bikinis', 1, 1),
('sub_bch_02', 'cat_beach', '여성 모노키니 & 원피스수영복', 'womens-one-piece-swim', 1, 2),
('sub_bch_03', 'cat_beach', '비치 로브 & 커버업', 'beach-cover-ups', 1, 3),
('sub_bch_04', 'cat_beach', '래쉬가드 & 서프웨어', 'rash-guards', 1, 4),
('sub_bch_05', 'cat_beach', '남성 비치 스윔팬츠', 'mens-swimwear', 1, 5);

