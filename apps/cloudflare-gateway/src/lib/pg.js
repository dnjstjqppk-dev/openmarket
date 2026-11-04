// apps/cloudflare-gateway/src/lib/pg.js
// Payment gateway adapter (Toss Payments v1 REST).
//   PAYMENT_MODE=live    -> calls api.tosspayments.com with TOSS_SECRET_KEY (a Toss *test* key = Toss official sandbox)
//   PAYMENT_MODE=sandbox -> local simulator, refused when ENVIRONMENT=production; every row is flagged is_sandbox=1
//   unset                -> payments disabled (fail closed). Nothing is ever reported as paid without one of the above.

import { HttpError, unavailable } from './http.js';

const TOSS_API = 'https://api.tosspayments.com/v1';

export function paymentMode(env) {
  const mode = String(env.PAYMENT_MODE || '').toLowerCase();
  if (mode === 'live') {
    if (!env.TOSS_SECRET_KEY) throw unavailable('PAYMENT_NOT_CONFIGURED', 'PG 비밀키가 설정되지 않아 결제를 진행할 수 없습니다.');
    return 'live';
  }
  if (mode === 'sandbox') {
    if (env.ENVIRONMENT === 'production') throw unavailable('SANDBOX_FORBIDDEN', '운영 환경에서는 결제 시뮬레이터를 사용할 수 없습니다.');
    return 'sandbox';
  }
  throw unavailable('PAYMENT_NOT_CONFIGURED', '결제 수단이 아직 연동되지 않았습니다.');
}

function authHeader(env) {
  return `Basic ${btoa(`${env.TOSS_SECRET_KEY}:`)}`;
}

async function tossFetch(env, path, { method = 'GET', body, idempotencyKey } = {}) {
  const headers = { Authorization: authHeader(env), 'Content-Type': 'application/json' };
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
  let res;
  try {
    res = await fetch(`${TOSS_API}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  } catch (e) {
    throw new HttpError(502, 'PG_NETWORK_ERROR', `PG 통신 실패: ${e.message}`);
  }
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

export async function pgConfirm(env, { paymentKey, orderNo, amount }) {
  const mode = paymentMode(env);
  if (mode === 'sandbox') {
    if (!/^sandbox_[A-Za-z0-9_-]{8,}$/.test(paymentKey)) {
      return { ok: false, code: 'SANDBOX_KEY_INVALID', message: '시뮬레이터 결제키 형식이 아닙니다.' };
    }
    return {
      ok: true, sandbox: true, method: 'SANDBOX', approvedAt: new Date().toISOString(), receiptUrl: null,
      raw: { simulator: true, paymentKey, orderId: orderNo, totalAmount: amount, status: 'DONE' }
    };
  }
  const r = await tossFetch(env, '/payments/confirm', { method: 'POST', body: { paymentKey, orderId: orderNo, amount }, idempotencyKey: `confirm_${orderNo}` });
  if (!r.ok) return { ok: false, code: r.data.code || 'PG_CONFIRM_REJECTED', message: r.data.message || 'PG 승인 거절', raw: r.data };
  if (r.data.totalAmount !== amount || r.data.orderId !== orderNo || r.data.status !== 'DONE') {
    return { ok: false, code: 'PG_RESPONSE_MISMATCH', message: 'PG 승인 응답이 주문과 일치하지 않습니다.', raw: r.data, approvedButMismatched: r.data.status === 'DONE' };
  }
  return { ok: true, sandbox: false, method: r.data.method || 'CARD', approvedAt: r.data.approvedAt, receiptUrl: r.data.receipt?.url || null, raw: r.data };
}

export async function pgCancel(env, { paymentKey, amount, reason, idempotencyKey, isSandbox }) {
  if (amount <= 0) return { ok: true, transactionKey: null, sandbox: Boolean(isSandbox) };
  if (isSandbox) {
    // A sandbox capture can only be cancelled by the simulator, regardless of the current mode.
    if (env.ENVIRONMENT === 'production') throw unavailable('SANDBOX_FORBIDDEN', '운영 환경에서는 시뮬레이터를 사용할 수 없습니다.');
    if (env.__SANDBOX_FAIL_CANCEL) return { ok: false, code: 'SANDBOX_CANCEL_FAILED', message: 'simulated PG cancel failure' };
    return { ok: true, sandbox: true, transactionKey: `sandbox_cancel_${idempotencyKey}` };
  }
  paymentMode(env);
  const r = await tossFetch(env, `/payments/${encodeURIComponent(paymentKey)}/cancel`, {
    method: 'POST', body: { cancelReason: reason.slice(0, 200), cancelAmount: amount }, idempotencyKey
  });
  if (!r.ok) return { ok: false, code: r.data.code || 'PG_CANCEL_REJECTED', message: r.data.message || 'PG 취소 거절', raw: r.data };
  const last = Array.isArray(r.data.cancels) ? r.data.cancels[r.data.cancels.length - 1] : null;
  return { ok: true, sandbox: false, transactionKey: last ? last.transactionKey : null, raw: r.data };
}

/** Authoritative lookup used to verify webhooks (Toss payment-status webhooks are not signed). */
export async function pgGetPayment(env, paymentKey) {
  const mode = paymentMode(env);
  if (mode === 'sandbox') return null;
  const r = await tossFetch(env, `/payments/${encodeURIComponent(paymentKey)}`);
  return r.ok ? r.data : null;
}
