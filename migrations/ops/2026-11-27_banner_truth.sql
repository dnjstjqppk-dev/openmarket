-- migrations/ops/2026-11-27_banner_truth.sql
-- Production data fix (NOT a numbered migration: no schema change, no REQUIRED_SCHEMA_VERSION bump).
-- Found by the 2026-11-27 UI/UX QA (reports/UIUX_FULL_QA_2026-11-27.md). Two live HOME_HERO banners advertise
-- things the platform no longer does:
--   bnr_002 "…30일 판매가 인하 차액 적립" — the price-protection program was removed by owner decision 2026-11-17;
--            "판매자별 무료배송 혜택" + badge FREE SHIPPING is the blanket free-shipping copy decision-19 forbids.
--   bnr_003 "가입 즉시 10,000원 적립금 지급" — signup grants 0 (NEW-P0-02: the credit is granted on email
--            verification) and production email delivery is NOT_INTEGRATED, so nobody can receive it today.
--            Its image (unsplash photo-1556742049-0a67c5574f73) also returns 404.
-- Fix: deactivate both (rows kept; an operator can edit the copy in 관리자 > 마케팅 > 배너 and re-enable).
-- Equivalent without SQL: 관리자 콘솔 > 마케팅 > 배너 > 두 배너 "비활성".
--
-- Apply (owner approval required — production):
--   npx wrangler d1 execute openmarket-db --remote --config apps/cloudflare-gateway/wrangler.jsonc \
--     --file migrations/ops/2026-11-27_banner_truth.sql
-- Rollback:
--   UPDATE banners SET is_active = 1 WHERE id IN ('bnr_002', 'bnr_003');

UPDATE banners SET is_active = 0 WHERE id IN ('bnr_002', 'bnr_003') AND is_active = 1;
SELECT id, title, is_active FROM banners WHERE position = 'HOME_HERO' ORDER BY display_order;
