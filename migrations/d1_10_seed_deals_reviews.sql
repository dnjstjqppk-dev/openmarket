-- migrations/d1_10_seed_deals_reviews.sql
-- Seed Autocomplete Keywords, Synonyms, Flash Sale Campaigns, Reviews & Coupons

-- 1. Search Keywords & Chosung
INSERT OR IGNORE INTO search_keywords (id, keyword, normalized_keyword, chosung, category_name, category_slug, search_count, product_hit_count, is_promoted) VALUES
('kw_01', '무선 이어폰', '무선 이어폰', 'ㅁㅅ ㅇㅇㅍ', '음향기기', 'audio-video', 1540, 12, 1),
('kw_02', '노이즈캔슬링 헤드폰', '노이즈캔슬링 헤드폰', 'ㄴㅇㅈㅋㅅㄹ ㅎㄷㅍ', '음향기기', 'audio-video', 1230, 8, 1),
('kw_03', '보조배터리 20000mAh', '보조배터리 20000mah', 'ㅂㅈㅂㅌㄹ', '모바일 & 스마트폰', 'cellphones-accessories', 980, 15, 1),
('kw_04', '맥세이프 고속 충전기', '맥세이프 고속 충전기', 'ㅁㅅㅇㅍ ㄱㅅ ㅊㅈㄱ', '모바일 & 스마트폰', 'cellphones-accessories', 870, 9, 0),
('kw_05', '초경량 바람막이 자켓', '초경량 바람막이 자켓', 'ㅊㄱㄹ ㅂㄹㅁㅇ ㅈㅋ', '남성 패션', 'mens-fashion', 1420, 24, 1),
('kw_06', '오버핏 기모 후드티', '오버핏 기모 후드티', 'ㅇㅂㅍ ㄱㅁ ㅎㄷㅌ', '남성의류', 'mens-clothing', 1150, 18, 0),
('kw_07', '플리츠 롱 원피스', '플리츠 롱 원피스', 'ㅍㄹㅊ ㄹ ㅇㅍㅅ', '여성의류', 'womens-clothing', 1680, 32, 1),
('kw_08', '빅사이즈 와이드 팬츠', '빅사이즈 와이드 팬츠', 'ㅂㅅㅇㅈ ㅇㅇㄷ ㅍㅊ', '여성 빅사이즈/플러스 패션', 'womens-curve-clothing', 760, 14, 0),
('kw_09', '무봉제 심리스 브라', '무봉제 심리스 브라', 'ㅁㅂㅈ ㅅㄹㅅ ㅂㄹ', '여성 언더웨어 & 라운지웨어', 'womens-lingerie-lounge', 920, 11, 0),
('kw_10', '쿠션 러닝화 운동화', '쿠션 러닝화 운동화', 'ㅋㅅ ㄹㄴㅎ ㅇㄷㅎ', '남성 신발', 'mens-shoes', 1340, 20, 1),
('kw_11', '초경량 에어 스니커즈', '초경량 에어 스니커즈', 'ㅊㄱㄹ ㅇㅇ ㅅㄴㅋㅈ', '여성 신발', 'womens-shoes', 1110, 17, 0),
('kw_12', '가죽 크로스백', '가죽 크로스백', 'ㄱㅈ ㅋㄹㅅㅂ', '가방 & 캐리어', 'bags-luggage', 840, 16, 0),
('kw_13', '기계식 게이밍 키보드', '기계식 게이밍 키보드', 'ㄱㄱㅅ ㄱㅇㅁ ㅋㅂㄷ', '게이밍 & 콘솔', 'video-games-gaming', 1290, 14, 1),
('kw_14', '로봇청소기 물걸레', '로봇청소기 물걸레', 'ㄹㅂㅊㅅㄱ ㅁㄱㄹ', '가전 & 생활기기', 'home-appliances', 1490, 10, 1),
('kw_15', '스마트워치 울트라', '스마트워치 울트라', 'ㅅㅁㅌㅇㅊ ㅇㅌㄹ', '시계 & 워치웨어', 'watches-wearables', 1620, 22, 1),
('kw_16', '호텔식 차렵이불 세트', '호텔식 차렵이불 세트', 'ㅎㅌㅅ ㅊㄹㅇㅂ ㅅㅌ', '침구 & 패브릭', 'bedding-bath', 710, 8, 0),
('kw_17', '마사지건 무선 전동', '마사지건 무선 전동', 'ㅁㅅㅈㄱ ㅁㅅ ㅈㄷ', '헬스 & 건강용품', 'health-fitness', 890, 12, 0),
('kw_18', '캠핑용 접이식 테이블', '캠핑용 접이식 테이블', 'ㅋㅍㅇ ㅈㅇㅅ ㅌㅇㅂ', '스포츠/아웃도어', 'sports-outdoors', 940, 15, 0),
('kw_19', '충전식 무선 전동드릴', '충전식 무선 전동드릴', 'ㅊㅈㅅ ㅁㅅ ㅈㄷㄷㄹ', '공구 & DIY자재', 'tools-home-improvement', 650, 9, 0),
('kw_20', '강아지 하네스 자동줄', '강아지 하네스 자동줄', 'ㄱㅇㅈ ㅎㄴㅅ ㅈㄷㅈ', '반려동물 용품', 'pet-supplies', 830, 13, 0);

