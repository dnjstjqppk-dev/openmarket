// apps/cloudflare-gateway/src/services/fulfillment/poll.js
// Channel order polling: pulls recently-paid orders from smartstore/coupang
// via live adapter calls and upserts them into the unified intake.
// Zero-Mock: without channel keys the channel reports failed with
// CHANNEL_NOT_CONFIGURED and contributes zero rows ??polls never invent.

import { getChannel, ChannelConfigError } from '../channels/channel.js';
import { upsertChannelOrder } from './intake.js';

export const POLL_CHANNELS = ['smartstore', 'coupang'];
export const POLL_BATCH = 50;

/** Poll one channel; returns { channel, checked, created, failed }. */
export async function pollChannel(env, channel, { limit = POLL_BATCH } = {}) {
  const cap = Math.min(200, Math.max(1, Number(limit) || POLL_BATCH));
  const adapter = getChannel(channel);
  let live;
  try {
    live = await adapter.fetchPaidOrders(env, {});
  } catch (e) {
    if (e instanceof ChannelConfigError) return { channel, checked: 0, created: 0, failed: { code: 'CHANNEL_NOT_CONFIGURED' } };
    if (typeof adapter.fetchPaidOrders !== 'function') return { channel, checked: 0, created: 0, failed: { code: 'CHANNEL_API_PENDING' } };
    const code = String(e?.message || '').startsWith('CHANNEL_RATELIMIT') ? 'CHANNEL_RATELIMIT' : 'UPSTREAM_ERROR';
    return { channel, checked: 0, created: 0, failed: { code } };
  }
  let created = 0;
  for (const raw of (Array.isArray(live) ? live : []).slice(0, cap)) {
    try {
      const r = await upsertChannelOrder(env, channel, { ...raw, paid: true });
      if (r.created) created += 1;
    } catch { /* one malformed platform row never aborts the poll */ }
  }
  return { channel, checked: Array.isArray(live) ? Math.min(live.length, cap) : 0, created, failed: null };
}

/** Poll every channel (or one); per-channel failures never abort the batch. */
export async function runChannelPoll(env, { channel, limit } = {}) {
  const targets = channel ? [channel] : POLL_CHANNELS;
  for (const name of targets) getChannel(name); // CHANNEL_UNKNOWN on typos
  let checked = 0;
  let created = 0;
  const failed = [];
  for (const name of targets) {
    const r = await pollChannel(env, name, { limit });
    checked += r.checked;
    created += r.created;
    if (r.failed) failed.push({ channel: name, code: r.failed.code });
  }
  return { checked, created, failed };
}
