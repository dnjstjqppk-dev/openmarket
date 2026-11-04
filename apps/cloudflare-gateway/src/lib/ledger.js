// apps/cloudflare-gateway/src/lib/ledger.js
// Double-entry journal, credit ledger and admin audit statement builders.
// Builders return prepared statements so callers can commit them in the SAME D1 batch as the business change.

import { newId } from './ids.js';

export const ACCOUNTS = Object.freeze({
  PG_CLEARING: 'PG_CLEARING',                         // asset: cash collected by PG, not yet settled to bank
  CUSTOMER_CREDIT_LIABILITY: 'CUSTOMER_CREDIT_LIABILITY', // liability: credits owed to customers
  PROMOTION_EXPENSE: 'PROMOTION_EXPENSE',             // expense: platform-funded coupons
  MARKETING_EXPENSE: 'MARKETING_EXPENSE',             // expense: credits granted (welcome, reward, compensation)
  SELLER_PAYABLE: 'SELLER_PAYABLE',                   // liability: owed to marketplace sellers
  COMMISSION_REVENUE: 'COMMISSION_REVENUE',           // revenue: marketplace commission
  DIRECT_SALES_REVENUE: 'DIRECT_SALES_REVENUE',       // revenue: MODEL A goods + shipping
  BANK: 'BANK'                                        // asset: operator bank account (payouts)
});

/**
 * lines: [{ account, debit?, credit?, sub_order_id?, partner_id?, memo? }]
 * Throws if the transaction does not balance — an unbalanced journal is a programming error, never data.
 */
export function journalStatements(env, { txnType, entityId = null, orderId = null, refundId = null, lines }) {
  const clean = lines
    .map((l) => ({ ...l, debit: l.debit || 0, credit: l.credit || 0 }))
    .filter((l) => l.debit !== 0 || l.credit !== 0);
  let dr = 0;
  let cr = 0;
  for (const l of clean) {
    if (!Number.isSafeInteger(l.debit) || !Number.isSafeInteger(l.credit) || l.debit < 0 || l.credit < 0) {
      throw new Error(`JOURNAL_INVARIANT: non-integer or negative line ${JSON.stringify(l)}`);
    }
    if (l.debit && l.credit) throw new Error('JOURNAL_INVARIANT: line has both debit and credit');
    dr += l.debit;
    cr += l.credit;
  }
  if (dr !== cr) throw new Error(`JOURNAL_INVARIANT: ${txnType} unbalanced dr=${dr} cr=${cr}`);
  if (!clean.length) return [];
  const txnId = newId('txn');
  return clean.map((l) => env.DB.prepare(
    `INSERT INTO journal_entries (id, txn_id, txn_type, entity_id, account_code, debit, credit, order_id, sub_order_id, partner_id, refund_id, memo)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(newId('jrn'), txnId, txnType, entityId, l.account, l.debit, l.credit, orderId, l.sub_order_id || null, l.partner_id || null, refundId, l.memo || null));
}

/** Credit movement (positive = grant/restore, negative = use). Balance floor is enforced by DB trigger. */
export function creditStatement(env, { userId, amount, reason, referenceId }) {
  return env.DB.prepare(
    `INSERT INTO user_credits (id, user_id, amount_delta, balance_after, reason, reference_id)
     VALUES (?, ?, ?, COALESCE((SELECT SUM(amount_delta) FROM user_credits WHERE user_id = ?), 0) + ?, ?, ?)`
  ).bind(newId('crd'), userId, amount, userId, amount, reason, referenceId || null);
}

/** Granting credit is a marketing expense that creates a liability to the customer. */
export function grantCreditStatements(env, { userId, amount, reason, referenceId, entityId, txnType = 'CREDIT_GRANT' }) {
  if (!Number.isSafeInteger(amount) || amount <= 0) throw new Error('CREDIT_INVARIANT: grant must be a positive integer');
  return [
    creditStatement(env, { userId, amount, reason, referenceId }),
    ...journalStatements(env, {
      txnType, entityId, lines: [
        { account: ACCOUNTS.MARKETING_EXPENSE, debit: amount, memo: reason },
        { account: ACCOUNTS.CUSTOMER_CREDIT_LIABILITY, credit: amount, memo: `${userId}:${referenceId || ''}` }
      ]
    })
  ];
}

export function auditStatement(env, principal, { action, targetType, targetId = null, before = null, after = null, request = null }) {
  const ip = request ? (request.headers.get('CF-Connecting-IP') || null) : null;
  return env.DB.prepare(
    `INSERT INTO admin_audit_log (id, actor_user_id, actor_role, action, target_type, target_id, before_json, after_json, ip)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(newId('aud'), principal.userId, principal.role, action, targetType, targetId,
    before === null ? null : JSON.stringify(before), after === null ? null : JSON.stringify(after), ip);
}

export async function getActiveOperator(env) {
  return env.DB.prepare(
    "SELECT * FROM business_entities WHERE role = 'PLATFORM_OPERATOR' AND status = 'ACTIVE' LIMIT 1"
  ).first();
}
