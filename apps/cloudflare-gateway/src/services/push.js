// apps/cloudflare-gateway/src/services/push.js
// Push notification service: device-token registry, FCM fan-out, order-event
// triggers. Every attempt is delivery-logged (notification_delivery_logs,
// channel PUSH) with an honest terminal status — SENT, PARTIAL, FAILED,
// NO_TOKENS, or PUSH_NOT_CONFIGURED. Token rows hold sealed material plus a
// blind hash index (SEC-10 pattern); dead tokens are pruned on UNREGISTERED.

import { bad } from '../lib/http.js';
import { newId } from '../lib/ids.js';
import { sha256Hex } from '../utils/crypto-auth.js';
import { sealPii, maybeOpenPii } from '../lib/pii-crypto.js';
import { fcmConfigured, sendFcm } from '../lib/fcm.js';

export const PUSH_APPS = ['CUSTOMER', 'PARTNER'];
export const PUSH_PLATFORMS = ['ANDROID', 'IOS', 'WEB'];
export const PUSH_BROADCAST_CAP = 200;

export async function registerPushToken(env, { userId, app, platform, token }) {
  const clean = String(token || '').trim();
  if (clean.length < 20 || clean.length > 2000) throw bad('INVALID_TOKEN', '디바이스 토큰 형식이 올바르지 않습니다.');
  if (!PUSH_APPS.includes(app)) throw bad('INVALID_APP', 'app은 CUSTOMER 또는 PARTNER입니다.');
  if (!PUSH_PLATFORMS.includes(platform)) throw bad('INVALID_PLATFORM', 'platform은 ANDROID, IOS, WEB 중 하나여야 합니다.');
  const hash = await sha256Hex(clean);
  const sealed = await sealPii(env, clean);
  const existing = await env.DB.prepare('SELECT id FROM push_device_tokens WHERE token_hash = ?').bind(hash).first();
  if (existing) {
    // Shared devices move: the latest owner wins, the row count stays one.
    await env.DB.prepare(
      `UPDATE push_device_tokens SET user_id = ?, app = ?, platform = ?, token_sealed = ?, last_seen_at = CURRENT_TIMESTAMP WHERE id = ?`
    ).bind(userId, app, platform, sealed, existing.id).run();
    return { id: existing.id, created: false };
  }
  const id = newId('pdt');
  await env.DB.prepare(
    `INSERT INTO push_device_tokens (id, user_id, app, platform, token_hash, token_sealed) VALUES (?, ?, ?, ?, ?, ?)`
  ).bind(id, userId, app, platform, hash, sealed).run();
  return { id, created: true };
}

export async function unregisterPushToken(env, { userId, token }) {
  const clean = String(token || '').trim();
  if (!clean) throw bad('TOKEN_REQUIRED', '토큰을 지정해 주세요.');
  const r = await env.DB.prepare('DELETE FROM push_device_tokens WHERE user_id = ? AND token_hash = ?')
    .bind(userId, await sha256Hex(clean)).run();
  return { deleted: r.meta.changes || 0 };
}

async function logPush(env, { userId, app, templateCode, title, body, status, providerMsgId }) {
  // recipient carries the opaque user id (internal, like notifications.user_id);
  // recipient_hash keys the withdrawal purge; the body is sealed at rest.
  await env.DB.prepare(
    `INSERT INTO notification_delivery_logs (id, channel, app, recipient, recipient_hash, template_code, title, content, status, provider, provider_msg_id)
     VALUES (?, 'PUSH', ?, ?, ?, ?, ?, ?, ?, 'FCM', ?)`
  ).bind(newId('dlv'), app || null, userId, await sha256Hex(userId), templateCode, String(title).slice(0, 200),
    await sealPii(env, String(body).slice(0, 1000)), status, providerMsgId || null).run();
}

async function sendToTokens(env, tokens, { title, body, data }) {
  let sent = 0;
  let failed = 0;
  let firstMsgId = null;
  for (const t of tokens) {
    try {
      const plain = await maybeOpenPii(env, t.token_sealed);
      if (!plain) {
        failed++;
        continue;
      }
      const r = await sendFcm(env, { token: plain, title, body, data });
      if (r.ok) {
        sent++;
        if (!firstMsgId) firstMsgId = r.messageId;
      } else {
        failed++;
        if (r.unregistered) await env.DB.prepare('DELETE FROM push_device_tokens WHERE id = ?').bind(t.id).run();
      }
    } catch {
      failed++;
    }
  }
  return { sent, failed, firstMsgId };
}

export async function notifyUser(env, { userId, app = 'CUSTOMER', title, body, data = null, templateCode = 'GENERIC' }) {
  const { results: tokens } = await env.DB.prepare(
    'SELECT id, token_sealed FROM push_device_tokens WHERE user_id = ? AND app = ? ORDER BY last_seen_at DESC'
  ).bind(userId, app).all();
  if (!tokens.length) {
    await logPush(env, { userId, app, templateCode, title, body, status: 'NO_TOKENS', providerMsgId: null });
    return { sent: 0, failed: 0, status: 'NO_TOKENS' };
  }
  if (!fcmConfigured(env)) {
    await logPush(env, { userId, app, templateCode, title, body, status: 'PUSH_NOT_CONFIGURED', providerMsgId: null });
    return { sent: 0, failed: 0, status: 'PUSH_NOT_CONFIGURED' };
  }
  const r = await sendToTokens(env, tokens, { title, body, data });
  const status = r.failed === 0 ? 'SENT' : r.sent === 0 ? 'FAILED' : 'PARTIAL';
  await logPush(env, { userId, app, templateCode, title, body, status, providerMsgId: r.firstMsgId });
  return { sent: r.sent, failed: r.failed, status };
}

