-- migrations/d1_30_remove_seeded_reviews_and_sales.sql
-- Removes customer-facing figures that were never produced by real buyers (PHASE 2 finding P2-F01/P2-F02).
--
-- 1. Reviews. d1_10 / d1_11 inserted 10 invented reviews (rev_001..rev_010) under made-up masked names, and an
--    earlier version of POST /products/:id/reviews (before the purchase check) stored 7 more, all from the seed
--    account u_customer_001, all flagged is_verified_purchase = 1 without an order. The current API only accepts a
--    review tied to the reviewer's own delivered order (order_id is always set), so every row that is not linked to
--    an order of the same customer is, by construction, not a purchase review.
DELETE FROM product_reviews
WHERE NOT EXISTS (
  SELECT 1 FROM orders o WHERE o.id = product_reviews.order_id AND o.customer_id = product_reviews.user_id
);

-- 2. Sold counts. d1_02 / d1_04 / d1_05 / d1_11 seeded total_sold_count with invented numbers (e.g. 19,200), which
--    the storefront shows as "N개 판매", ranks best-sellers by, and sums into the seller store total.
--    The live counter moves in lock-step with the inventory ledger (services/orders.js):
--      +qty  PURCHASE_DEDUCT  (order created)
--      -qty  ORDER_CANCEL     (unpaid order released / cancelled with restock)
--      -qty  RETURN_RESTOCK   (refund with restock)
--    No migration seeds inventory_ledger, so recomputing from it yields only real activity.
UPDATE products
SET total_sold_count = MAX(0, COALESCE((
  SELECT -SUM(l.quantity_delta)
  FROM inventory_ledger l
  JOIN product_skus s ON s.id = l.sku_id
  WHERE s.product_id = products.id
    AND l.change_type IN ('PURCHASE_DEDUCT', 'ORDER_CANCEL', 'RETURN_RESTOCK')
), 0));