-- 2. Search Synonyms
INSERT OR IGNORE INTO search_synonyms (id, term, canonical_keyword) VALUES
('syn_01', '이어폰', '무선 이어폰'),
('syn_02', '헤드폰', '노이즈캔슬링 헤드폰'),
('syn_03', 'earphone', '무선 이어폰'),
('syn_04', 'headphone', '노이즈캔슬링 헤드폰'),
('syn_05', '원피스', '플리츠 롱 원피스'),
('syn_06', 'dress', '플리츠 롱 원피스'),
('syn_07', '보조배터리', '보조배터리 20000mAh'),
('syn_08', '충전기', '맥세이프 고속 충전기'),
('syn_09', 'charger', '맥세이프 고속 충전기'),
('syn_10', '청소기', '로봇청소기 물걸레'),
('syn_11', '운동화', '쿠션 러닝화 운동화'),
('syn_12', '스니커즈', '초경량 에어 스니커즈'),
('syn_13', 'shoes', '쿠션 러닝화 운동화'),
('syn_14', '키보드', '기계식 게이밍 키보드'),
('syn_15', '스마트워치', '스마트워치 울트라');

-- 3. Flash Sale Campaigns & Items
INSERT OR IGNORE INTO flash_sale_campaigns (id, title, banner_url, starts_at, ends_at, status) VALUES
('fls_today', '⚡ OLMOA 오늘의 번개특가 한정 수량 대방출', 'https://images.unsplash.com/photo-1607082348824-0a96f2a4b9da?w=1200', datetime('now', '-2 hours'), datetime('now', '+10 hours'), 'ACTIVE');

INSERT OR IGNORE INTO flash_sale_items (id, campaign_id, product_id, sku_id, deal_price, discount_rate, allocated_stock, sold_stock, sort_order) VALUES
('fls_it_01', 'fls_today', 'prod_001', 'sku_001_w', 39900, 69, 100, 84, 1),
('fls_it_02', 'fls_today', 'prod_002', 'sku_002_65w', 18900, 58, 200, 172, 2),
('fls_it_03', 'fls_today', 'prod_003', 'sku_003_set', 12900, 63, 150, 119, 3);

-- 4. Real Product Reviews
INSERT OR IGNORE INTO product_reviews (id, product_id, user_id, reviewer_name, sku_option_summary, rating, content, images_json, helpful_count, is_verified_purchase, created_at) VALUES
('rev_001', 'prod_001', 'u_customer_001', '김*수', 'White / 기본', 5.0, '음질이 기대 이상으로 훌륭합니다. 노이즈 캔슬링 켜면 지하철 소음이 거의 다 차단되네요. 가성비 최고입니다!', '["https://images.unsplash.com/photo-1590658268037-6bf12165a8df?w=300"]', 24, 1, datetime('now', '-3 days')),
('rev_002', 'prod_001', 'u_customer_001', '이*진', 'Black / 기본', 4.8, '배송도 3일 만에 도착했고 연결도 매끄럽습니다. 귀가 아프지 않아서 오래 착용하기 좋습니다.', '[]', 18, 1, datetime('now', '-5 days')),
('rev_003', 'prod_001', 'u_customer_001', 'Park S.H.', 'White / 기본', 4.9, '올모아에서 첫 구매인데 테무보다 배송 빠르고 포장도 튼튼하게 왔어요. 재구매 의사 100%입니다.', '[]', 9, 1, datetime('now', '-8 days')),
('rev_004', 'prod_002', 'u_customer_001', '최*영', 'Black / L (100)', 4.9, '원단이 짱짱하고 방수도 잘 됩니다. 가볍고 핏이 예뻐서 등산갈 때 잘 입고 있어요.', '["https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=300"]', 14, 1, datetime('now', '-2 days')),
('rev_005', 'prod_003', 'u_customer_001', '정*훈', 'White / 20000mAh', 5.0, '출퇴근할 때 폰 두 번 완충하고도 배터리 남네요. 고속충전 지원해서 정말 편합니다.', '[]', 31, 1, datetime('now', '-4 days'));

-- 5. Coupons & User Credits
INSERT OR IGNORE INTO coupons (id, code, title, discount_type, discount_value, min_order_amount, max_discount_amount, expires_at, is_active) VALUES
('cpn_welcome', 'WELCOME10', '신규회원 첫구매 10% 웰컴쿠폰', 'PERCENT', 10, 20000, 10000, datetime('now', '+30 days'), 1),
('cpn_3000', 'OLMOA3000', '전고객 ₩3,000 즉시할인 쿠폰', 'FIXED_AMOUNT', 3000, 30000, 3000, datetime('now', '+15 days'), 1),
('cpn_vip', 'VIP20', 'VIP 회원 특별 20% 할인쿠폰', 'PERCENT', 20, 50000, 20000, datetime('now', '+60 days'), 1);

INSERT OR IGNORE INTO user_coupons (id, user_id, coupon_id, is_used) VALUES
('uc_001', 'u_customer_001', 'cpn_welcome', 0),
('uc_002', 'u_customer_001', 'cpn_3000', 0);

INSERT OR IGNORE INTO user_credits (id, user_id, amount_delta, balance_after, reason, reference_id) VALUES
('crd_001', 'u_customer_001', 5000, 5000, '신규회원 가입 축하 적립금', 'SIGNUP_BONUS');