export async function broadcastPush(env, { title, body, app = null, limit = PUSH_BROADCAST_CAP }) {
  const cleanTitle = String(title || '').trim();
  const cleanBody = String(body || '').trim();
  if (!cleanTitle || !cleanBody) throw bad('CONTENT_REQUIRED', '제목과 내용을 입력해 주세요.');
  const cap = Math.min(PUSH_BROADCAST_CAP, Math.max(1, Number(limit) || PUSH_BROADCAST_CAP));
  const totalRow = await env.DB.prepare(
    `SELECT COUNT(*) AS c FROM push_device_tokens${app ? ' WHERE app = ?' : ''}`
  ).bind(...(app ? [app] : [])).first();
  const total = Number(totalRow.c) || 0;
  const { results: tokens } = await env.DB.prepare(
    `SELECT id, user_id, app AS token_app, token_sealed FROM push_device_tokens${app ? ' WHERE app = ?' : ''} ORDER BY last_seen_at DESC LIMIT ?`
  ).bind(...(app ? [app, cap] : [cap])).all();
  let sent = 0;
  let failed = 0;
  if (tokens.length && !fcmConfigured(env)) {
    for (const t of tokens) {
      await logPush(env, { userId: t.user_id, app: t.token_app, templateCode: 'BROADCAST', title: cleanTitle, body: cleanBody, status: 'PUSH_NOT_CONFIGURED', providerMsgId: null });
      failed++;
    }
    return { sent: 0, failed, skipped: Math.max(0, total - tokens.length), limit_applied: cap };
  }
  for (const t of tokens) {
    const r = await sendToTokens(env, [t], { title: cleanTitle, body: cleanBody, data: { type: 'BROADCAST' } });
    sent += r.sent;
    failed += r.failed;
    await logPush(env, {
      userId: t.user_id, app: t.token_app, templateCode: 'BROADCAST', title: cleanTitle, body: cleanBody,
      status: r.sent ? 'SENT' : 'FAILED', providerMsgId: r.firstMsgId
    });
  }
  return { sent, failed, skipped: Math.max(0, total - tokens.length), limit_applied: cap };
}

// ---------- order-event triggers (customer app) ----------

export async function pushOrderShipped(env, { orderNo, customerId, trackingNumber = null }) {
  return notifyUser(env, {
    userId: customerId,
    title: '주문이 출고되었습니다',
    body: trackingNumber ? `${orderNo} 운송장이 등록되었습니다. (${trackingNumber})` : `${orderNo} 운송장이 등록되었습니다.`,
    data: { type: 'ORDER_SHIPPED', order_no: String(orderNo) },
    templateCode: 'ORDER_SHIPPED'
  });
}

export async function pushOrderDelivered(env, { orderNo, customerId }) {
  return notifyUser(env, {
    userId: customerId,
    title: '배송이 완료되었습니다',
    body: `${orderNo} 상품이 배송 완료되었습니다.`,
    data: { type: 'ORDER_DELIVERED', order_no: String(orderNo) },
    templateCode: 'ORDER_DELIVERED'
  });
}

export async function pushRefundCompleted(env, { orderNo, customerId, amount = 0 }) {
  const won = Number(amount) || 0;
  return notifyUser(env, {
    userId: customerId,
    title: '환불이 완료되었습니다',
    body: won > 0 ? `${orderNo} ${won.toLocaleString()}원 환불이 완료되었습니다.` : `${orderNo} 환불이 완료되었습니다.`,
    data: { type: 'REFUND_COMPLETED', order_no: String(orderNo) },
    templateCode: 'REFUND_COMPLETED'
  });
}

export async function pushClaimCreditGranted(env, { orderNo, customerId, amount = 0 }) {
  const won = Number(amount) || 0;
  return notifyUser(env, {
    userId: customerId,
    title: '적립금이 지급되었습니다',
    body: won > 0 ? `최저가 보상 ${won.toLocaleString()}원이 적립되었습니다.` : '최저가 보상 심사가 승인되었습니다.',
    data: { type: 'CLAIM_CREDIT_GRANTED', order_no: String(orderNo) },
    templateCode: 'CLAIM_CREDIT_GRANTED'
  });
}

export async function pushSellerNewOrder(env, { orderNo, userId, itemCount = 0 }) {
  const n = Number(itemCount) || 0;
  return notifyUser(env, {
    userId,
    app: 'PARTNER',
    title: '새 주문이 들어왔습니다',
    body: n > 0 ? `${orderNo} ${n}개 상품 결제가 완료되었습니다.` : `${orderNo} 결제가 완료되었습니다.`,
    data: { type: 'SELLER_NEW_ORDER', order_no: String(orderNo) },
    templateCode: 'SELLER_NEW_ORDER'
  });
}

export async function pushClaimRejected(env, { orderNo, customerId, note = '' }) {
  const reason = String(note || '').trim().slice(0, 200);
  return notifyUser(env, {
    userId: customerId,
    title: '클레임 심사 결과 안내',
    body: reason ? `${orderNo} 클레임이 반려되었습니다. 사유: ${reason}` : `${orderNo} 클레임이 반려되었습니다.`,
    data: { type: 'CLAIM_REJECTED', order_no: String(orderNo) },
    templateCode: 'CLAIM_REJECTED'
  });
}
