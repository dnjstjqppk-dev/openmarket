-- d1_43_p1_fund_abuse_guards.sql
-- NEW-P0-01 / NEW-P0-02: race-safe credit grants.
-- A concurrent double-approve (two admins) or double-verify (two requests) must not
-- double-pay. Guards in code SELECT-then-INSERT, which races; this index makes the
-- losing batch fail UNIQUE so it maps to a 409 instead of a second payout.
-- Composite (user_id, reference_id): legacy rows reuse bare references across users
-- (e.g. 'WELCOME_BONUS'), so a global UNIQUE(reference_id) would break the migration
-- on real data. All new money references are unique per user (welcome:<userId>,
-- priceadj:<claimId>), so the composite still blocks every double-grant.
CREATE UNIQUE INDEX IF NOT EXISTS ux_user_credits_user_reference
  ON user_credits(user_id, reference_id) WHERE reference_id IS NOT NULL;

-- The 24h price-hold clock (NEW-P0-01). product_skus.updated_at is polluted by
-- stock moves, so price stability needs its own timestamp, maintained ONLY by
-- price-changing writes (partner price PUT; T06 per-SKU split must preserve this).
-- Pre-existing and newly inserted rows default to an ancient stamp: a drop still
-- requires a price PUT, which always stamps now, so the default is safe.
ALTER TABLE product_skus ADD COLUMN price_updated_at TEXT NOT NULL DEFAULT '2000-01-01 00:00:00';
