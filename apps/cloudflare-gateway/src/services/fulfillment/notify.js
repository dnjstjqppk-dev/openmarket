// apps/cloudflare-gateway/src/services/fulfillment/notify.js
// Fulfillment notify hooks: state transitions enqueue a durable outbox row
// (PO_SENT / PO_FAILED / SHIPPED / POLL_DEGRADED); the drain worker POSTs
// pending rows to ALERT_WEBHOOK_URL. Without a channel rows stay PENDING ??// the failure is still visible to operators via the outbox endpoint.

import { newId } from '../../lib/ids.js';

export const NOTIFY_KINDS = ['PO_SENT', 'PO_FAILED', 'SHIPPED', 'POLL_DEGRADED'];
export const NOTIFY_BATCH = 20;

/** Enqueue one hook; unknown kinds are a caller bug, never stored. */
export async function enqueueNotify(env, kind, refId, payload = {}) {
  if (!NOTIFY_KINDS.includes(kind)) throw new Error(`INVALID_NOTIFY_KIND: ${kind}`);
  const id = newId('ntf');
  await env.DB.prepare(
    'INSERT INTO notify_outbox (id, kind, ref_id, payload_json) VALUES (?, ?, ?, ?)'
  ).bind(id, kind, String(refId), JSON.stringify(payload).slice(0, 4000)).run();
  return { id };
}

/** POST pending hooks to the operator channel; failures stay retryable. */
export async function drainNotifyOutbox(env, { limit = NOTIFY_BATCH, fetchImpl = fetch } = {}) {
  const cap = Math.min(100, Math.max(1, Number(limit) || NOTIFY_BATCH));
  const { results } = await env.DB.prepare(
    "SELECT id, kind, ref_id, payload_json FROM notify_outbox WHERE status = 'PENDING' ORDER BY created_at ASC LIMIT ?"
  ).bind(cap).all();
  const rows = results || [];
  const webhook = String(env.ALERT_WEBHOOK_URL || '').trim();
  if (!webhook) return { sent: 0, failed: [], pending: rows.length, channel: false };
  let sent = 0;
  const failed = [];
  for (const row of rows) {
    try {
      const text = `[OLMOA ${env.ENVIRONMENT || 'unset'}] fulfillment ${row.kind} ${row.ref_id}`;
      const res = await fetchImpl(webhook, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, content: text, kind: row.kind, ref_id: row.ref_id })
      });
      if (!res || res.ok !== true) throw new Error('HOOK_DELIVERY_FAILED');
      await env.DB.prepare(
        "UPDATE notify_outbox SET status = 'SENT', sent_at = CURRENT_TIMESTAMP WHERE id = ?"
      ).bind(row.id).run();
      sent += 1;
    } catch {
      await env.DB.prepare("UPDATE notify_outbox SET status = 'FAILED' WHERE id = ?").bind(row.id).run();
      failed.push({ id: row.id, code: 'HOOK_DELIVERY_FAILED' });
    }
  }
  return { sent, failed, pending: rows.length - sent - failed.length, channel: true };
}
