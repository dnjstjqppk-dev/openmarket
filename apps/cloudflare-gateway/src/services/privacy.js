// apps/cloudflare-gateway/src/services/privacy.js
// Personal-data lifecycle (audit item O10): access records, data-subject export, withdrawal, retention purge.
// Legal retention periods are configuration, not code constants — counsel must confirm them before launch.

import { newId } from '../lib/ids.js';
import { conflict } from '../lib/http.js';
import { ACCOUNTS, creditStatement, journalStatements, getActiveOperator } from '../lib/ledger.js';

const DAY = 'days';
export const DEFAULT_ORDER_RETENTION_DAYS = 365 * 5;   // 전자상거래법: 계약·대금결제·재화공급 기록 5년
export const DEFAULT_INQUIRY_RETENTION_DAYS = 365 * 3; // 전자상거래법: 소비자 불만·분쟁처리 기록 3년
const WITHDRAWN_NAME = '탈퇴회원';
const PURGED = '(파기됨)';

function retentionDays(env, key, fallback) {
  const n = Number(env[key]);
  return Number.isInteger(n) && n >= 1 ? n : fallback;
}

/** Statement recording that personal data was exposed / exported / destroyed. Commit it with the read or change. */
export function piiAccessStatement(env, principal, { action, resource, subjectType, subjectIds = [], fields = null, request = null }) {
  const ids = [...new Set(subjectIds.filter(Boolean).map(String))];
  return env.DB.prepare(
    `INSERT INTO pii_access_log (id, actor_user_id, actor_role, actor_partner_id, action, resource, subject_type, subject_ids_json, subject_count, fields, ip, user_agent)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    newId('pii'), principal ? principal.userId : null, principal ? principal.role : 'SYSTEM', principal ? principal.partnerId || null : null,
    action, resource, subjectType, JSON.stringify(ids.slice(0, 500)), ids.length, fields,
    request ? request.headers.get('CF-Connecting-IP') || null : null,
    request ? String(request.headers.get('User-Agent') || '').slice(0, 300) || null : null
  );
}

/** Convenience: log a VIEW of personal data. Awaited so the record exists before the data leaves the server. */
export async function logPiiView(env, principal, resource, subjectType, subjectIds, fields, request) {
  if (!subjectIds || !subjectIds.length) return;
  await piiAccessStatement(env, principal, { action: 'VIEW', resource, subjectType, subjectIds, fields, request }).run();
}

/** Everything that blocks a withdrawal, as human-readable reasons (empty = may withdraw). */
export async function withdrawalBlockers(env, userId) {
  const one = (sql) => env.DB.prepare(sql).bind(userId).first('c');
  const reasons = [];
  const unpaid = await one("SELECT COUNT(*) c FROM orders WHERE customer_id = ? AND payment_status = 'READY'");
  if (unpaid) reasons.push({ code: 'UNPAID_ORDER', count: unpaid, message: '결제 대기 중인 주문이 있습니다. 취소하거나 만료된 뒤 탈퇴할 수 있습니다.' });
  const open = await one(`SELECT COUNT(*) c FROM sub_orders s JOIN orders o ON o.id = s.parent_order_id WHERE o.customer_id = ?
                          AND s.status IN ('PAYMENT_CONFIRMED','PREPARING','SHIPPED','IN_TRANSIT','DELIVERED','CANCEL_REQUESTED','RETURN_REQUESTED')`);
  if (open) reasons.push({ code: 'ORDER_IN_PROGRESS', count: open, message: '배송 중이거나 구매확정 전인 주문이 있습니다. 구매확정 또는 취소 후 탈퇴할 수 있습니다.' });
  const claims = await one("SELECT COUNT(*) c FROM returns WHERE user_id = ? AND (status = 'REQUESTED' OR (status = 'APPROVED' AND COALESCE(exchange_status, '') != 'RESHIPPED'))");
  if (claims) reasons.push({ code: 'CLAIM_IN_PROGRESS', count: claims, message: '처리 중인 반품·교환 요청이 있습니다.' });
  const refunds = await one("SELECT COUNT(*) c FROM refunds r JOIN orders o ON o.id = r.order_id WHERE o.customer_id = ? AND r.status = 'PENDING'");
  if (refunds) reasons.push({ code: 'REFUND_IN_PROGRESS', count: refunds, message: '환불이 진행 중입니다. 환불 완료 후 탈퇴할 수 있습니다.' });
  return reasons;
}

/**
 * Self-service withdrawal. Immediately destroys data that has no retention basis, pseudonymises the account
 * (the row stays because orders/ledgers reference it), and leaves order records for the legal retention period.
 */
export async function withdrawCustomer(env, principal, { acknowledgeCreditForfeit = false, request = null } = {}) {
  const userId = principal.userId;
  const blockers = await withdrawalBlockers(env, userId);
  if (blockers.length) throw conflict('WITHDRAWAL_BLOCKED', blockers.map((b) => b.message).join(' '), { blockers });
  const user = await env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(userId).first();
  const credit = await env.DB.prepare('SELECT COALESCE(SUM(amount_delta), 0) AS b FROM user_credits WHERE user_id = ?').bind(userId).first('b');
  if (credit > 0 && !acknowledgeCreditForfeit) {
    throw conflict('CREDIT_FORFEIT_CONSENT_REQUIRED', `적립금 ${credit.toLocaleString('ko-KR')}원이 남아 있습니다. 탈퇴 시 소멸되며 복구할 수 없습니다. 동의 후 다시 요청해 주세요.`, { credit_balance: credit });
  }

  const st = [];
  if (credit > 0) {
    const operator = await getActiveOperator(env);
    st.push(creditStatement(env, { userId, amount: -credit, reason: '회원 탈퇴에 따른 적립금 소멸', referenceId: `withdraw:${userId}` }));
    st.push(...journalStatements(env, { txnType: 'CREDIT_FORFEIT_WITHDRAWAL', entityId: operator ? operator.id : null, lines: [
      { account: ACCOUNTS.CUSTOMER_CREDIT_LIABILITY, debit: credit, memo: `${userId}:withdraw` },
      { account: ACCOUNTS.CREDIT_FORFEITURE_INCOME, credit: credit, memo: 'member withdrawal' }
    ] }));
  }
  // Data with no retention basis: destroyed now.
  st.push(env.DB.prepare('DELETE FROM user_addresses WHERE user_id = ?').bind(userId));
  st.push(env.DB.prepare('DELETE FROM wishlists WHERE user_id = ?').bind(userId));
  st.push(env.DB.prepare('DELETE FROM notifications WHERE user_id = ?').bind(userId));
  st.push(env.DB.prepare('DELETE FROM password_reset_tokens WHERE user_id = ?').bind(userId));
  st.push(env.DB.prepare('DELETE FROM email_verification_tokens WHERE user_id = ?').bind(userId));
  st.push(env.DB.prepare('DELETE FROM user_coupons WHERE user_id = ? AND is_used = 0').bind(userId));
  st.push(env.DB.prepare('DELETE FROM notification_delivery_logs WHERE recipient IN (?, ?)').bind(user.email, user.phone || '\u0000'));
  // Public posts stay (terms of service), but no longer identify the author.
  st.push(env.DB.prepare('UPDATE product_reviews SET reviewer_name = ?, author_name = CASE WHEN author_name IS NULL THEN NULL ELSE ? END, user_height_cm = NULL, user_weight_kg = NULL WHERE user_id = ?')
    .bind(WITHDRAWN_NAME, WITHDRAWN_NAME, userId));
  st.push(env.DB.prepare('UPDATE product_qna SET questioner_name = ? WHERE user_id = ?').bind(WITHDRAWN_NAME, userId));
  // Account: pseudonymised, sessions revoked, cannot log in, e-mail released for a future sign-up.
  st.push(env.DB.prepare(
    `UPDATE users SET email = ?, full_name = ?, phone = '', password_hash = '!withdrawn', is_active = 0, email_verified = 0,
            token_version = token_version + 1, withdrawn_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
     WHERE id = ? AND withdrawn_at IS NULL`
  ).bind(`withdrawn+${userId}@deleted.invalid`, WITHDRAWN_NAME, userId));
  st.push(piiAccessStatement(env, principal, { action: 'WITHDRAW', resource: 'auth.withdraw', subjectType: 'user', subjectIds: [userId], fields: 'email,full_name,phone,addresses,wishlist,notifications,reviews.author', request }));
  const res = await env.DB.batch(st);
  const userUpdate = res[res.length - 2];
  if (!userUpdate.meta || userUpdate.meta.changes !== 1) throw conflict('ALREADY_WITHDRAWN', '이미 탈퇴 처리된 계정입니다.');
  const orderRetention = retentionDays(env, 'PII_ORDER_RETENTION_DAYS', DEFAULT_ORDER_RETENTION_DAYS);
  return { withdrawn: true, credit_forfeited: credit > 0 ? credit : 0, order_records_retained_days: orderRetention };
}

/** 개인정보 열람 요구: everything we hold about the caller, in one document. */
export async function exportCustomerData(env, principal, request) {
  const id = principal.userId;
  const all = async (sql) => (await env.DB.prepare(sql).bind(id).all()).results;
  const data = {
    generated_at: new Date().toISOString(),
    account: await env.DB.prepare('SELECT id, email, full_name, phone, role, email_verified, created_at, updated_at, password_changed_at FROM users WHERE id = ?').bind(id).first(),
    addresses: await all('SELECT id, recipient_name, phone, postal_code, address_line1, address_line2, is_default, delivery_note, created_at FROM user_addresses WHERE user_id = ?'),
    orders: await all(`SELECT id, order_no, payment_status, total_pay_amount, recipient_name, recipient_phone, shipping_address_line1, shipping_address_line2,
                              shipping_postal_code, shipping_memo, created_at, paid_at FROM orders WHERE customer_id = ? ORDER BY created_at DESC`),
    credits: await all('SELECT amount_delta, balance_after, reason, created_at FROM user_credits WHERE user_id = ? ORDER BY created_at'),
    reviews: await all('SELECT product_id, rating, content, created_at FROM product_reviews WHERE user_id = ?'),
    questions: await all('SELECT product_id, question, answer, created_at FROM product_qna WHERE user_id = ?'),
    support_inquiries: await all('SELECT category, subject, content, answer, status, created_at FROM support_inquiries WHERE user_id = ?'),
    wishlist: await all('SELECT product_id, created_at FROM wishlists WHERE user_id = ?'),
    retention_policy: {
      orders_days_after_withdrawal: retentionDays(env, 'PII_ORDER_RETENTION_DAYS', DEFAULT_ORDER_RETENTION_DAYS),
      inquiries_days_after_withdrawal: retentionDays(env, 'PII_INQUIRY_RETENTION_DAYS', DEFAULT_INQUIRY_RETENTION_DAYS)
    }
  };
  await piiAccessStatement(env, principal, { action: 'EXPORT', resource: 'auth.privacy.export', subjectType: 'user', subjectIds: [id], fields: 'all', request }).run();
  return data;
}

/**
 * Cron: destroy personal data of withdrawn members whose legal retention period has ended.
 * Order totals, items and ledgers are kept (they identify no one once the recipient fields are gone).
 */
export async function purgeExpiredPii(env, limit = 500) {
  const orderDays = retentionDays(env, 'PII_ORDER_RETENTION_DAYS', DEFAULT_ORDER_RETENTION_DAYS);
  const inquiryDays = retentionDays(env, 'PII_INQUIRY_RETENTION_DAYS', DEFAULT_INQUIRY_RETENTION_DAYS);
  const { results: orders } = await env.DB.prepare(
    `SELECT o.id FROM orders o JOIN users u ON u.id = o.customer_id
     WHERE u.withdrawn_at IS NOT NULL AND o.pii_purged_at IS NULL AND o.created_at < datetime('now', ?) LIMIT ?`
  ).bind(`-${orderDays} ${DAY}`, limit).all();
  const { results: inquiries } = await env.DB.prepare(
    `SELECT i.id FROM support_inquiries i JOIN users u ON u.id = i.user_id
     WHERE u.withdrawn_at IS NOT NULL AND i.pii_purged_at IS NULL AND i.created_at < datetime('now', ?) LIMIT ?`
  ).bind(`-${inquiryDays} ${DAY}`, limit).all();
  if (!orders.length && !inquiries.length) return { orders: 0, inquiries: 0 };
  const st = [];
  for (const o of orders) {
    st.push(env.DB.prepare(
      `UPDATE orders SET recipient_name = ?, recipient_phone = '', shipping_address_line1 = ?, shipping_address_line2 = '', shipping_postal_code = '',
              shipping_memo = NULL, pccc = NULL, pii_purged_at = CURRENT_TIMESTAMP WHERE id = ? AND pii_purged_at IS NULL`
    ).bind(PURGED, PURGED, o.id));
  }
  for (const i of inquiries) {
    st.push(env.DB.prepare("UPDATE support_inquiries SET subject = ?, content = ?, pii_purged_at = CURRENT_TIMESTAMP WHERE id = ? AND pii_purged_at IS NULL").bind(PURGED, PURGED, i.id));
  }
  if (orders.length) st.push(piiAccessStatement(env, null, { action: 'PURGE', resource: 'cron.retention', subjectType: 'order', subjectIds: orders.map((o) => o.id), fields: 'recipient_name,recipient_phone,shipping_address,shipping_memo,pccc' }));
  if (inquiries.length) st.push(piiAccessStatement(env, null, { action: 'PURGE', resource: 'cron.retention', subjectType: 'inquiry', subjectIds: inquiries.map((i) => i.id), fields: 'subject,content' }));
  await env.DB.batch(st);
  return { orders: orders.length, inquiries: inquiries.length };
}
