// apps/cloudflare-gateway/src/services/fulfillment/order.js
// Auto-PO orchestrator: PAID intake rows become one supplier PO each
// (UNIQUE on channel_order_id), sent to the mapped sourcing vendor via a
// live placeOrder call. Without vendor keys the PO stays DRAFT with the
// honest code in detail_json and a PO_FAILED hook fires for operators.

import { newId } from '../../lib/ids.js';
import { getProvider, SourcingConfigError } from '../sourcing/provider.js';
import { enqueueNotify } from './notify.js';

export const AUTO_ORDER_BATCH = 50;

/** Dispatch POs for paid intakes; retries DRAFT rows, never duplicates. */
export async function runAutoOrder(env, { limit = AUTO_ORDER_BATCH } = {}) {
  const cap = Math.min(200, Math.max(1, Number(limit) || AUTO_ORDER_BATCH));
  const { results } = await env.DB.prepare(
    `SELECT c.id, c.channel, c.external_order_id, c.total_krw, c.provider, c.items_json, p.id AS po_id, p.status AS po_status
     FROM unified_orders c LEFT JOIN supplier_pos p ON p.channel_order_id = c.id
     WHERE c.status = 'PAID' AND (p.id IS NULL OR p.status = 'DRAFT')
     ORDER BY c.paid_at ASC NULLS LAST LIMIT ?`
  ).bind(cap).all();
  const rows = results || [];
  let sent = 0;
  const skipped = [];
  const failed = [];
  for (const row of rows) {
    if (!row.provider) {
      skipped.push({ id: row.id, code: 'VENDOR_UNMAPPED' });
      continue;
    }
    const poId = row.po_id || newId('po');
    if (!row.po_id) {
      await env.DB.prepare(
        'INSERT INTO supplier_pos (id, channel_order_id, provider, status) VALUES (?, ?, ?, ?)'
      ).bind(poId, row.id, row.provider, 'DRAFT').run();
    }
    try {
      const provider = getProvider(row.provider);
      if (typeof provider.placeOrder !== 'function') throw new Error('VENDOR_API_PENDING: placeOrder not wired');
      const placed = await provider.placeOrder(env, {
        poId, items: JSON.parse(row.items_json || '[]'), totalKrw: row.total_krw,
        channelOrderId: row.external_order_id
      });
      await env.DB.prepare(
        `UPDATE supplier_pos SET status = 'SENT', external_po_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`
      ).bind(String(placed.externalPoId), poId).run();
      await env.DB.prepare(
        "UPDATE unified_orders SET status = 'ORDERED', updated_at = CURRENT_TIMESTAMP WHERE id = ?"
      ).bind(row.id).run();
      await enqueueNotify(env, 'PO_SENT', poId, { channel: row.channel, provider: row.provider });
      sent += 1;
    } catch (e) {
      const code = e instanceof SourcingConfigError ? 'PROVIDER_NOT_CONFIGURED'
        : String(e?.message || '').startsWith('VENDOR_API_PENDING') ? 'VENDOR_API_PENDING' : 'UPSTREAM_ERROR';
      await env.DB.prepare(
        'UPDATE supplier_pos SET detail_json = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
      ).bind(JSON.stringify({ code }), poId).run();
      await enqueueNotify(env, 'PO_FAILED', row.id, { channel: row.channel, provider: row.provider, code });
      failed.push({ id: row.id, po_id: poId, code });
    }
  }
  return { checked: rows.length, sent, skipped, failed };
}
