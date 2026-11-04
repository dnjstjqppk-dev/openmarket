// apps/cloudflare-gateway/src/routes/finance.js
// Operator finance: seller payouts, journal / trial balance, manual refunds & delivery, and full reconciliation.

import { requireAdmin } from '../lib/auth.js';
import { json, readJson, bad, conflict, notFound, str } from '../lib/http.js';
import { newId } from '../lib/ids.js';
import { ACCOUNTS, journalStatements, auditStatement } from '../lib/ledger.js';
import { refundOrder, runBatch, loadOrderBundle } from '../services/orders.js';

async function payablePreview(env, partnerId) {
  const { results: settlements } = await env.DB.prepare(
    `SELECT st.id, st.sub_order_id, st.net_payout_amount, st.operator_entity_id,
            COALESCE((SELECT SUM(a.net_delta) FROM settlement_adjustments a WHERE a.settlement_id = st.id AND a.applied_payout_id IS NULL), 0) AS adj
     FROM settlements st WHERE st.partner_id = ? AND st.status = 'ELIGIBLE_FOR_PAYOUT' ORDER BY st.created_at`
  ).bind(partnerId).all();
  const { results: carried } = await env.DB.prepare(
    `SELECT a.id, a.net_delta, st.operator_entity_id FROM settlement_adjustments a JOIN settlements st ON st.id = a.settlement_id
     WHERE a.partner_id = ? AND a.applied_payout_id IS NULL AND st.status = 'PAID_OUT'`
  ).bind(partnerId).all();
  const amount = settlements.reduce((s, r) => s + r.net_payout_amount + r.adj, 0) + carried.reduce((s, r) => s + r.net_delta, 0);
  return { settlements, carried, amount };
}

