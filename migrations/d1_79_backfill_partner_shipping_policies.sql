-- d1_79_backfill_partner_shipping_policies.sql
-- Owner request 2026-11-28: products listed before 6-11 (decision 19) have no
-- shipping_policy_id, so the fail-closed sale gate (sellableSql) hides them from
-- the storefront. This registers ONE default shipping policy per seller that
-- still has unassigned products and assigns it to those products.
--
-- The fee values are the seller's own registered settings on `partners`
-- (base_shipping_fee, free_shipping_threshold, return_shipping_fee,
-- return_shipping_address) — no code-side fee defaults (decision 19):
--   fee_type    base 0 -> FREE; threshold > 0 -> CONDITIONAL; else PAID
--   return_fee  return_shipping_fee, else base_shipping_fee — the same one-way
--               fee services/claims.js partnerReturnFees() actually withholds
--   exchange_fee  return_fee + base_shipping_fee (send-back + re-send), the
--               round trip claims.js charges for a full customer-fault return
--   processing_days 3 — Korean open-market default dispatch deadline
--               (3 business days); sellers have no prior value to carry over
--   today_cutoff / remote_surcharge / carrier NULL — never claim 오늘출발 or a
--               surcharge the seller did not register
-- Sellers can edit or replace the policy in the partner console at any time.
--
-- Data only, rerun-safe: deterministic ids + INSERT OR IGNORE; a seller that
-- already has an ACTIVE policy gets no new one; only NULL/dangling/inactive
-- shipping_policy_id rows are updated, and only to a policy of the same seller.

INSERT OR IGNORE INTO shipping_policies (
  id, partner_id, name, method, carrier_code, fee_type, base_fee, free_threshold, qty_unit,
  remote_surcharge, return_fee, exchange_fee, processing_days, today_cutoff,
  origin_address, return_address, is_default, status
)
SELECT
  'sp_d179_' || pt.id,
  pt.id,
  '기본 배송정책',
  'PARCEL',
  NULL,
  CASE
    WHEN COALESCE(pt.base_shipping_fee, 0) = 0 THEN 'FREE'
    WHEN COALESCE(pt.free_shipping_threshold, 0) > 0 THEN 'CONDITIONAL'
    ELSE 'PAID'
  END,
  COALESCE(pt.base_shipping_fee, 0),
  CASE
    WHEN COALESCE(pt.base_shipping_fee, 0) > 0 AND COALESCE(pt.free_shipping_threshold, 0) > 0
      THEN pt.free_shipping_threshold
    ELSE NULL
  END,
  NULL,
  NULL,
  COALESCE(pt.return_shipping_fee, pt.base_shipping_fee, 0),
  COALESCE(pt.return_shipping_fee, pt.base_shipping_fee, 0) + COALESCE(pt.base_shipping_fee, 0),
  3,
  NULL,
  NULL,
  NULLIF(TRIM(COALESCE(pt.return_shipping_address, '')), ''),
  -- uq_shipping_policies_default spans INACTIVE rows too: never collide with one.
  CASE WHEN EXISTS (SELECT 1 FROM shipping_policies d WHERE d.partner_id = pt.id AND d.is_default = 1) THEN 0 ELSE 1 END,
  'ACTIVE'
FROM partners pt
WHERE EXISTS (
    SELECT 1 FROM products p
    WHERE p.partner_id = pt.id
      AND NOT EXISTS (
        SELECT 1 FROM shipping_policies sp
        WHERE sp.id = p.shipping_policy_id AND sp.status = 'ACTIVE'
      )
  )
  AND NOT EXISTS (
    SELECT 1 FROM shipping_policies sp
    WHERE sp.partner_id = pt.id AND sp.status = 'ACTIVE'
  );

-- Unassigned products get this migration's policy, or else the seller's own
-- ACTIVE default (a seller who already registered one keeps their choice).
UPDATE products
SET shipping_policy_id = (
      SELECT sp.id FROM shipping_policies sp
      WHERE sp.partner_id = products.partner_id AND sp.status = 'ACTIVE'
        AND (sp.id = 'sp_d179_' || products.partner_id OR sp.is_default = 1)
      ORDER BY (sp.id = 'sp_d179_' || products.partner_id) DESC
      LIMIT 1
    ),
    updated_at = CURRENT_TIMESTAMP
WHERE NOT EXISTS (
    SELECT 1 FROM shipping_policies sp
    WHERE sp.id = products.shipping_policy_id AND sp.status = 'ACTIVE'
  )
  AND EXISTS (
    SELECT 1 FROM shipping_policies sp
    WHERE sp.partner_id = products.partner_id AND sp.status = 'ACTIVE'
      AND (sp.id = 'sp_d179_' || products.partner_id OR sp.is_default = 1)
  );

INSERT OR IGNORE INTO schema_migrations (version, applied_at)
VALUES ('d1_79_backfill_partner_shipping_policies.sql', CURRENT_TIMESTAMP);
