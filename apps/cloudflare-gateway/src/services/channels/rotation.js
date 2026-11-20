// apps/cloudflare-gateway/src/services/channels/rotation.js
// 30-day idle rotation batch: LIVE channel listings with no sale for 30 days
// (or never sold within 30 days of listing) move to ROTATED_OUT. Operators
// re-publish deliberately — rotation never deletes listings or products.
//
// Rotation is a local status move; the platform-side delist (adapter retire)
// runs separately per listing so one platform outage cannot block the batch.

export const ROTATION_IDLE_DAYS = 30;
export const ROTATION_BATCH = 500;

/** UTC 'YYYY-MM-DD HH:MM:SS' N days before now (lexicographic compare). */
export function cutoffUtc(days, nowMs = Date.now()) {
  return new Date(nowMs - days * 86400 * 1000).toISOString().slice(0, 19).replace('T', ' ');
}

/** LIVE ids idle since the cutoff, oldest first (bounded for ops safety). */
export async function findIdleListings(env, cutoff, limit = ROTATION_BATCH) {
  const cap = Math.min(1000, Math.max(1, Number(limit) || ROTATION_BATCH));
  const { results } = await env.DB.prepare(
    `SELECT id FROM sourcing_channel_listings
     WHERE status = 'LIVE' AND COALESCE(last_sale_at, created_at) < ?
     ORDER BY COALESCE(last_sale_at, created_at) ASC LIMIT ?`
  ).bind(cutoff, cap).all();
  return (results || []).map((r) => r.id);
}

/** Move ids to ROTATED_OUT; returns the rows actually moved (re-run safe). */
export async function markRotatedOut(env, ids) {
  if (!ids.length) return 0;
  const placeholders = ids.map(() => '?').join(',');
  const res = await env.DB.prepare(
    `UPDATE sourcing_channel_listings SET status = 'ROTATED_OUT', updated_at = CURRENT_TIMESTAMP
     WHERE id IN (${placeholders}) AND status = 'LIVE'`
  ).bind(...ids).run();
  return Number(res.meta?.changes || 0);
}

/**
 * Run one rotation pass. dryRun reports without writing. Returns
 * { scanned, rotated, ids, cutoff, dry_run }.
 */
export async function runRotation(env, { nowMs = Date.now(), dryRun = false, limit = ROTATION_BATCH } = {}) {
  const cutoff = cutoffUtc(ROTATION_IDLE_DAYS, nowMs);
  const ids = await findIdleListings(env, cutoff, limit);
  const scannedRow = await env.DB.prepare(
    "SELECT COUNT(*) AS c FROM sourcing_channel_listings WHERE status = 'LIVE'"
  ).first();
  const scanned = Number(scannedRow?.c || 0);
  if (dryRun || !ids.length) {
    return { scanned, rotated: 0, ids: dryRun ? ids : [], cutoff, dry_run: dryRun };
  }
  return { scanned, rotated: await markRotatedOut(env, ids), ids, cutoff, dry_run: false };
}
