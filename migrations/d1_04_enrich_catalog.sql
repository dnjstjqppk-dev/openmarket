-- D1 Migration 04: Further Catalog Enrichment for Full Category Experience

INSERT OR IGNORE INTO products (id, partner_id, category_id, title, thumbnail_url, description_html, lowest_original_price, lowest_sale_price, total_sold_count, status) VALUES
-- Toys & Games
('prod_t_02', 'pt_001', 'cat_toys', '2.4GHz 무선 4WD 고속 드리프트 RC 레이싱카 LED 라이트 포함', 'https://images.unsplash.com/photo-1594787318286-3d835c1d207f?w=500', '<p>교체형 드리프트 타이어 및 고속 모터 탑재</p>', 62000, 27900, 4300, 'ACTIVE'),

-- Automotive
('prod_a_02', 'pt_001', 'cat_auto', '차량용 초강력 9000Pa 무선 핸디 청소기 (블로워 겸용)', 'https://images.unsplash.com/photo-1520340356584-f9917d1eea6f?w=500', '<p>HEPA 필터 물세척 가능, C타입 고속 충전</p>', 48000, 19800, 8900, 'ACTIVE'),
('prod_a_03', 'pt_001', 'cat_auto', '프리미엄 알루미늄 메탈 차량용 통풍구 디퓨저 방향제 세트', 'https://images.unsplash.com/photo-1541899481282-d53bffe3c35d?w=500', '<p>천연 에센셜 오일 고체 리필 4개 동봉</p>', 25000, 12500, 11200, 'ACTIVE'),

-- Jewelry & Watches
('prod_j_02', 'pt_001', 'cat_jewelry', '925 실버 심플 데일리 레이어드 체인 목걸이', 'https://images.unsplash.com/photo-1599643478518-a784e5dc4c8f?w=500', '<p>변색 방지 알러지 프리 로듐 도금 마감</p>', 35000, 15900, 5200, 'ACTIVE'),
('prod_j_03', 'pt_001', 'cat_jewelry', '클래식 미니멀 천연 소가죽 아날로그 쿼츠 손목시계', 'https://images.unsplash.com/photo-1522335789203-aabd1fc54bc9?w=500', '<p>30m 생활방수 및 스크래치 방지 사파이어 글라스</p>', 68000, 27500, 3600, 'ACTIVE'),

-- Women's Clothing
('prod_w_03', 'pt_001', 'cat_women', '캐시미어 블렌드 소프트 라운드넥 니트 가디건 (8컬러)', 'https://images.unsplash.com/photo-1434389677669-e08b4cac3105?w=500', '<p>따뜻하고 보드라운 프리미엄 울 혼방</p>', 49000, 21900, 7400, 'ACTIVE'),

-- Men's Clothing
('prod_m_03', 'pt_001', 'cat_men', '방풍 발수 아웃도어 테크웨어 윈드브레이커 후드 자켓', 'https://images.unsplash.com/photo-1544441893-675973e31985?w=500', '<p>생활 방수 및 YKK 방수 지퍼 적용</p>', 79000, 34900, 4800, 'ACTIVE'),

-- Home & Kitchen
('prod_h_03', 'pt_001', 'cat_home', '304 스테인리스 원터치 진공 보온보냉 텀블러 750ml', 'https://images.unsplash.com/photo-1514432324607-a09d9b4aefdd?w=500', '<p>최대 24시간 보냉, 스트로우 및 손잡이 일체형</p>', 32000, 14900, 9300, 'ACTIVE');