export async function reconcile(env) {
  const checks = [];
  const add = (id, name, rows) => checks.push({ id, name, ok: rows.length === 0, violations: rows.slice(0, 50), violation_count: rows.length });
  const all = async (sql, ...b) => (await env.DB.prepare(sql).bind(...b).all()).results;

  add('R01', 'Every journal transaction balances (debit = credit)',
    await all('SELECT txn_id, txn_type, SUM(debit) AS dr, SUM(credit) AS cr FROM journal_entries GROUP BY txn_id HAVING SUM(debit) != SUM(credit)'));
  add('R02', 'Order arithmetic: goods - volume - coupon - credit + shipping = PG amount',
    await all(`SELECT id, order_no FROM orders WHERE legacy_record = 0
               AND total_goods_amount - volume_discount_amount - coupon_discount_amount - credit_used_amount + total_shipping_amount != total_pay_amount`));
  add('R03', 'Item allocation: coupon + credit + PG = line total',
    await all(`SELECT i.id FROM order_items i JOIN sub_orders s ON s.id = i.sub_order_id JOIN orders o ON o.id = s.parent_order_id
               WHERE o.legacy_record = 0 AND i.coupon_alloc + i.credit_alloc + i.pg_alloc != i.total_price`));
  add('R04', 'Sub-order goods = sum of its items; order PG = sum of item + shipping PG shares',
    await all(`SELECT o.id FROM orders o WHERE o.legacy_record = 0 AND (
                 (SELECT COALESCE(SUM(s.goods_amount),0) FROM sub_orders s WHERE s.parent_order_id = o.id) != o.total_goods_amount - o.volume_discount_amount
              OR (SELECT COALESCE(SUM(i.pg_alloc),0) FROM order_items i JOIN sub_orders s ON s.id = i.sub_order_id WHERE s.parent_order_id = o.id)
                 + (SELECT COALESCE(SUM(s.shipping_pg_alloc),0) FROM sub_orders s WHERE s.parent_order_id = o.id) != o.total_pay_amount)`));
  add('R04b', 'Sub-order goods amount = sum of its item line totals',
    await all(`SELECT s.id FROM sub_orders s JOIN orders o ON o.id = s.parent_order_id
               WHERE o.legacy_record = 0 AND (SELECT COALESCE(SUM(total_price),0) FROM order_items WHERE sub_order_id = s.id) != s.goods_amount`));
  add('R05', 'Captured orders have exactly one PG capture equal to the PG amount',
    await all(`SELECT o.id, o.total_pay_amount, (SELECT COALESCE(SUM(amount),0) FROM payment_transactions t WHERE t.order_id = o.id AND t.status != 'FAILED') AS captured
               FROM orders o WHERE o.legacy_record = 0 AND o.paid_at IS NOT NULL AND o.total_pay_amount > 0
               AND (SELECT COALESCE(SUM(amount),0) FROM payment_transactions t WHERE t.order_id = o.id AND t.status != 'FAILED') != o.total_pay_amount`));
  add('R06', 'Order refunded totals = sum of PENDING+DONE refunds',
    await all(`SELECT o.id, o.refunded_pg_amount, o.refunded_credit_amount FROM orders o WHERE
                 o.refunded_pg_amount != (SELECT COALESCE(SUM(pg_amount),0) FROM refunds r WHERE r.order_id = o.id AND r.status IN ('PENDING','DONE'))
              OR o.refunded_credit_amount != (SELECT COALESCE(SUM(credit_amount),0) FROM refunds r WHERE r.order_id = o.id AND r.status IN ('PENDING','DONE'))`));
  add('R07', 'Refunds stuck in PENDING for more than 10 minutes (PG outcome unknown, needs manual check)',
    await all("SELECT id, order_id, pg_amount, created_at FROM refunds WHERE status = 'PENDING' AND created_at < datetime('now', '-10 minutes')"));
  const pgJournal = await env.DB.prepare(`SELECT COALESCE(SUM(debit) - SUM(credit), 0) AS bal FROM journal_entries WHERE account_code = '${ACCOUNTS.PG_CLEARING}'`).first('bal');
  const pgCaptured = await env.DB.prepare("SELECT COALESCE(SUM(t.amount),0) a FROM payment_transactions t JOIN orders o ON o.id = t.order_id WHERE t.status != 'FAILED' AND o.legacy_record = 0").first('a');
  const pgRefunded = await env.DB.prepare("SELECT COALESCE(SUM(pg_amount),0) a FROM refunds WHERE status = 'DONE'").first('a');
  add('R08', 'PG clearing account = captures - completed PG refunds', pgJournal === pgCaptured - pgRefunded ? [] : [{ journal: pgJournal, captured: pgCaptured, refunded: pgRefunded }]);
  const creditLedger = await env.DB.prepare('SELECT COALESCE(SUM(amount_delta),0) b FROM user_credits').first('b');
  const creditLiab = await env.DB.prepare(`SELECT COALESCE(SUM(credit) - SUM(debit), 0) AS bal FROM journal_entries WHERE account_code = '${ACCOUNTS.CUSTOMER_CREDIT_LIABILITY}'`).first('bal');
  const creditReserved = await env.DB.prepare("SELECT COALESCE(SUM(credit_used_amount),0) a FROM orders WHERE payment_status = 'READY'").first('a');
  add('R09', 'Customer credit ledger = credit liability - credits reserved by unpaid orders', creditLedger === creditLiab - creditReserved ? [] : [{ ledger: creditLedger, liability: creditLiab, reserved: creditReserved }]);
  const sellerJournal = await env.DB.prepare(`SELECT COALESCE(SUM(credit) - SUM(debit), 0) AS bal FROM journal_entries WHERE account_code = '${ACCOUNTS.SELLER_PAYABLE}'`).first('bal');
  const sellerBook = await env.DB.prepare(
    `SELECT COALESCE(SUM(st.net_payout_amount + COALESCE((SELECT SUM(a.net_delta) FROM settlement_adjustments a WHERE a.settlement_id = st.id),0)),0) AS v
     FROM settlements st JOIN sub_orders s ON s.id = st.sub_order_id JOIN orders o ON o.id = s.parent_order_id WHERE o.paid_at IS NOT NULL AND o.legacy_record = 0`
  ).first('v');
  const paidOut = await env.DB.prepare('SELECT COALESCE(SUM(amount),0) a FROM payouts').first('a');
  add('R10', 'Seller payable account = settlements + adjustments - payouts', sellerJournal === sellerBook - paidOut ? [] : [{ journal: sellerJournal, book: sellerBook, payouts: paidOut }]);
  add('R11', 'Settlement row arithmetic: net = gross - commission + shipping',
    await all('SELECT id FROM settlements WHERE net_payout_amount != gross_amount - commission_amount + shipping_fee'));
  add('R12', 'Marketplace sub-orders have a settlement; direct sub-orders have none',
    await all(`SELECT s.id, s.sales_model FROM sub_orders s JOIN orders o ON o.id = s.parent_order_id WHERE o.legacy_record = 0 AND (
                 (s.sales_model = 'MARKETPLACE' AND NOT EXISTS (SELECT 1 FROM settlements st WHERE st.sub_order_id = s.id))
              OR (s.sales_model = 'DIRECT' AND EXISTS (SELECT 1 FROM settlements st WHERE st.sub_order_id = s.id)))`));
  add('R13', 'Paid direct sub-orders have a supplier purchase order',
    await all(`SELECT s.id FROM sub_orders s JOIN orders o ON o.id = s.parent_order_id WHERE o.paid_at IS NOT NULL AND s.sales_model = 'DIRECT'
               AND NOT EXISTS (SELECT 1 FROM purchase_orders po WHERE po.sub_order_id = s.id)`));
  add('R14', 'Inventory ledger deductions match ordered quantities',
    await all(`SELECT i.id FROM order_items i JOIN sub_orders s ON s.id = i.sub_order_id JOIN orders o ON o.id = s.parent_order_id
               WHERE o.legacy_record = 0 AND COALESCE((SELECT -SUM(quantity_delta) FROM inventory_ledger l WHERE l.reference_id = o.id AND l.sku_id = i.sku_id AND l.change_type = 'PURCHASE_DEDUCT'), 0)
                 != (SELECT SUM(i2.quantity) FROM order_items i2 JOIN sub_orders s2 ON s2.id = i2.sub_order_id WHERE s2.parent_order_id = o.id AND i2.sku_id = i.sku_id)`));
  add('R15', 'No negative stock', await all('SELECT id, stock_quantity FROM product_skus WHERE stock_quantity < 0'));
  add('R16', 'Every non-legacy order is attributed to an operating entity', await all('SELECT id FROM orders WHERE legacy_record = 0 AND operator_entity_id IS NULL'));
  add('R17', 'Journal rows of an order carry the order\'s entity',
    await all('SELECT DISTINCT j.txn_id FROM journal_entries j JOIN orders o ON o.id = j.order_id WHERE COALESCE(j.entity_id, \'\') != COALESCE(o.operator_entity_id, \'\')'));
  const ok = checks.every((c) => c.ok);
  return { ok, checked_at: new Date().toISOString(), checks };
}

