-- migrations/d1_31_void_unpaid_orders_marked_paid.sql
-- Voids orders that an earlier version of the checkout marked PAID without any payment (PHASE 2 finding P2-F03).
--
-- A real payment always goes through services/orders.js confirmPayment, which sets paid_at and payment_key in the
-- same statement and records a payment_transactions row. Production has 17 orders (seed account u_customer_001,
-- 2026-10-17..31, 753,320 KRW) with payment_status = 'PAID' but no paid_at, no payment_key and no transaction.
-- They carry 15 PENDING settlements for pt_001 (none in a payout), 15 PURCHASE_DEDUCT stock movements and the
-- last 21 units of products.total_sold_count. No journal entries, coupons, credits, refunds, returns, tax invoices
-- or purchase orders reference them (checked 2026-11-05).
--
-- Every statement selects its rows with the same predicate, and the orders themselves are changed last, so running
-- this file a second time changes nothing. Rollback: reports/v4/phase2/deploy/rollback_d1_31.sql.

-- 1. audit trail: one entry per voided order with its state before the change
INSERT INTO admin_audit_log (id, actor_user_id, actor_role, action, target_type, target_id, before_json, after_json)
SELECT 'aud_d1_31_' || o.id, 'system:migration', 'MIGRATION', 'ORDER_VOID_NO_PAYMENT', 'order', o.id,
       json_object('payment_status', o.payment_status, 'paid_at', o.paid_at, 'payment_key', o.payment_key,
                   'total_pay_amount', o.total_pay_amount, 'customer_id', o.customer_id),
       json_object('payment_status', 'CANCELLED', 'reason', 'marked PAID without any payment record (d1_31)')
FROM orders o
WHERE o.payment_status = 'PAID' AND o.paid_at IS NULL AND o.payment_key IS NULL
  AND NOT EXISTS (SELECT 1 FROM payment_transactions t WHERE t.order_id = o.id);

-- 2. put back exactly the stock that was deducted for these orders (per ledger row; orders without a ledger
--    row had no recorded deduction and get nothing back)
UPDATE product_skus
SET stock_quantity = stock_quantity + (
      SELECT -SUM(l.quantity_delta) FROM inventory_ledger l
      WHERE l.sku_id = product_skus.id AND l.change_type = 'PURCHASE_DEDUCT'
        AND l.reference_id IN (SELECT o.id FROM orders o WHERE o.payment_status = 'PAID' AND o.paid_at IS NULL AND o.payment_key IS NULL
                                 AND NOT EXISTS (SELECT 1 FROM payment_transactions t WHERE t.order_id = o.id))),
    updated_at = CURRENT_TIMESTAMP
WHERE id IN (
  SELECT l.sku_id FROM inventory_ledger l
  WHERE l.change_type = 'PURCHASE_DEDUCT'
    AND l.reference_id IN (SELECT o.id FROM orders o WHERE o.payment_status = 'PAID' AND o.paid_at IS NULL AND o.payment_key IS NULL
                             AND NOT EXISTS (SELECT 1 FROM payment_transactions t WHERE t.order_id = o.id)));

UPDATE product_skus SET status = 'IN_STOCK'
WHERE status = 'OUT_OF_STOCK' AND stock_quantity > 0
  AND id IN (
    SELECT l.sku_id FROM inventory_ledger l
    WHERE l.change_type = 'PURCHASE_DEDUCT'
      AND l.reference_id IN (SELECT o.id FROM orders o WHERE o.payment_status = 'PAID' AND o.paid_at IS NULL AND o.payment_key IS NULL
                               AND NOT EXISTS (SELECT 1 FROM payment_transactions t WHERE t.order_id = o.id)));

-- 3. matching ledger rows (same shape as services/orders.js restockStatements: ORDER_CANCEL, +qty, ref = order id)
INSERT INTO inventory_ledger (id, sku_id, change_type, quantity_delta, balance_after, reference_id, idempotency_key)
SELECT 'ldg_d1_31_' || l.id, l.sku_id, 'ORDER_CANCEL', -l.quantity_delta,
       (SELECT s.stock_quantity FROM product_skus s WHERE s.id = l.sku_id), l.reference_id, 'void_no_payment:' || l.id
FROM inventory_ledger l
WHERE l.change_type = 'PURCHASE_DEDUCT'
  AND l.reference_id IN (SELECT o.id FROM orders o WHERE o.payment_status = 'PAID' AND o.paid_at IS NULL AND o.payment_key IS NULL
                           AND NOT EXISTS (SELECT 1 FROM payment_transactions t WHERE t.order_id = o.id));

-- 4. no payout may ever be made for them
UPDATE settlements SET status = 'CANCELLED', updated_at = CURRENT_TIMESTAMP
WHERE payout_id IS NULL AND status IN ('HOLD', 'PENDING')
  AND sub_order_id IN (
    SELECT s.id FROM sub_orders s JOIN orders o ON o.id = s.parent_order_id
    WHERE o.payment_status = 'PAID' AND o.paid_at IS NULL AND o.payment_key IS NULL
      AND NOT EXISTS (SELECT 1 FROM payment_transactions t WHERE t.order_id = o.id));

-- 5. seller-side orders
UPDATE sub_orders SET status = 'CANCELLED', cancelled_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
WHERE parent_order_id IN (
  SELECT o.id FROM orders o WHERE o.payment_status = 'PAID' AND o.paid_at IS NULL AND o.payment_key IS NULL
    AND NOT EXISTS (SELECT 1 FROM payment_transactions t WHERE t.order_id = o.id));

-- 6. the orders (last: this removes them from the predicate above)
UPDATE orders SET payment_status = 'CANCELLED', cancelled_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
WHERE payment_status = 'PAID' AND paid_at IS NULL AND payment_key IS NULL
  AND NOT EXISTS (SELECT 1 FROM payment_transactions t WHERE t.order_id = orders.id);

-- 7. sold counts follow the ledger again (same rule as d1_30)
UPDATE products
SET total_sold_count = MAX(0, COALESCE((
  SELECT -SUM(l.quantity_delta)
  FROM inventory_ledger l
  JOIN product_skus s ON s.id = l.sku_id
  WHERE s.product_id = products.id
    AND l.change_type IN ('PURCHASE_DEDUCT', 'ORDER_CANCEL', 'RETURN_RESTOCK')
), 0));
