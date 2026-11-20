// apps/cloudflare-gateway/src/routes/fulfillment-ops.js
// Phase 3 fulfillment ops: manual auto-PO dispatch, invoice collection with
// channel push-back, and the notify outbox. Admin only; every worker is
// idempotent and safe to re-run from the ops console or the cron tick.

import '../services/channels/smartstore-adapter.js';
import '../services/channels/coupang-adapter.js';
import '../services/sourcing/domeme-adapter.js';
import '../services/sourcing/ownerclan-adapter.js';
import '../services/sourcing/onchannel-adapter.js';
import '../services/sourcing/cj-adapter.js';
import { runAutoOrder } from '../services/fulfillment/order.js';
import { runInvoiceSync } from '../services/fulfillment/invoice.js';
import { drainNotifyOutbox } from '../services/fulfillment/notify.js';
import { requireAdmin } from '../lib/auth.js';
import { json, readJson } from '../lib/http.js';

export async function handleFulfillmentOpsRoutes(request, url, env, corsHeaders) {
  const p = url.pathname;
  if (!p.startsWith('/api/v1/admin/fulfillment')) return null;
  await requireAdmin(request, env);

  if (p === '/api/v1/admin/fulfillment/auto-order/run' && request.method === 'POST') {
    await readJson(request);
    const r = await runAutoOrder(env, {});
    return json(corsHeaders, {
      success: true, checked: r.checked, sent: r.sent, skipped: r.skipped, failed: r.failed
    });
  }

  if (p === '/api/v1/admin/fulfillment/invoices/sync' && request.method === 'POST') {
    await readJson(request);
    const r = await runInvoiceSync(env, {});
    return json(corsHeaders, {
      success: true, checked: r.checked, shipped: r.shipped, failed: r.failed
    });
  }

  if (p === '/api/v1/admin/fulfillment/outbox' && request.method === 'GET') {
    const { results } = await env.DB.prepare(
      `SELECT id, kind, ref_id, status, created_at, sent_at FROM notify_outbox
       ORDER BY created_at DESC LIMIT 100`
    ).all();
    return json(corsHeaders, { success: true, data: results || [] });
  }

  if (p === '/api/v1/admin/fulfillment/outbox/drain' && request.method === 'POST') {
    await readJson(request);
    const r = await drainNotifyOutbox(env, {});
    return json(corsHeaders, {
      success: true, sent: r.sent, failed: r.failed, pending: r.pending, channel: r.channel
    });
  }

  return null;
}
