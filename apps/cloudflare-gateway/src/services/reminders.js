// apps/cloudflare-gateway/src/services/reminders.js
// Work order 5-9: scheduled notification jobs (master spec K-06, K-09).
// Called from the Worker scheduled() cron; each job is best-effort per row so
// one bad row never aborts the tick. Delivery is at-most-once: the K-06 log
// and the K-09 flag columns are claimed before the notification is written,
// mirroring the K-05 restock pattern.

import { newId, sqlNow } from '../lib/ids.js';
import { getPolicy } from '../lib/ledger.js';
import { isDropFakeFlagged } from '../lib/fake-discount.js';

const DAY_MS = 86400000;

// Today as a KST YYYY-MM-DD calendar day. NOTIF_TEST_TODAY_KST pins the clock
// in tests (unset in production), following the POLICY_TEST_TODAY_KST pattern.
export function notifTodayKst(env) {
  const pinned = String(env?.NOTIF_TEST_TODAY_KST || '');
  if (/^\d{4}-\d{2}-\d{2}$/.test(pinned)) return pinned;
  return new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

function parseDays(raw) {
  if (raw === null || raw === undefined) return null;
  const n = Number(String(raw).trim());
  if (!Number.isInteger(n) || n < 0) return null;
  return n;
}

async function insertNotif(env, { userId, title, message, type, actionUrl }) {
  await env.DB.prepare(
    'INSERT INTO notifications (id, user_id, title, message, type, action_url) VALUES (?, ?, ?, ?, ?, ?)'
  ).bind(newId('ntf'), userId, title, message, type, actionUrl).run();
}

// ---------------------------------------------------------------------------------------------
// K-06: wishlist price-drop bundles (one in-app notification per member per KST day)
// ---------------------------------------------------------------------------------------------
export async function runPriceDropNotifs(env, { limit = 200 } = {}) {
  const today = notifTodayKst(env);
  const { results: users } = await env.DB.prepare(
    `SELECT DISTINCT w.user_id AS user_id FROM wishlists w
     JOIN products p ON p.id = w.product_id
     WHERE p.status = 'ACTIVE'
       AND NOT EXISTS (SELECT 1 FROM price_drop_notifs l WHERE l.user_id = w.user_id AND l.notified_day = ?)
     LIMIT ?`
  ).bind(today, limit).all();
  let bundled = 0;
  for (const u of users || []) {
    try {
      if (await bundleUserDrops(env, u.user_id, today)) bundled++;
    } catch { /* one member's bundle never aborts the tick */ }
  }
  return { users: bundled, bundled };
}

async function bundleUserDrops(env, userId, today) {
  // A drop is a history row whose sale_price is below its immediate
  // predecessor for the same SKU (first rows have no baseline and never fire).
  const { results: drops } = await env.DB.prepare(
    `SELECT h.id AS hid, h.sku_id, h.sale_price, h.changed_at, s.product_id, p.title AS product_title
     FROM sku_price_history h
     JOIN product_skus s ON s.id = h.sku_id
     JOIN products p ON p.id = s.product_id
     JOIN wishlists w ON w.product_id = p.id AND w.user_id = ?
     WHERE p.status = 'ACTIVE'
       AND h.sale_price < (
         SELECT h2.sale_price FROM sku_price_history h2
         WHERE h2.sku_id = h.sku_id
           AND (h2.changed_at < h.changed_at OR (h2.changed_at = h.changed_at AND h2.rowid < h.rowid))
         ORDER BY h2.changed_at DESC, h2.rowid DESC LIMIT 1)
       AND NOT EXISTS (SELECT 1 FROM price_drop_notifs l WHERE l.user_id = ? AND l.history_id = h.id)
     ORDER BY h.changed_at ASC, h.rowid ASC`
  ).bind(userId, userId).all();
  if (!drops || !drops.length) return false;
  const histCache = new Map();
  const included = [];
  for (const d of drops) {
    try {
      if (!histCache.has(d.sku_id)) {
        const { results } = await env.DB.prepare(
          'SELECT id, original_price, sale_price, changed_at FROM sku_price_history WHERE sku_id = ? ORDER BY changed_at ASC, rowid ASC'
        ).bind(d.sku_id).all();
        histCache.set(d.sku_id, results || []);
      }
      const rows = histCache.get(d.sku_id);
      const idx = rows.findIndex((r) => r.id === d.hid);
      if (idx < 0) continue;
      if (isDropFakeFlagged(rows, idx)) continue; // K-13 suspect: never send
      included.push(d);
    } catch { /* skip one unreadable drop, keep the rest */ }
  }
  if (!included.length) return false;
  // Claim first: exactly one tick bundles each drop row per member.
  let claimed = 0;
  for (const d of included) {
    try {
      const r = await env.DB.prepare(
        'INSERT OR IGNORE INTO price_drop_notifs (id, user_id, history_id, notified_day) VALUES (?, ?, ?, ?)'
      ).bind(newId('pdn'), userId, d.hid, today).run();
      if ((r.meta.changes || 0) === 1) claimed++;
    } catch { /* keep the rest */ }
  }
  if (!claimed) return false;
  const titles = [];
  for (const d of included) {
    const name = String(d.product_title || '상품').slice(0, 80);
    if (!titles.includes(name)) titles.push(name);
  }
  const message = titles.length === 1
    ? `찜한 상품의 가격이 내렸습니다: ${titles[0]}`
    : `찜한 상품 ${titles.length}개의 가격이 내렸습니다: ${titles[0]} 외 ${titles.length - 1}개`;
  await insertNotif(env, {
    userId, title: '찜한 상품 가격 인하', message, type: 'DISCOUNT', actionUrl: '/wishlist'
  });
  return true;
}

// ---------------------------------------------------------------------------------------------
// K-09: purchase-confirm and review reminders (policy-gated, once per sub-order)
// ---------------------------------------------------------------------------------------------
export async function runPurchaseReminds(env, { limit = 200 } = {}) {
  let confirm = 0;
  let review = 0;
  try {
    confirm = await runConfirmReminds(env, limit);
  } catch { /* never aborts the tick */ }
  try {
    review = await runReviewReminds(env, limit);
  } catch { /* never aborts the tick */ }
  return { confirm, review };
}

async function runConfirmReminds(env, limit) {
  const days = parseDays(await getPolicy(env, 'remind.confirm_after_days'));
  if (days === null) return 0; // no policy: the reminder stays off
  const cutoff = sqlNow(-days * DAY_MS);
  const { results: rows } = await env.DB.prepare(
    `SELECT s.id, s.sub_order_no, s.parent_order_id, o.customer_id
     FROM sub_orders s JOIN orders o ON o.id = s.parent_order_id
     WHERE s.status = 'DELIVERED' AND s.delivered_at IS NOT NULL AND s.delivered_at <= ?
       AND s.confirm_reminded_at IS NULL
     LIMIT ?`
  ).bind(cutoff, limit).all();
  let n = 0;
  for (const r of rows || []) {
    try {
      const claim = await env.DB.prepare(
        'UPDATE sub_orders SET confirm_reminded_at = CURRENT_TIMESTAMP WHERE id = ? AND confirm_reminded_at IS NULL'
      ).bind(r.id).run();
      if ((claim.meta.changes || 0) !== 1) continue;
      await insertNotif(env, {
        userId: r.customer_id,
        title: '구매확정 안내',
        message: `주문하신 상품(${r.sub_order_no})이 배송완료되었습니다. 자동 구매확정 전에 상품을 확인해 주세요.`,
        type: 'ORDER_STATUS',
        actionUrl: `/orders/${r.parent_order_id}`
      });
      n++;
    } catch { /* one reminder never aborts the batch */ }
  }
  return n;
}

async function runReviewReminds(env, limit) {
  const days = parseDays(await getPolicy(env, 'remind.review_after_days'));
  if (days === null) return 0; // no policy: the reminder stays off
  const cutoff = sqlNow(-days * DAY_MS);
  const { results: rows } = await env.DB.prepare(
    `SELECT s.id, s.parent_order_id, o.customer_id
     FROM sub_orders s JOIN orders o ON o.id = s.parent_order_id
     WHERE s.status IN ('PURCHASE_CONFIRMED', 'COMPLETED')
       AND s.purchase_confirmed_at IS NOT NULL AND s.purchase_confirmed_at <= ?
       AND s.review_reminded_at IS NULL
     LIMIT ?`
  ).bind(cutoff, limit).all();
  let n = 0;
  for (const r of rows || []) {
    try {
      // Skip when the buyer already reviewed every product of this
      // sub-order for this order (reviews are unique per product+order).
      const { results: prods } = await env.DB.prepare(
        'SELECT DISTINCT product_id FROM order_items WHERE sub_order_id = ? AND product_id IS NOT NULL'
      ).bind(r.id).all();
      let unreviewed = false;
      for (const p of prods || []) {
        const rev = await env.DB.prepare(
          'SELECT id FROM product_reviews WHERE user_id = ? AND order_id = ? AND product_id = ?'
        ).bind(r.customer_id, r.parent_order_id, p.product_id).first();
        if (!rev) { unreviewed = true; break; }
      }
      if (!unreviewed && (prods || []).length) continue;
      const claim = await env.DB.prepare(
        'UPDATE sub_orders SET review_reminded_at = CURRENT_TIMESTAMP WHERE id = ? AND review_reminded_at IS NULL'
      ).bind(r.id).run();
      if ((claim.meta.changes || 0) !== 1) continue;
      await insertNotif(env, {
        userId: r.customer_id,
        title: '리뷰 작성 안내',
        message: '구매확정하신 상품은 어떠셨나요? 리뷰를 남겨 주시면 다른 고객에게 도움이 됩니다.',
        type: 'SYSTEM',
        actionUrl: `/orders/${r.parent_order_id}`
      });
      n++;
    } catch { /* one reminder never aborts the batch */ }
  }
  return n;
}
