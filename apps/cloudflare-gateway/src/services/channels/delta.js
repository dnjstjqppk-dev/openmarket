// apps/cloudflare-gateway/src/services/channels/delta.js
// 15-minute Delta sync worker: LIVE listings whose synced_at is older than
// 15 minutes (or never synced) get a live stock push via their channel
// adapter. Stateless — the watermark is synced_at itself, no extra table.
//
// Zero-Mock: without channel keys each listing reports failed with
// CHANNEL_NOT_CONFIGURED and keeps its old synced_at; the worker never
// marks unsynced rows as synced and one listing's failure never aborts
// the batch.

import { getChannel, ChannelConfigError } from './channel.js';

export const DELTA_INTERVAL_MIN = 15;
export const DELTA_BATCH = 100;

export function deltaCutoffUtc(nowMs = Date.now()) {
  return new Date(nowMs - DELTA_INTERVAL_MIN * 60 * 1000).toISOString().slice(0, 19).replace('T', ' ');
}

/**
 * Run one delta pass. Returns { window_min, checked, synced, failed, cutoff }.
 * failed entries carry { id, channel, code } for the ops console.
 */
export async function runDeltaSync(env, { nowMs = Date.now(), limit = DELTA_BATCH } = {}) {
  const cutoff = deltaCutoffUtc(nowMs);
  const cap = Math.min(500, Math.max(1, Number(limit) || DELTA_BATCH));
  const { results } = await env.DB.prepare(
    `SELECT cl.id, cl.channel, cl.external_listing_id, o.stock_qty
     FROM sourcing_channel_listings cl JOIN sourcing_offers o ON o.id = cl.offer_id
     WHERE cl.status = 'LIVE' AND (cl.synced_at IS NULL OR cl.synced_at < ?)
     ORDER BY cl.synced_at ASC NULLS FIRST LIMIT ?`
  ).bind(cutoff, cap).all();
  const rows = results || [];
  let synced = 0;
  const failed = [];
  for (const row of rows) {
    try {
      if (!row.external_listing_id) throw new Error('LISTING_NOT_PUBLISHED');
      const adapter = getChannel(row.channel);
      await adapter.updateStock(env, row.external_listing_id, Number(row.stock_qty || 0));
      await env.DB.prepare(
        'UPDATE sourcing_channel_listings SET synced_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
      ).bind(row.id).run();
      synced += 1;
    } catch (e) {
      const code = e instanceof ChannelConfigError ? 'CHANNEL_NOT_CONFIGURED'
        : String(e?.message || '').startsWith('CHANNEL_RATELIMIT') ? 'CHANNEL_RATELIMIT'
        : String(e?.message || '').startsWith('LISTING_NOT_PUBLISHED') ? 'LISTING_NOT_PUBLISHED'
        : 'UPSTREAM_ERROR';
      failed.push({ id: row.id, channel: row.channel, code });
    }
  }
  return { window_min: DELTA_INTERVAL_MIN, checked: rows.length, synced, failed, cutoff };
}
