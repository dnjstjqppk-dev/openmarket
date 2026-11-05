-- migrations/d1_32_cancel_settlements_of_cancelled_orders.sql
-- Closes seller settlements that are still payable although their order never was or no longer is (PHASE 2 P2-F04).
--
-- Older cancellation code set sub_orders/orders to CANCELLED without touching settlements (cancelled_at was left NULL),
-- so production kept 6 PENDING settlements for pt_001 (6 x 44,910 = 269,460 KRW, 2026-10-17..20) whose orders and
-- sub-orders are CANCELLED. Current code closes settlements in the same batch (releaseUnpaidOrder, refunds), and the new
-- reconciliation check R23 uses exactly the predicate below, so R23 passing afterwards proves nothing is left.
-- Rows already in a payout are never touched. A second run changes nothing.

INSERT INTO admin_audit_log (id, actor_user_id, actor_role, action, target_type, target_id, before_json, after_json)
SELECT 'aud_d1_32_' || st.id, 'system:migration', 'MIGRATION', 'SETTLEMENT_CANCEL_ORDER_NOT_PAYABLE', 'settlement', st.id,
       json_object('status', st.status, 'net_payout_amount', st.net_payout_amount, 'partner_id', st.partner_id,
                   'sub_order_status', s.status, 'order_payment_status', o.payment_status, 'order_paid_at', o.paid_at),
       json_object('status', 'CANCELLED', 'reason', 'order cancelled/expired or never paid (d1_32)')
FROM settlements st
JOIN sub_orders s ON s.id = st.sub_order_id
JOIN orders o ON o.id = s.parent_order_id
WHERE st.payout_id IS NULL AND (
     (st.status IN ('HOLD', 'PENDING', 'ELIGIBLE_FOR_PAYOUT') AND s.status IN ('CANCELLED', 'EXPIRED'))
  OR (st.status IN ('PENDING', 'ELIGIBLE_FOR_PAYOUT') AND o.paid_at IS NULL));

UPDATE settlements SET status = 'CANCELLED', updated_at = CURRENT_TIMESTAMP
WHERE id IN (
  SELECT st.id FROM settlements st
  JOIN sub_orders s ON s.id = st.sub_order_id
  JOIN orders o ON o.id = s.parent_order_id
  WHERE st.payout_id IS NULL AND (
       (st.status IN ('HOLD', 'PENDING', 'ELIGIBLE_FOR_PAYOUT') AND s.status IN ('CANCELLED', 'EXPIRED'))
    OR (st.status IN ('PENDING', 'ELIGIBLE_FOR_PAYOUT') AND o.paid_at IS NULL)));
