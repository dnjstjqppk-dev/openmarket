-- D1 Migration 03: Temu-style Global Taxonomy & Rich Product Catalog Seed

-- 1. Insert 10 Major Categories & Subcategories
INSERT OR IGNORE INTO categories (id, parent_id, name, slug, depth, sort_order) VALUES
('cat_women', NULL, '여성의류', 'womens-clothing', 0, 1),
('cat_men', NULL, '남성의류', 'mens-clothing', 0, 2),
('cat_electronics', NULL, '디지털/가전', 'electronics', 0, 3),
('cat_home', NULL, '홈/주방', 'home-kitchen', 0, 4),
('cat_beauty', NULL, '뷰티/헬스', 'beauty-health', 0, 5),
('cat_sports', NULL, '스포츠/레저', 'sports-outdoors', 0, 6),
('cat_shoes_bags', NULL, '신발/가방', 'shoes-bags', 0, 7),
('cat_toys', NULL, '완구/취미', 'toys-games', 0, 8),
('cat_auto', NULL, '차량용품', 'automotive', 0, 9),
('cat_jewelry', NULL, '주얼리/시계', 'jewelry-accessories', 0, 10);

-- Subcategories
INSERT OR IGNORE INTO categories (id, parent_id, name, slug, depth, sort_order) VALUES
('sub_w_dress', 'cat_women', '원피스/스커트', 'dresses-skirts', 1, 1),
('sub_w_tops', 'cat_women', '블라우스/셔츠', 'women-tops', 1, 2),
('sub_m_tshirts', 'cat_men', '티셔츠/맨투맨', 'men-tshirts', 1, 1),
('sub_m_pants', 'cat_men', '팬츠/슬랙스', 'men-pants', 1, 2),
('sub_e_audio', 'cat_electronics', '무선이어폰/헤드폰', 'wireless-audio', 1, 1),
('sub_e_power', 'cat_electronics', '충전기/보조배터리', 'chargers-power', 1, 2),
('sub_e_smart', 'cat_electronics', '스마트워치/밴드', 'smart-wearables', 1, 3),
('sub_h_kitchen', 'cat_home', '주방용품/조리기구', 'kitchen-cookware', 1, 1),
('sub_h_decor', 'cat_home', '인테리어/수납', 'home-decor', 1, 2),
('sub_b_skin', 'cat_beauty', '스킨케어/보습', 'skin-care', 1, 1),
('sub_b_tool', 'cat_beauty', '미용소품/브러시', 'beauty-tools', 1, 2),
('sub_s_fit', 'cat_sports', '피트니스/요가', 'fitness-yoga', 1, 1),
('sub_s_camp', 'cat_sports', '캠핑/등산', 'camping-outdoor', 1, 2),
('sub_sb_bags', 'cat_shoes_bags', '백팩/크로스백', 'backpacks-bags', 1, 1),
('sub_sb_shoes', 'cat_shoes_bags', '스니커즈/슬리퍼', 'sneakers-shoes', 1, 2),
('sub_t_lego', 'cat_toys', '블록/퍼즐', 'blocks-puzzles', 1, 1),
('sub_a_mount', 'cat_auto', '차량거치대/액세서리', 'car-mounts', 1, 1),
('sub_j_watch', 'cat_jewelry', '패션시계/스트랩', 'watches-straps', 1, 1);

-- 2. Products across all 10 Major Categories (Partner: pt_001)
INSERT OR IGNORE INTO products (id, partner_id, category_id, title, thumbnail_url, description_html, lowest_original_price, lowest_sale_price, total_sold_count, status) VALUES
-- Women's Clothing
('prod_w_01', 'pt_001', 'cat_women', '프렌치 시크 플리츠 롱 원피스 (허리 리본 포함)', 'https://images.unsplash.com/photo-1572804013309-59a88b7e92f1?w=500', '<p>체형 커버 및 차르르 떨어지는 실루엣</p>', 48000, 18900, 4820, 'ACTIVE'),
('prod_w_02', 'pt_001', 'cat_women', '오버핏 소프트 텐셀 루즈핏 셔츠 (5컬러)', 'https://images.unsplash.com/photo-1551803091-e20673f15770?w=500', '<p>부드러운 촉감과 구김 없는 데일리 셔츠</p>', 36000, 14200, 6210, 'ACTIVE'),

-- Men's Clothing
('prod_m_01', 'pt_001', 'cat_men', '헤비웨이트 프리미엄 코튼 무지 오버핏 반팔티 3팩', 'https://images.unsplash.com/photo-1521572267360-ee0c2909d518?w=500', '<p>늘어남 방지 넥 테이핑 가공</p>', 45000, 19800, 9300, 'ACTIVE'),
('prod_m_02', 'pt_001', 'cat_men', '4계절 와이드 밴딩 카고 슬랙스 팬츠', 'https://images.unsplash.com/photo-1624378439575-d8705ad7ae80?w=500', '<p>스판 4% 함유 편안한 핏</p>', 52000, 23500, 3400, 'ACTIVE'),

