-- d1_38_payout_idempotency.sql
-- POST /admin/finance/payouts had no X-Idempotency-Key: a retried click after a
-- timeout could not safely replay. Stores the key (partial UNIQUE: one row per
-- key, NULLs unlimited) plus the two computed response fields so a replay
-- returns the byte-identical payload instead of recomputing from moved state.
-- Additive only: safe to apply on top of every earlier migration.
ALTER TABLE payouts ADD COLUMN idempotency_key TEXT;
ALTER TABLE payouts ADD COLUMN reserve_release_days INTEGER;
ALTER TABLE payouts ADD COLUMN other_entities_pending INTEGER NOT NULL DEFAULT 0;
CREATE UNIQUE INDEX IF NOT EXISTS ux_payouts_idem ON payouts(idempotency_key) WHERE idempotency_key IS NOT NULL;
