-- d1_37_honest_seed_copy.sql
-- P2R-02: the d1_12 seed banners/notifications carried claims the platform does
-- not honour (flagged by migrations/ops/pre_launch_demo_data_audit.sql):
--   * "최저가 도전 / 최대 85%" — no lowest-price guarantee, no 85% tier exists
--   * "무조건 무료배송" — shipping fees/thresholds are set per seller
--   * "100,000원 쿠폰팩 / 첫 구매 20%" — the real welcome credit is 10,000원
--   * "90일 무료반품" — the return window is 7 days (RETURN_WINDOW_DAYS_DEFAULT)
-- d1_12 already applied everywhere, so this migration UPDATEs the rows by id.
-- Copy-only change: no schema, no backfill, safe to apply on top of anything.
UPDATE banners SET subtitle = '전 세계 판매자 직발송 특가 모음' WHERE id = 'bnr_001';
UPDATE banners
SET title = '판매자별 무료배송 혜택',
    subtitle = '주문서에서 판매자별 배송비 확인 + 30일 판매가 인하 차액 적립'
WHERE id = 'bnr_002';
UPDATE banners
SET title = '신규회원 10,000원 웰컴 적립금',
    subtitle = '가입 즉시 10,000원 적립금 지급'
WHERE id = 'bnr_003';
UPDATE notifications
SET message = '관심 카테고리 [디지털 가전] 특가가 오픈되었습니다. 한정 수량 특가를 놓치지 마세요!'
WHERE id = 'noti_002';
UPDATE notifications
SET title = '🛡️ 7일 이내 반품 신청 안내',
    message = '올모아 상품은 수령 후 7일 이내에 반품을 신청할 수 있습니다.'
WHERE id = 'noti_003';