export async function handleFinanceRoutes(request, url, env, corsHeaders) {
  const p = url.pathname;
  const isFinance = p.startsWith('/api/v1/admin/finance') || p === '/api/v1/admin/reconciliation' || /^\/api\/v1\/admin\/orders\/[^/]+\/refund$/.test(p) || /^\/api\/v1\/admin\/sub-orders\/[^/]+\/delivered$/.test(p);
  if (!isFinance) return null;
  const admin = await requireAdmin(request, env);

  if (p === '/api/v1/admin/reconciliation' && request.method === 'GET') {
    return json(corsHeaders, { success: true, data: await reconcile(env) });
  }

  if (p === '/api/v1/admin/finance/payouts' && request.method === 'GET') {
    const { results } = await env.DB.prepare('SELECT po.*, pt.business_name FROM payouts po JOIN partners pt ON pt.id = po.partner_id ORDER BY po.created_at DESC LIMIT 200').all();
    const { results: partners } = await env.DB.prepare("SELECT id, business_name FROM partners WHERE sales_model = 'MARKETPLACE'").all();
    const pending = [];
    for (const pt of partners) {
      const pv = await payablePreview(env, pt.id);
      if (pv.settlements.length || pv.carried.length) pending.push({ partner_id: pt.id, business_name: pt.business_name, settlements: pv.settlements.length, carried_adjustments: pv.carried.length, amount: pv.amount });
    }
    return json(corsHeaders, { success: true, data: { payouts: results, pending } });
  }

  if (p === '/api/v1/admin/finance/payouts' && request.method === 'POST') {
    const b = await readJson(request);
    const partner = await env.DB.prepare('SELECT * FROM partners WHERE id = ?').bind(String(b.partner_id || '')).first();
    if (!partner) throw notFound('입점사를 찾을 수 없습니다.');
    if (!Number(partner.payout_account_verified)) throw conflict('PAYOUT_ACCOUNT_UNVERIFIED', '정산 계좌 실명 확인이 완료되지 않았습니다.');
    const pv = await payablePreview(env, partner.id);
    if (!pv.settlements.length && !pv.carried.length) throw conflict('NOTHING_TO_PAY', '지급 대상 정산이 없습니다.');
    if (pv.amount <= 0) throw conflict('NEGATIVE_BALANCE_CARRIED', `정산 후 환불 차감으로 지급액이 ${pv.amount}원입니다. 다음 정산으로 이월됩니다.`, { amount: pv.amount });
    const payoutId = newId('pay');
    const entityId = pv.settlements[0]?.operator_entity_id || pv.carried[0]?.operator_entity_id || null;
    const ids = pv.settlements.map((s) => s.id);
    const st = [
      env.DB.prepare('INSERT INTO payouts (id, partner_id, operator_entity_id, amount, settlement_count, adjustment_count, status, approved_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .bind(payoutId, partner.id, entityId, pv.amount, ids.length, pv.carried.length, 'APPROVED', admin.userId)
    ];
    for (const id of ids) {
      st.push(env.DB.prepare("UPDATE settlements SET status = 'PAID_OUT', payout_id = ?, settled_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'ELIGIBLE_FOR_PAYOUT'").bind(payoutId, id));
      st.push(env.DB.prepare('UPDATE settlement_adjustments SET applied_payout_id = ? WHERE settlement_id = ? AND applied_payout_id IS NULL').bind(payoutId, id));
    }
    for (const a of pv.carried) st.push(env.DB.prepare('UPDATE settlement_adjustments SET applied_payout_id = ? WHERE id = ? AND applied_payout_id IS NULL').bind(payoutId, a.id));
    // Abort if anything changed between preview and commit (concurrent refund/cancel).
    st.push(env.DB.prepare(
      `INSERT INTO batch_assertions (code) SELECT 'PAYOUT_DRIFT' WHERE
         (SELECT COUNT(*) FROM settlements WHERE payout_id = ?) != ? OR
         (SELECT COALESCE(SUM(st.net_payout_amount),0) FROM settlements st WHERE st.payout_id = ?) + (SELECT COALESCE(SUM(net_delta),0) FROM settlement_adjustments WHERE applied_payout_id = ?) != ?`
    ).bind(payoutId, ids.length, payoutId, payoutId, pv.amount));
    st.push(...journalStatements(env, { txnType: 'SELLER_PAYOUT', entityId, lines: [
      { account: ACCOUNTS.SELLER_PAYABLE, debit: pv.amount, partner_id: partner.id },
      { account: ACCOUNTS.BANK, credit: pv.amount, partner_id: partner.id, memo: payoutId }
    ] }));
    st.push(auditStatement(env, admin, { action: 'PAYOUT_APPROVE', targetType: 'partner', targetId: partner.id, after: { payoutId, amount: pv.amount, settlements: ids }, request }));
    await runBatch(env, st);
    return json(corsHeaders, { success: true, data: { payout_id: payoutId, amount: pv.amount, settlement_count: ids.length, bank_transfer: 'MANUAL — 은행 이체 후 /transferred 로 이체 참조번호를 기록하세요.' } }, 201);
  }

  const trM = p.match(/^\/api\/v1\/admin\/finance\/payouts\/([^/]+)\/transferred$/);
  if (trM && request.method === 'POST') {
    const b = await readJson(request);
    const ref = str(b.bank_transfer_ref, { field: '이체 참조번호', max: 100, required: true });
    const r = await env.DB.batch([
      env.DB.prepare("UPDATE payouts SET status = 'TRANSFERRED', bank_transfer_ref = ? WHERE id = ? AND status = 'APPROVED'").bind(ref, trM[1]),
      auditStatement(env, admin, { action: 'PAYOUT_TRANSFERRED', targetType: 'payout', targetId: trM[1], after: { ref }, request })
    ]);
    if (r[0].meta.changes !== 1) throw conflict('PAYOUT_NOT_APPROVED', '승인 상태의 지급 건이 아닙니다.');
    return json(corsHeaders, { success: true });
  }

  if (p === '/api/v1/admin/finance/trial-balance' && request.method === 'GET') {
    const entity = url.searchParams.get('entity_id');
    const { results } = await env.DB.prepare(
      'SELECT entity_id, account_code, SUM(debit) AS debit, SUM(credit) AS credit, SUM(debit) - SUM(credit) AS balance FROM journal_entries WHERE (? IS NULL OR entity_id = ?) GROUP BY entity_id, account_code ORDER BY entity_id, account_code'
    ).bind(entity, entity).all();
    return json(corsHeaders, { success: true, data: results });
  }

  if (p === '/api/v1/admin/finance/journal' && request.method === 'GET') {
    const orderId = url.searchParams.get('order_id');
    const { results } = await env.DB.prepare('SELECT * FROM journal_entries WHERE (? IS NULL OR order_id = ?) ORDER BY created_at DESC, txn_id LIMIT 500').bind(orderId, orderId).all();
    return json(corsHeaders, { success: true, data: results });
  }

  const rfM = p.match(/^\/api\/v1\/admin\/orders\/([^/]+)\/refund$/);
  if (rfM && request.method === 'POST') {
    const b = await readJson(request);
    const reason = str(b.reason, { field: '환불 사유', max: 200, required: true });
    const lines = Array.isArray(b.lines) ? b.lines.map((l) => ({ order_item_id: String(l.order_item_id), quantity: Number(l.quantity) })) : [];
    const ship = Array.isArray(b.shipping_sub_order_ids) ? b.shipping_sub_order_ids.map(String) : [];
    if (!lines.length && !ship.length) throw bad('NOTHING_TO_REFUND', '환불 항목을 지정해 주세요.');
    const r = await refundOrder(env, admin, rfM[1], { lines, shippingSubOrderIds: ship, reasonCode: `ADMIN:${reason}`.slice(0, 100), restock: b.restock === true, idemKey: request.headers.get('X-Idempotency-Key') || undefined });
    await env.DB.prepare('INSERT INTO admin_audit_log (id, actor_user_id, actor_role, action, target_type, target_id, after_json) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .bind(newId('aud'), admin.userId, admin.role, 'MANUAL_REFUND', 'order', rfM[1], JSON.stringify({ lines, ship, reason, refund: r.refund && r.refund.id })).run();
    return json(corsHeaders, { success: true, data: r });
  }

  const dlM = p.match(/^\/api\/v1\/admin\/sub-orders\/([^/]+)\/delivered$/);
  if (dlM && request.method === 'POST') {
    const b = await readJson(request);
    const evidence = str(b.evidence, { field: '배송완료 근거(택배사 조회 결과 등)', max: 300, required: true });
    const r = await env.DB.batch([
      env.DB.prepare("UPDATE sub_orders SET status = 'DELIVERED', delivered_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status IN ('SHIPPED','IN_TRANSIT')").bind(dlM[1]),
      auditStatement(env, admin, { action: 'MANUAL_DELIVERED', targetType: 'sub_order', targetId: dlM[1], after: { evidence }, request })
    ]);
    if (r[0].meta.changes !== 1) throw conflict('NOT_IN_TRANSIT', '출고(배송중) 상태의 주문만 배송완료 처리할 수 있습니다.');
    return json(corsHeaders, { success: true });
  }

  return null;
}

export { loadOrderBundle };
