// apps/cloudflare-gateway/src/services/payouts.js
// Work order 2-4: seller payout requests over the existing payout engine.
// Amounts are integer KRW. The payout creation core moved here verbatim from
// the admin finance route so approvals reuse the identical batch.

import { bad, conflict, notFound, idempotencyKey } from '../lib/http.js';
import { newId } from '../lib/ids.js';
import { ACCOUNTS, journalStatements, auditStatement } from '../lib/ledger.js';
import { sha256Hex } from '../utils/crypto-auth.js';
import { runBatch } from './orders.js';

/** partners.rolling_reserve_pct (REAL percent) -> integer basis points, capped at 50%. */
export function reserveBpsOf(pct) {
  const bps = Math.round(Number(pct || 0) * 100);
  if (!Number.isFinite(bps) || bps <= 0) return 0;
  return Math.min(bps, 5000);
}

// A payout is always for ONE operating entity: after a 개인사업자 -> 법인 switch, settlements of each entity are
// paid (and journalled) separately, oldest entity first. `other_entities_pending` tells the caller to run again.
export async function payablePreview(env, partnerId) {
  const { results: allSettlements } = await env.DB.prepare(
    `SELECT st.id, st.sub_order_id, st.net_payout_amount, st.operator_entity_id,
            COALESCE((SELECT SUM(a.net_delta) FROM settlement_adjustments a WHERE a.settlement_id = st.id AND a.applied_payout_id IS NULL), 0) AS adj
     FROM settlements st WHERE st.partner_id = ? AND st.status = 'ELIGIBLE_FOR_PAYOUT' ORDER BY st.created_at`
  ).bind(partnerId).all();
  const { results: allCarried } = await env.DB.prepare(
    `SELECT a.id, a.net_delta, st.operator_entity_id FROM settlement_adjustments a JOIN settlements st ON st.id = a.settlement_id
     WHERE a.partner_id = ? AND a.applied_payout_id IS NULL AND st.status = 'PAID_OUT' ORDER BY a.created_at`
  ).bind(partnerId).all();
  // Rolling reserve (O18): holds whose release date has passed flow back into a payout.
  const { results: allReleasable } = await env.DB.prepare(
    "SELECT id, amount, operator_entity_id FROM payout_reserve_holds WHERE partner_id = ? AND released_payout_id IS NULL AND release_after <= datetime('now') ORDER BY created_at"
  ).bind(partnerId).all();
  const partner = await env.DB.prepare('SELECT rolling_reserve_pct, rolling_reserve_days FROM partners WHERE id = ?').bind(partnerId).first();
  const reserveBps = reserveBpsOf(partner && partner.rolling_reserve_pct);
  const reserveDays = Math.max(1, Math.min(365, Number(partner && partner.rolling_reserve_days) || 90));
  const { results: openHolds } = await env.DB.prepare(
    'SELECT COALESCE(SUM(amount),0) AS a, MIN(release_after) AS next_release FROM payout_reserve_holds WHERE partner_id = ? AND released_payout_id IS NULL'
  ).bind(partnerId).all();

  const byEntity = (entity) => {
    const same = (r) => (r.operator_entity_id ?? null) === entity;
    const settlements = allSettlements.filter(same);
    const carried = allCarried.filter(same);
    const releasable = allReleasable.filter(same);
    const gross = settlements.reduce((s, r) => s + r.net_payout_amount + r.adj, 0) + carried.reduce((s, r) => s + r.net_delta, 0);
    const released = releasable.reduce((s, h) => s + h.amount, 0);
    // Only a positive gross is reserved; a net deduction is never "reserved" on top of being carried.
    const held = gross > 0 ? Math.floor((gross * reserveBps) / 10000) : 0;
    return { entity, settlements, carried, releasable, gross, released, held, amount: gross + released - held };
  };
  const entities = [...new Set([...allSettlements, ...allCarried, ...allReleasable].map((r) => r.operator_entity_id ?? null))];
  const candidates = entities.map(byEntity);
  // Pay the first entity that has something positive to pay; a negative balance of one entity must not block another.
  const chosen = candidates.find((c) => c.amount > 0) || candidates[0] || byEntity(null);
  return {
    ...chosen, reserveBps, reserveDays,
    other_entities_pending: candidates.some((c) => c !== chosen && (c.settlements.length || c.carried.length || c.releasable.length)),
    reserve_outstanding: openHolds[0].a, next_release: openHolds[0].next_release
  };
}

