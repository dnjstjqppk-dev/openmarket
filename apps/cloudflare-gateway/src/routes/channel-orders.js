// apps/cloudflare-gateway/src/routes/channel-orders.js
// Phase 3 unified order intake: list the unified_orders table and trigger a
// manual smartstore/coupang poll. Admin only. Polls degrade per channel
// (failed entries) instead of 503ing the whole batch.

import '../services/channels/smartstore-adapter.js';
import '../services/channels/coupang-adapter.js';
import { runChannelPoll, POLL_CHANNELS } from '../services/fulfillment/poll.js';
import { requireAdmin } from '../lib/auth.js';
import { json, readJson, bad } from '../lib/http.js';

export async function handleChannelOrderRoutes(request, url, env, corsHeaders) {
  const p = url.pathname;
  if (!p.startsWith('/api/v1/admin/channel-orders')) return null;
  await requireAdmin(request, env);

  if (p === '/api/v1/admin/channel-orders' && request.method === 'GET') {
    const status = url.searchParams.get('status');
    const perPage = Math.min(100, Math.max(1, Number(url.searchParams.get('per_page')) || 20));
    const args = [];
    let where = '';
    if (status) {
      if (!['NEW', 'PAID', 'ORDERED', 'SHIPPED', 'CANCELLED'].includes(status)) {
        throw bad('INVALID_STATUS', '알 수 없는 주문 상태입니다.');
      }
      where = 'WHERE status = ?';
      args.push(status);
    }
    const { results } = await env.DB.prepare(
      `SELECT id, channel, external_order_id, status, total_krw, provider, paid_at, created_at
       FROM unified_orders ${where} ORDER BY created_at DESC LIMIT ?`
    ).bind(...args, perPage).all();
    return json(corsHeaders, { success: true, data: results || [] });
  }

  if (p === '/api/v1/admin/channel-orders/poll' && request.method === 'POST') {
    const body = await readJson(request);
    const channel = body.channel === undefined || body.channel === null || body.channel === ''
      ? undefined : String(body.channel);
    if (channel !== undefined && !POLL_CHANNELS.includes(channel)) {
      throw bad('CHANNEL_UNKNOWN', '알 수 없는 채널입니다.');
    }
    const result = await runChannelPoll(env, { channel });
    return json(corsHeaders, {
      success: true, checked: result.checked, created: result.created, failed: result.failed
    });
  }

  return null;
}