-- Electronics
('prod_e_01', 'pt_001', 'cat_electronics', '액티브 노이즈 캔슬링 Hi-Fi 무선 블루투스 헤드폰', 'https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=500', '<p>최대 60시간 연속 재생 지원</p>', 119000, 45900, 8400, 'ACTIVE'),
('prod_e_02', 'pt_001', 'cat_electronics', '20000mAh 65W 초고속 3포트 보조배터리', 'https://images.unsplash.com/photo-1609592424109-dd9892f1b177?w=500', '<p>노트북 및 스마트폰 동시 초고속 충전</p>', 59000, 27900, 12500, 'ACTIVE'),
('prod_e_03', 'pt_001', 'cat_electronics', 'AMOLED 디스플레이 스마트 피트니스 트래커 워치', 'https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=500', '<p>혈중 산소 및 100가지 운동 모드</p>', 89000, 32900, 5600, 'ACTIVE'),

-- Home & Kitchen
('prod_h_01', 'pt_001', 'cat_home', '논스틱 인덕션 다이아몬드 코팅 프라이팬 28cm', 'https://images.unsplash.com/photo-1584269600464-37b1b58a9fe7?w=500', '<p>PFOA FREE 친환경 코팅</p>', 42000, 17800, 4100, 'ACTIVE'),
('prod_h_02', 'pt_001', 'cat_home', '무선 센서 LED 마그네틱 인테리어 간접등 (3단계 조광)', 'https://images.unsplash.com/photo-1507473885765-e6ed057f782c?w=500', '<p>간편 자석 부착 및 USB C타입 충전</p>', 25000, 9900, 15800, 'ACTIVE'),

-- Beauty & Health
('prod_b_01', 'pt_001', 'cat_beauty', '저분자 히알루론산 수분 진정 앰플 대용량 100ml', 'https://images.unsplash.com/photo-1608248597359-59754f243026?w=500', '<p>피부 속 깊은 24시간 보습 지속력</p>', 38000, 13500, 7890, 'ACTIVE'),
('prod_b_02', 'pt_001', 'cat_beauty', '초미세 극세사 프리미엄 메이크업 브러시 12종 세트', 'https://images.unsplash.com/photo-1522337360788-8b13dee7a37e?w=500', '<p>파우치 포함 최고급 인조모</p>', 32000, 12900, 6420, 'ACTIVE'),

-- Sports & Outdoors
('prod_s_01', 'pt_001', 'cat_sports', 'TPE 친환경 논슬립 8mm 두꺼운 홈트 요가매트 + 스트랩', 'https://images.unsplash.com/photo-1592432678016-e910b452f9a2?w=500', '<p>관절 보호 쿠션력 및 미끄럼 방지</p>', 35000, 16900, 4200, 'ACTIVE'),
('prod_s_02', 'pt_001', 'cat_sports', '초경량 티타늄 캠핑 코펠 조리도구 3종 세트', 'https://images.unsplash.com/photo-1510312305653-8ed496efae75?w=500', '<p>내열성 및 파우치 일체형 패키지</p>', 49000, 22800, 2900, 'ACTIVE'),

-- Shoes & Bags
('prod_sb_01', 'pt_001', 'cat_shoes_bags', '방수 옥스포드 16인치 노트북 대용량 비즈니스 백팩', 'https://images.unsplash.com/photo-1553062407-98eeb64c6a62?w=500', '<p>USB 충전포트 및 도난 방지 포켓</p>', 65000, 26900, 8900, 'ACTIVE'),
('prod_sb_02', 'pt_001', 'cat_shoes_bags', '쿠셔닝 경량 메쉬 데일리 통기성 런닝화', 'https://images.unsplash.com/photo-1542291026-7eec264c27ff?w=500', '<p>충격 흡수 인솔 및 미끄럼 방지 아웃솔</p>', 58000, 24900, 11400, 'ACTIVE'),

-- Toys & Games
('prod_t_01', 'pt_001', 'cat_toys', '정밀 디테일 슈퍼카 기계공학 조립 블록 1200피스', 'https://images.unsplash.com/photo-1585366119957-e9730b6d0f60?w=500', '<p>실제 구동 가능한 엔진 및 서스펜션</p>', 75000, 31500, 3100, 'ACTIVE'),

-- Automotive
('prod_a_01', 'pt_001', 'cat_auto', '차량용 맥세이프 15W 고속 무선충전 송풍구 거치대', 'https://images.unsplash.com/photo-1580910051074-3eb694886505?w=500', '<p>강력한 네오디뮴 자석 및 360도 회전</p>', 29000, 14900, 14500, 'ACTIVE'),

-- Jewelry & Watches
('prod_j_01', 'pt_001', 'cat_jewelry', '밀레니즈 루프 마그네틱 메탈 스마트워치 스트랩', 'https://images.unsplash.com/photo-1524805444758-089113d48a6d?w=500', '<p>애플워치/갤럭시워치 전 기종 호환</p>', 22000, 8900, 19200, 'ACTIVE');

