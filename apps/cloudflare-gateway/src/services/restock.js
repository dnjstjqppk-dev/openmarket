// apps/cloudflare-gateway/src/services/restock.js
// K-05 restock notifications: when a SKU goes 0 -> positive, every pending
// subscriber gets one in-app notification plus one push attempt, and the
// subscription is stamped notified_at so it never fires twice. Halted,
// deleted, or draft products stay silent. All entry points are best-effort:
// a notify failure must never fail the stock write that triggered it.

import { newId } from '../lib/ids.js';
import { pushRestockAvailable } from './push.js';

/**
 * Notify pending subscribers for replenished SKUs.
 * @param {object} env Worker env (DB)
 * @param {Array<{skuId: string, before: number, after: number}>} transitions
 * @returns {{notified: number}} subscriptions stamped in this call
 */
export async function notifyRestockedSkus(env, transitions) {
  let notified = 0;
  for (const tr of transitions || []) {
    const before = Number(tr.before) || 0;
    const after = Number(tr.after);
    if (!tr.skuId || !(before <= 0 && after > 0)) continue;
    try {
      notified += await notifySkuSubscribers(env, tr.skuId);
    } catch { /* notify failure must never fail the stock write */ }
  }
  return { notified };
}

async function notifySkuSubscribers(env, skuId) {
  const sku = await env.DB.prepare(
    `SELECT s.id, s.product_id, s.stock_quantity, p.title AS product_title, p.status AS product_status
     FROM product_skus s JOIN products p ON p.id = s.product_id WHERE s.id = ?`
  ).bind(skuId).first();
  if (!sku) return 0;
  if (sku.product_status !== 'ACTIVE') return 0;
  if (Number(sku.stock_quantity) <= 0) return 0;
  const { results: subs } = await env.DB.prepare(
    'SELECT id, user_id FROM restock_subscriptions WHERE sku_id = ? AND notified_at IS NULL'
  ).bind(skuId).all();
  const title = '재입고 알림';
  const body = `알림을 신청하신 상품이 재입고되었습니다: ${String(sku.product_title || '상품').slice(0, 80)}`;
  let n = 0;
  for (const sub of subs || []) {
    try {
      // Claim first: exactly one worker marks the row, so a subscription
      // fires at most once even under concurrent replenishments.
      const claim = await env.DB.prepare(
        'UPDATE restock_subscriptions SET notified_at = CURRENT_TIMESTAMP WHERE id = ? AND notified_at IS NULL'
      ).bind(sub.id).run();
      if ((claim.meta.changes || 0) !== 1) continue;
      await env.DB.prepare(
        "INSERT INTO notifications (id, user_id, title, message, type, action_url) VALUES (?, ?, ?, ?, 'SYSTEM', ?)"
      ).bind(newId('ntf'), sub.user_id, title, body, `/product/${sku.product_id}`).run();
      n++;
    } catch { continue; }
    try {
      await pushRestockAvailable(env, {
        customerId: sub.user_id, productTitle: sku.product_title, productId: sku.product_id, skuId
      });
    } catch { /* push is best-effort; the in-app notification is recorded */ }
  }
  return n;
}
