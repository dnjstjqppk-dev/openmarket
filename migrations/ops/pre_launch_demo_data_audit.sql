-- migrations/ops/pre_launch_demo_data_audit.sql
-- READ-ONLY audit of demo/fabricated data shipped by d1_02..d1_19 that must not be shown to real customers.
-- Run (read-only): wrangler d1 execute openmarket-db --remote --file migrations/ops/pre_launch_demo_data_audit.sql
--   (requires owner approval because it targets production; it performs SELECTs only)
-- Purging is a business decision (catalog, sellers and reviews must be replaced with real data) and is
-- intentionally NOT automated here.

SELECT 'users_with_unverifiable_seed_hash' AS item, COUNT(*) AS n FROM users WHERE password_hash NOT LIKE 'pbkdf2:%';
SELECT 'seed_reviews_not_linked_to_orders' AS item, COUNT(*) AS n FROM product_reviews WHERE order_id IS NULL;
SELECT 'products_with_seeded_sold_counts' AS item, COUNT(*) AS n FROM products p
  WHERE p.total_sold_count > COALESCE((SELECT SUM(i.quantity - i.refunded_quantity) FROM order_items i WHERE i.product_id = p.id), 0);
SELECT 'products_using_stock_photo_hotlinks' AS item, COUNT(*) AS n FROM products WHERE thumbnail_url LIKE 'https://images.unsplash.com/%';
SELECT 'demo_partners_without_verified_payout_account' AS item, COUNT(*) AS n FROM partners WHERE payout_account_verified = 0;
SELECT 'seed_qna_and_inquiries' AS item, (SELECT COUNT(*) FROM product_qna) + (SELECT COUNT(*) FROM support_inquiries) AS n;
SELECT 'banners_with_unverified_claims' AS item, COUNT(*) AS n FROM banners WHERE subtitle LIKE '%85%' OR title LIKE '%최저가%';
SELECT 'operator_entity_active' AS item, COUNT(*) AS n FROM business_entities WHERE status = 'ACTIVE';
