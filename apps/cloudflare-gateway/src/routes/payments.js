// apps/cloudflare-gateway/src/routes/payments.js
// Payment confirmation (customer) and PG webhook (verified by authoritative PG lookup).

import { requireCustomer, requireMachineSecret } from '../lib/auth.js';
import { json, readJson, HttpError } from '../lib/http.js';
import { newId } from '../lib/ids.js';
import { paymentMode, pgGetPayment } from '../lib/pg.js';
import { confirmPayment, captureFromVerifiedPg } from '../services/orders.js';

export async function handlePaymentRoutes(request, url, env, corsHeaders) {
  if (!url.pathname.startsWith('/api/v1/payments')) return null;
  const p = url.pathname;

  if (p === '/api/v1/payments/config' && request.method === 'GET') {
    let mode = 'DISABLED';
    try { mode = paymentMode(env) === 'live' ? 'TOSS' : 'SANDBOX_SIMULATOR'; } catch { mode = 'DISABLED'; }
    return json(corsHeaders, {
      success: true,
      provider: mode === 'TOSS' ? 'TOSS_PAYMENTS' : null,
      mode,
      client_key: mode === 'TOSS' ? (env.TOSS_CLIENT_KEY || null) : null,
      is_test_key: mode === 'TOSS' ? String(env.TOSS_CLIENT_KEY || '').startsWith('test_') : null,
      message: mode === 'DISABLED' ? 'PG 계약/키 미설정으로 결제가 비활성화되어 있습니다.' : undefined
    });
  }

  if (p === '/api/v1/payments/confirm' && request.method === 'POST') {
    const me = await requireCustomer(request, env);
    const body = await readJson(request);
    const r = await confirmPayment(env, me, {
      orderRef: String(body.order_id || body.orderId || ''),
      paymentKey: String(body.payment_key || body.paymentKey || ''),
      amount: Number(body.amount)
    });
    const o = r.order;
    const data = { order_id: o.id, order_no: o.order_no, amount: o.total_pay_amount, status: o.payment_status, payment_key: o.payment_key, receipt_url: o.pg_receipt_url, is_sandbox: Number(o.is_sandbox) === 1, idempotent_replay: r.replay };
    return json(corsHeaders, { success: true, message: '결제가 승인되었습니다.', data });
  }

  if (p === '/api/v1/payments/webhook' && request.method === 'POST') {
    const payload = await readJson(request);
    const data = payload.data || {};
    const paymentKey = String(data.paymentKey || payload.paymentKey || '');
    const eventType = String(payload.eventType || 'UNKNOWN');
    const mode = paymentMode(env);
    let verified = null;
    let sandbox = false;
    if (mode === 'live') {
      if (!paymentKey) throw new HttpError(400, 'MISSING_PAYMENT_KEY', 'paymentKey 누락');
      verified = await pgGetPayment(env, paymentKey); // the webhook body itself is never trusted
    } else {
      requireMachineSecret(request, env, 'PAYMENT_WEBHOOK_SECRET', 'X-Webhook-Secret');
      verified = { paymentKey, orderId: data.orderId, totalAmount: data.totalAmount, status: data.status, method: 'SANDBOX' };
      sandbox = true;
    }
    const eventKey = `${eventType}:${paymentKey}:${verified ? verified.status : 'UNVERIFIED'}:${data.createdAt || payload.createdAt || ''}`;
    let outcome = 'IGNORED';
    let orderId = null;
    if (verified && verified.orderId) {
      const order = await env.DB.prepare('SELECT * FROM orders WHERE order_no = ?').bind(verified.orderId).first();
      orderId = order ? order.id : null;
      if (!order) outcome = 'ORDER_NOT_FOUND';
      else if (verified.status === 'DONE') outcome = await captureFromVerifiedPg(env, order, verified, { sandbox });
      else if (['CANCELED', 'PARTIAL_CANCELED', 'ABORTED', 'EXPIRED'].includes(verified.status)) outcome = 'PG_SIDE_STATUS_RECORDED_FOR_RECONCILIATION';
    } else if (!verified) {
      outcome = 'VERIFICATION_FAILED';
    }
    try {
      await env.DB.prepare(
        `INSERT INTO payment_events (id, provider, event_key, event_type, order_id, payment_key, verified, outcome, payload_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(newId('pev'), sandbox ? 'SANDBOX' : 'TOSS', eventKey, eventType, orderId, paymentKey || null, verified ? 1 : 0, outcome, JSON.stringify(payload).slice(0, 20000)).run();
    } catch (e) {
      if (String(e.message).includes('UNIQUE')) return json(corsHeaders, { success: true, duplicate: true });
      throw e;
    }
    return json(corsHeaders, { success: true, outcome });
  }

  return null;
}