export function payoutPayload(p) {
  return { payout_id: p.id, amount: p.amount, gross_amount: p.gross_amount, reserve_held: p.reserve_held, reserve_released: p.reserve_released, reserve_release_days: p.reserve_release_days ?? null, operator_entity_id: p.operator_entity_id, other_entities_pending: Boolean(p.other_entities_pending), settlement_count: p.settlement_count, bank_transfer: 'MANUAL — 은행 이체 후 /transferred 로 이체 참조번호를 기록하세요.' };
}

export async function accountHash(bankCode, accountNumber) {
  return sha256Hex(`${bankCode || ''}|${accountNumber || ''}`);
}

/** Withdrawable = payable preview minus in-flight requests. */
export async function withdrawableAmount(env, partnerId) {
  const pv = await payablePreview(env, partnerId);
  const inflight = await env.DB.prepare(
    "SELECT COALESCE(SUM(amount),0) AS s FROM payout_requests WHERE partner_id = ? AND status = 'REQUESTED'"
  ).bind(partnerId).first('s');
  return pv.amount - inflight;
}

/**
 * Create a payout for the full available amount (moved verbatim from the admin
 * finance route). Same-key replays return the winner instead of erroring.
 */
export async function createPayout(env, { partnerId, adminId, idemKey, adminRole = null }) {
  const key = idempotencyKey(idemKey ?? null);
  if (key) {
    const prior = await env.DB.prepare('SELECT * FROM payouts WHERE idempotency_key = ?').bind(key).first();
    if (prior) return { replay: true, payout: prior };
  }
  const partner = await env.DB.prepare('SELECT * FROM partners WHERE id = ?').bind(String(partnerId || '')).first();
  if (!partner) throw notFound('입점사를 찾을 수 없습니다.');
  if (!Number(partner.payout_account_verified)) throw conflict('PAYOUT_ACCOUNT_UNVERIFIED', '정산 계좌 실명 확인이 완료되지 않았습니다.');
  const pv = await payablePreview(env, partner.id);
  if (!pv.settlements.length && !pv.carried.length && !pv.releasable.length) throw conflict('NOTHING_TO_PAY', '지급 대상 정산이 없습니다.');
  if (pv.amount <= 0) throw conflict('NEGATIVE_BALANCE_CARRIED', `정산 후 환불 차감으로 지급액이 ${pv.amount}원입니다. 다음 정산으로 이월됩니다.`, { amount: pv.amount });
  const payoutId = newId('pay');
  const entityId = pv.entity;
  const ids = pv.settlements.map((s) => s.id);
  const releaseDays = pv.held ? pv.reserveDays : null;
  const st = [
    env.DB.prepare('INSERT INTO payouts (id, partner_id, operator_entity_id, amount, gross_amount, reserve_held, reserve_released, settlement_count, adjustment_count, status, approved_by, idempotency_key, reserve_release_days, other_entities_pending) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(payoutId, partner.id, entityId, pv.amount, pv.gross, pv.held, pv.released, ids.length, pv.carried.length, 'APPROVED', adminId, key, releaseDays, pv.other_entities_pending ? 1 : 0)
  ];
  if (pv.held > 0) {
    st.push(env.DB.prepare(`INSERT INTO payout_reserve_holds (id, partner_id, operator_entity_id, held_by_payout_id, amount, reserve_bps, release_after)
                            VALUES (?, ?, ?, ?, ?, ?, datetime('now', ?))`)
      .bind(newId('rsv'), partner.id, entityId, payoutId, pv.held, pv.reserveBps, `+${pv.reserveDays} days`));
  }
  for (const h of pv.releasable) {
    st.push(env.DB.prepare('UPDATE payout_reserve_holds SET released_payout_id = ?, released_at = CURRENT_TIMESTAMP WHERE id = ? AND released_payout_id IS NULL').bind(payoutId, h.id));
  }
  for (const id of ids) {
    st.push(env.DB.prepare("UPDATE settlements SET status = 'PAID_OUT', payout_id = ?, settled_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'ELIGIBLE_FOR_PAYOUT'").bind(payoutId, id));
    st.push(env.DB.prepare('UPDATE settlement_adjustments SET applied_payout_id = ? WHERE settlement_id = ? AND applied_payout_id IS NULL').bind(payoutId, id));
  }
  for (const a of pv.carried) st.push(env.DB.prepare('UPDATE settlement_adjustments SET applied_payout_id = ? WHERE id = ? AND applied_payout_id IS NULL').bind(payoutId, a.id));
  // Abort if anything changed between preview and commit (concurrent refund/cancel).
  st.push(env.DB.prepare(
    `INSERT INTO batch_assertions (code) SELECT 'PAYOUT_DRIFT' WHERE
       (SELECT COUNT(*) FROM settlements WHERE payout_id = ?) != ? OR
       (SELECT COALESCE(SUM(st.net_payout_amount),0) FROM settlements st WHERE st.payout_id = ?) + (SELECT COALESCE(SUM(net_delta),0) FROM settlement_adjustments WHERE applied_payout_id = ?) != ? OR
       (SELECT COALESCE(SUM(amount),0) FROM payout_reserve_holds WHERE released_payout_id = ?) != ?`
  ).bind(payoutId, ids.length, payoutId, payoutId, pv.gross, payoutId, pv.released));
  st.push(...journalStatements(env, { txnType: 'SELLER_PAYOUT', entityId, lines: [
    { account: ACCOUNTS.SELLER_PAYABLE, debit: pv.amount, partner_id: partner.id },
    { account: ACCOUNTS.BANK, credit: pv.amount, partner_id: partner.id, memo: payoutId }
  ] }));
  st.push(auditStatement(env, { userId: adminId, role: 'ADMIN', adminRole }, { action: 'PAYOUT_APPROVE', targetType: 'partner', targetId: partner.id, after: { payoutId, amount: pv.amount, gross: pv.gross, reserveHeld: pv.held, reserveReleased: pv.released, settlements: ids } }));
  try {
    await runBatch(env, st);
  } catch (e) {
    // Lost a same-key race: the winner's row is the answer, not an error.
    if (key && String(e.message).includes('idempotency_key')) {
      const winner = await env.DB.prepare('SELECT * FROM payouts WHERE idempotency_key = ?').bind(key).first();
      if (winner) return { replay: true, payout: winner };
    }
    throw e;
  }
  const created = await env.DB.prepare('SELECT * FROM payouts WHERE id = ?').bind(payoutId).first();
  return { replay: false, payout: created };
}

/**
 * Seller withdrawal request (5-2, decision-16: full amount only). Key required;
 * one in-flight request per seller. The server creates the request for the
 * current withdrawable full amount; a supplied amount must equal it.
 */
export async function requestPayout(env, { partnerId, amount = undefined, idemKey }) {
  const key = idempotencyKey(idemKey ?? null);
  if (!key) throw bad('IDEMPOTENCY_KEY_REQUIRED', 'X-Idempotency-Key 헤더가 필요합니다.');
  const prior = await env.DB.prepare('SELECT * FROM payout_requests WHERE idempotency_key = ?').bind(key).first();
  if (prior) return { ...prior, idempotent_replay: true };
  const partner = await env.DB.prepare('SELECT * FROM partners WHERE id = ?').bind(String(partnerId || '')).first();
  if (!partner) throw notFound('입점사를 찾을 수 없습니다.');
  if (!Number(partner.payout_account_verified)) throw conflict('PAYOUT_ACCOUNT_UNVERIFIED', '정산 계좌 실명 확인이 완료되지 않았습니다.');
  const avail = await withdrawableAmount(env, partner.id);
  if (avail <= 0) throw conflict('NOTHING_TO_WITHDRAW', '출금 가능한 금액이 없습니다.');
  if (amount !== undefined && amount !== null) {
    const n = Number(amount);
    if (!Number.isSafeInteger(n) || n !== avail) {
      throw bad('WITHDRAWAL_FULL_AMOUNT_ONLY', `출금은 전액(${avail}원)으로만 신청할 수 있습니다.`, { withdrawable_amount: avail });
    }
  }
  const id = newId('pwr');
  const hash = await accountHash(partner.bank_code, partner.bank_account_number);
  try {
    await env.DB.prepare(
      `INSERT INTO payout_requests (id, partner_id, amount, status, account_hash, idempotency_key)
       VALUES (?, ?, ?, 'REQUESTED', ?, ?)`
    ).bind(id, partner.id, avail, hash, key).run();
  } catch (e) {
    const msg = String(e && e.message || '');
    if (msg.includes('payout_requests.partner_id') || msg.includes('uq_payout_requests_inflight')) {
      throw conflict('PAYOUT_REQUEST_INFLIGHT', '처리 중인 출금 신청이 있습니다.');
    }
    if (msg.includes('idempotency_key')) {
      const winner = await env.DB.prepare('SELECT * FROM payout_requests WHERE idempotency_key = ?').bind(key).first();
      if (winner) return { ...winner, idempotent_replay: true };
    }
    throw e;
  }
  return env.DB.prepare('SELECT * FROM payout_requests WHERE id = ?').bind(id).first();
}

export async function cancelPayoutRequest(env, { requestId, partnerId }) {
  const row = await env.DB.prepare('SELECT * FROM payout_requests WHERE id = ?').bind(requestId).first();
  if (!row || row.partner_id !== partnerId) throw notFound('출금 신청을 찾을 수 없습니다.');
  if (row.status !== 'REQUESTED') throw conflict('PAYOUT_REQUEST_IMMUTABLE', '처리 중인 신청만 취소할 수 있습니다.');
  await env.DB.prepare("UPDATE payout_requests SET status = 'CANCELLED', updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(requestId).run();
  return env.DB.prepare('SELECT * FROM payout_requests WHERE id = ?').bind(requestId).first();
}

/**
 * Admin decision. Approval requires the requested amount to still equal the
 * withdrawable amount, then pays it through the existing payout creation.
 * 5-2: every state change is guarded by `status = 'REQUESTED'` (0 rows = 409),
 * a drifted approval auto-rejects so the seller can re-apply, and approval
 * claims the request before paying so concurrent approvers yield one winner.
 */
export async function decidePayoutRequest(env, { requestId, approve, reason = null, adminId, adminRole = null, idemKey }) {
  const row = await env.DB.prepare('SELECT * FROM payout_requests WHERE id = ?').bind(requestId).first();
  if (!row) throw notFound('출금 신청을 찾을 수 없습니다.');
  if (row.status !== 'REQUESTED') throw conflict('PAYOUT_REQUEST_IMMUTABLE', '대기 중인 신청만 처리할 수 있습니다.');
  const admin = { userId: adminId, role: 'ADMIN', adminRole };
  if (!approve) {
    const why = String(reason || '').trim();
    if (!why) throw bad('REJECT_REASON_REQUIRED', '반려 사유가 필요합니다.');
    const r = await env.DB.prepare(
      "UPDATE payout_requests SET status = 'REJECTED', reject_reason = ?, decided_by = ?, decided_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'REQUESTED'"
    ).bind(why.slice(0, 500), adminId, requestId).run();
    if (r.meta.changes !== 1) throw conflict('PAYOUT_REQUEST_IMMUTABLE', '대기 중인 신청만 처리할 수 있습니다.');
    await auditStatement(env, admin, { action: 'PAYOUT_REQUEST_REJECT', targetType: 'payout_request', targetId: requestId,
      before: { status: 'REQUESTED' }, after: { status: 'REJECTED', reason: why.slice(0, 500) } }).run();
    return env.DB.prepare('SELECT * FROM payout_requests WHERE id = ?').bind(requestId).first();
  }
  const partner = await env.DB.prepare('SELECT * FROM partners WHERE id = ?').bind(row.partner_id).first();
  if ((await accountHash(partner.bank_code, partner.bank_account_number)) !== row.account_hash) {
    throw conflict('PAYOUT_ACCOUNT_CHANGED', '신청 후 정산 계좌가 바뀌었습니다. 다시 신청해 주세요.');
  }
  const avail = (await withdrawableAmount(env, row.partner_id)) + row.amount;
  if (row.amount !== avail) {
    const r = await env.DB.prepare(
      "UPDATE payout_requests SET status = 'REJECTED', reject_reason = 'WITHDRAWAL_AMOUNT_CHANGED', decided_by = ?, decided_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'REQUESTED'"
    ).bind(adminId, requestId).run();
    if (r.meta.changes !== 1) throw conflict('PAYOUT_REQUEST_IMMUTABLE', '대기 중인 신청만 처리할 수 있습니다.');
    await auditStatement(env, admin, { action: 'PAYOUT_REQUEST_REJECT', targetType: 'payout_request', targetId: requestId,
      before: { status: 'REQUESTED' }, after: { status: 'REJECTED', reason: 'WITHDRAWAL_AMOUNT_CHANGED' } }).run();
    throw conflict('WITHDRAWAL_AMOUNT_CHANGED', `출금 가능액이 바뀌었습니다(신청 ${row.amount}원, 현재 ${avail}원). 다시 신청해 주세요.`);
  }
  const claim = await env.DB.prepare(
    "UPDATE payout_requests SET status = 'APPROVED', decided_by = ?, decided_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'REQUESTED'"
  ).bind(adminId, requestId).run();
  if (claim.meta.changes !== 1) throw conflict('PAYOUT_REQUEST_IMMUTABLE', '대기 중인 신청만 처리할 수 있습니다.');
  let made;
  try {
    made = await createPayout(env, { partnerId: row.partner_id, adminId, adminRole, idemKey });
  } catch (e) {
    // Payment failed after the claim: release it so the request stays actionable.
    await env.DB.prepare(
      "UPDATE payout_requests SET status = 'REQUESTED', decided_by = NULL, decided_at = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'APPROVED' AND payout_id IS NULL"
    ).bind(requestId).run();
    throw e;
  }
  await env.DB.prepare(
    "UPDATE payout_requests SET payout_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
  ).bind(made.payout.id, requestId).run();
  await auditStatement(env, admin, { action: 'PAYOUT_REQUEST_APPROVE', targetType: 'payout_request', targetId: requestId,
    before: { status: 'REQUESTED' }, after: { status: 'APPROVED', payout_id: made.payout.id } }).run();
  return env.DB.prepare('SELECT * FROM payout_requests WHERE id = ?').bind(requestId).first();
}

/** Mirror a payout transfer onto its linked request, if any. */
export async function markRequestTransferred(env, payoutId) {
  await env.DB.prepare(
    "UPDATE payout_requests SET status = 'TRANSFERRED', updated_at = CURRENT_TIMESTAMP WHERE payout_id = ? AND status = 'APPROVED'"
  ).bind(payoutId).run();
}
