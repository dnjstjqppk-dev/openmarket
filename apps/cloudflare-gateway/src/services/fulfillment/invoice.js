// apps/cloudflare-gateway/src/services/fulfillment/invoice.js
// Invoice collection + channel push-back: SENT/CONFIRMED POs without a
// tracking row get a live fetchTracking call against the vendor; the real
// tracking number is stored, pushed back to the origin channel (smartstore /
// coupang), and the intake moves to SHIPPED. Nothing is pushed on failure.

import { newId } from '../../lib/ids.js';
import { getProvider, SourcingConfigError } from '../sourcing/provider.js';
import { getChannel, ChannelConfigError } from '../channels/channel.js';
import { enqueueNotify } from './notify.js';

export const INVOICE_BATCH = 50;

/** Collect one wave of vendor invoices; failures keep their old state. */
export async function runInvoiceSync(env, { limit = INVOICE_BATCH } = {}) {
  const cap = Math.min(200, Math.max(1, Number(limit) || INVOICE_BATCH));
  const { results } = await env.DB.prepare(
    `SELECT p.id AS po_id, p.provider, p.external_po_id, c.id AS order_id, c.channel, c.external_order_id
     FROM supplier_pos p JOIN unified_orders c ON c.id = p.channel_order_id
     LEFT JOIN shipment_trackings t ON t.po_id = p.id
     WHERE p.status IN ('SENT', 'CONFIRMED') AND t.id IS NULL LIMIT ?`
  ).bind(cap).all();
  const rows = results || [];
  let shipped = 0;
  const failed = [];
  for (const row of rows) {
    try {
      if (!row.external_po_id) throw new Error('PO_NOT_SENT');
      const provider = getProvider(row.provider);
      if (typeof provider.fetchTracking !== 'function') throw new Error('VENDOR_API_PENDING: fetchTracking not wired');
      const inv = await provider.fetchTracking(env, row.external_po_id);
      const trackingId = newId('trk');
      await env.DB.prepare(
        'INSERT INTO shipment_trackings (id, po_id, carrier_code, tracking_no) VALUES (?, ?, ?, ?)'
      ).bind(trackingId, row.po_id, String(inv.carrier || 'VENDOR_DEFAULT').slice(0, 40),
        String(inv.trackingNo)).run();
      if (row.channel !== 'storefront') {
        const channel = getChannel(row.channel);
        if (typeof channel.pushTracking !== 'function') throw new Error('CHANNEL_API_PENDING: pushTracking not wired');
        await channel.pushTracking(env, row.external_order_id, { carrier: inv.carrier, trackingNo: inv.trackingNo });
      }
      await env.DB.prepare(
        'UPDATE shipment_trackings SET pushed_to_channel_at = CURRENT_TIMESTAMP WHERE id = ?'
      ).bind(trackingId).run();
      await env.DB.prepare(
        "UPDATE unified_orders SET status = 'SHIPPED', updated_at = CURRENT_TIMESTAMP WHERE id = ?"
      ).bind(row.order_id).run();
      await enqueueNotify(env, 'SHIPPED', row.po_id, { channel: row.channel, tracking_no: inv.trackingNo });
      shipped += 1;
    } catch (e) {
      const code = (e instanceof SourcingConfigError) ? 'PROVIDER_NOT_CONFIGURED'
        : (e instanceof ChannelConfigError) ? 'CHANNEL_NOT_CONFIGURED'
        : String(e?.message || '').startsWith('PO_NOT_SENT') ? 'PO_NOT_SENT'
        : /_PENDING/.test(String(e?.message || '')) ? 'VENDOR_API_PENDING' : 'UPSTREAM_ERROR';
      failed.push({ po_id: row.po_id, code });
    }
  }
  return { checked: rows.length, shipped, failed };
}
