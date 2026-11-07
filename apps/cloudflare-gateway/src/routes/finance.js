// apps/cloudflare-gateway/src/routes/finance.js
// Operator finance: seller payouts, journal / trial balance, manual refunds & delivery, and full reconciliation.

import { requireAdmin, requireAuth } from '../lib/auth.js';
import { json, readJson, bad, conflict, notFound, str } from '../lib/http.js';
import { newId } from '../lib/ids.js';
import { ACCOUNTS, journalStatements, auditStatement, getActiveOperator } from '../lib/ledger.js';
import { validateKoreanBrnChecksum } from './onboarding.js';

// Payment methods a 현금영수증 can be issued for. Toss reports Korean names; card/coupon payments are excluded.
const CASH_RECEIPT_METHODS = new Set(['가상계좌', '계좌이체', 'TRANSFER', 'VIRTUAL_ACCOUNT']);
const maskId = (v) => { const t = String(v || ''); return t.length <= 4 ? '****' : '*'.repeat(t.length - 4) + t.slice(-4); };
const maskReceipt = (r) => (r ? { ...r, buyer_identifier: maskId(r.buyer_identifier) } : r);
import { refundOrder, runBatch, loadOrderBundle } from '../services/orders.js';

// A payout is always for ONE operating entity: after a 개인사업자 -> 법인 switch, settlements of each entity are
// paid (and journalled) separately, oldest entity first. `other_entities_pending` tells the caller to run again.
async function payablePreview(env, partnerId) {
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

/** partners.rolling_reserve_pct (REAL percent) -> integer basis points, capped at 50%. */
export function reserveBpsOf(pct) {
  const bps = Math.round(Number(pct || 0) * 100);
  if (!Number.isFinite(bps) || bps <= 0) return 0;
  return Math.min(bps, 5000);
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
  add('R18', 'Payout arithmetic: wired = gross - reserve held + reserve released, and both reserve legs match their hold rows',
    await all(`SELECT po.id, po.amount, po.gross_amount, po.reserve_held, po.reserve_released FROM payouts po WHERE
                 po.amount != COALESCE(po.gross_amount, po.amount) - po.reserve_held + po.reserve_released
              OR po.reserve_held != (SELECT COALESCE(SUM(amount),0) FROM payout_reserve_holds h WHERE h.held_by_payout_id = po.id)
              OR po.reserve_released != (SELECT COALESCE(SUM(amount),0) FROM payout_reserve_holds h WHERE h.released_payout_id = po.id)
              OR COALESCE(po.gross_amount, po.amount) != (SELECT COALESCE(SUM(net_payout_amount),0) FROM settlements st WHERE st.payout_id = po.id)
                                                         + (SELECT COALESCE(SUM(net_delta),0) FROM settlement_adjustments a WHERE a.applied_payout_id = po.id)`));
  add('R19', 'Every payout and reserve hold is for a single operating entity',
    await all(`SELECT po.id FROM payouts po WHERE
                 EXISTS (SELECT 1 FROM settlements st WHERE st.payout_id = po.id AND COALESCE(st.operator_entity_id,'') != COALESCE(po.operator_entity_id,''))
              OR EXISTS (SELECT 1 FROM settlement_adjustments a JOIN settlements st ON st.id = a.settlement_id WHERE a.applied_payout_id = po.id AND COALESCE(st.operator_entity_id,'') != COALESCE(po.operator_entity_id,''))
              OR EXISTS (SELECT 1 FROM payout_reserve_holds h WHERE (h.held_by_payout_id = po.id OR h.released_payout_id = po.id) AND COALESCE(h.operator_entity_id,'') != COALESCE(po.operator_entity_id,''))`));
  add('R20', 'Refund money identity: PG + credit + withheld return fee = refunded item and shipping shares',
    await all(`SELECT r.id, r.pg_amount, r.credit_amount, r.return_fee_amount FROM refunds r WHERE r.status IN ('PENDING','DONE')
               AND r.pg_amount + r.credit_amount + r.return_fee_amount != (SELECT COALESCE(SUM(COALESCE(json_extract(j.value, '$.pg'),0) + COALESCE(json_extract(j.value, '$.credit'),0)),0) FROM json_each(r.items_json) j)`));
  add('R21', 'Order refunded totals + withheld return fees = refunded item shares + refunded shipping shares',
    await all(`SELECT o.id FROM orders o WHERE o.legacy_record = 0 AND
                 o.refunded_pg_amount + o.refunded_credit_amount + (SELECT COALESCE(SUM(return_fee_amount),0) FROM refunds r WHERE r.order_id = o.id AND r.status IN ('PENDING','DONE'))
              != (SELECT COALESCE(SUM(i.refunded_pg_amount + i.refunded_credit_amount),0) FROM order_items i JOIN sub_orders s ON s.id = i.sub_order_id WHERE s.parent_order_id = o.id)
               + (SELECT COALESCE(SUM(s.shipping_pg_alloc + s.shipping_credit_alloc),0) FROM sub_orders s WHERE s.parent_order_id = o.id AND s.shipping_refunded = 1)`));
  // R22/R23 cover what R05/R12 cannot see: they ignore legacy rows and orders without paid_at, which is exactly
  // where pre-V3 code left "PAID" orders with no payment and payable settlements on cancelled orders (d1_31/d1_32).
  add('R22', 'Orders in a paid state have paid_at and, when PG was charged, a PG capture (legacy included)',
    await all(`SELECT o.id, o.payment_status, o.paid_at, o.total_pay_amount FROM orders o
               WHERE o.payment_status IN ('PAID', 'PARTIAL_REFUNDED', 'REFUNDED', 'DELIVERED')
                 AND (o.paid_at IS NULL OR (o.total_pay_amount > 0 AND NOT EXISTS (
                      SELECT 1 FROM payment_transactions t WHERE t.order_id = o.id AND t.status != 'FAILED')))`));
  add('R23', 'Open settlements belong to paid, live sub-orders (no payable on cancelled/expired or unpaid orders)',
    await all(`SELECT st.id, st.status, s.status AS sub_status, o.payment_status FROM settlements st
               JOIN sub_orders s ON s.id = st.sub_order_id JOIN orders o ON o.id = s.parent_order_id
               WHERE st.payout_id IS NULL AND (
                    (st.status IN ('HOLD', 'PENDING', 'ELIGIBLE_FOR_PAYOUT') AND s.status IN ('CANCELLED', 'EXPIRED'))
                 OR (st.status IN ('PENDING', 'ELIGIBLE_FOR_PAYOUT') AND o.paid_at IS NULL))`));
  const ok = checks.every((c) => c.ok);
  return { ok, checked_at: new Date().toISOString(), checks };
}

/**
 * O19: run reconciliation, persist the outcome, and alert on failure.
 * Alert channel: ALERT_WEBHOOK_URL (Slack/Discord-compatible JSON POST). No channel -> 'NO_CHANNEL' is recorded,
 * and the failure is still logged at level=error so Workers Logs / Logpush alerting can pick it up.
 */
export async function recordReconciliation(env, source, { fetchImpl = globalThis.fetch } = {}) {
  const started = Date.now();
  const result = await reconcile(env);
  const failed = result.checks.filter((c) => !c.ok).map((c) => ({ id: c.id, name: c.name, violation_count: c.violation_count }));
  let alert = 'NOT_NEEDED';
  if (failed.length) {
    console.error(JSON.stringify({ level: 'error', job: 'reconciliation', source, failed }));
    if (env.ALERT_WEBHOOK_URL) {
      try {
        const text = `[OLMOA ${env.ENVIRONMENT || 'unset'}] 데이터 대사 실패 ${failed.length}건: ${failed.map((f) => `${f.id}(${f.violation_count})`).join(', ')}`;
        const res = await fetchImpl(String(env.ALERT_WEBHOOK_URL), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, content: text, failed }) });
        alert = res && res.ok ? 'SENT' : 'FAILED';
      } catch {
        alert = 'FAILED';
      }
    } else {
      alert = 'NO_CHANNEL';
    }
  }
  const id = newId('rec');
  await env.DB.prepare('INSERT INTO reconciliation_runs (id, trigger_source, ok, check_count, failed_checks_json, alert_status, duration_ms) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(id, source, result.ok ? 1 : 0, result.checks.length, JSON.stringify(failed), alert, Date.now() - started).run();
  return { ...result, run_id: id, alert_status: alert };
}

/** Cron gate: run at most once per `intervalMinutes` (the Worker cron fires every 5 minutes). */
export async function reconcileIfDue(env, intervalMinutes = 60) {
  const last = await env.DB.prepare("SELECT created_at FROM reconciliation_runs WHERE trigger_source = 'CRON' ORDER BY rowid DESC LIMIT 1").first('created_at');
  if (last) {
    const due = await env.DB.prepare('SELECT CASE WHEN ? <= datetime(\'now\', ?) THEN 1 ELSE 0 END AS d').bind(last, `-${intervalMinutes} minutes`).first('d');
    if (!due) return null;
  }
  return recordReconciliation(env, 'CRON');
}

export async function handleFinanceRoutes(request, url, env, corsHeaders) {
  const p = url.pathname;

  // ---- Cash receipts (현금영수증) ---------------------------------------------------------------------------
  // There is NO 국세청/PG cash-receipt API integration yet. A buyer can only REQUEST one; an operator issues it
  // (PG 관리자 또는 홈택스) and records the real approval number. Nothing here may claim an NTS approval.
  if (p === '/api/v1/finance/cash-receipts/request' && request.method === 'POST') {
    const viewer = await requireAuth(request, env, ['ROLE_CUSTOMER']);
    const b = await readJson(request);
    const orderId = str(b.order_id, { field: '주문 ID', required: true });
    const rawIdentity = str(b.buyer_identifier ?? b.identity_number, { field: '발행 식별번호(휴대폰/사업자번호)', max: 20, required: true }).replace(/[^0-9]/g, '');
    const idType = ['PHONE', 'BUSINESS_REG_NO'].includes(b.identifier_type) ? b.identifier_type
      : (b.receipt_type === 'BUSINESS' ? 'BUSINESS_REG_NO' : 'PHONE');
    if (idType === 'PHONE' && !/^01[016789]\d{7,8}$/.test(rawIdentity)) throw bad('INVALID_IDENTIFIER', '휴대폰 번호 형식이 올바르지 않습니다.');
    if (idType === 'BUSINESS_REG_NO' && !validateKoreanBrnChecksum(rawIdentity).valid) throw bad('INVALID_IDENTIFIER', '사업자등록번호가 올바르지 않습니다.');

    // Ownership: a buyer can only request a receipt for their own order (no order-number enumeration).
    const order = await env.DB.prepare('SELECT * FROM orders WHERE (id = ? OR order_no = ?) AND customer_id = ?').bind(orderId, orderId, viewer.userId).first();
    if (!order) throw notFound('주문을 찾을 수 없습니다.');
    if (order.payment_status !== 'PAID') throw bad('ORDER_NOT_PAID', '결제 완료된 주문에 대해서만 현금영수증을 신청할 수 있습니다.');
    const pay = await env.DB.prepare("SELECT method FROM payment_transactions WHERE order_id = ? AND status = 'DONE' ORDER BY created_at DESC LIMIT 1").bind(order.id).first();
    if (!pay || !CASH_RECEIPT_METHODS.has(String(pay.method || '').toUpperCase())) {
      throw bad('NOT_CASH_PAYMENT', '현금영수증은 계좌이체·가상계좌 결제에만 발행됩니다. 카드 결제는 카드 매출전표가 증빙입니다.');
    }
    const existing = await env.DB.prepare("SELECT * FROM tax_invoices WHERE order_id = ? AND invoice_type = 'CASH_RECEIPT' AND issue_status IN ('REQUESTED','ISSUED')").bind(order.id).first();
    if (existing) return json(corsHeaders, { success: true, already_requested: true, data: maskReceipt(existing) });

    const total = Number(order.total_pay_amount);
    const supply = Math.round(total / 1.1); // assumes all lines are VAT-taxable; tax-free goods are not modelled yet
    const operator = await getActiveOperator(env);
    const row = {
      id: newId('txi'), invoice_type: 'CASH_RECEIPT', order_id: order.id, buyer_identifier: rawIdentity, identifier_type: idType,
      supply_amount: supply, vat_amount: total - supply, total_amount: total, issue_status: 'REQUESTED',
      hometax_approval_no: null, item_title: `주문 ${order.order_no}`, issuer_entity_id: order.operator_entity_id || operator?.id || null
    };
    await env.DB.prepare(
      `INSERT INTO tax_invoices (id, invoice_type, order_id, buyer_identifier, identifier_type, supply_amount, vat_amount, total_amount, issue_status, hometax_approval_no, item_title, issuer_entity_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(row.id, row.invoice_type, row.order_id, row.buyer_identifier, row.identifier_type, row.supply_amount, row.vat_amount,
      row.total_amount, row.issue_status, row.hometax_approval_no, row.item_title, row.issuer_entity_id).run();
    return json(corsHeaders, {
      success: true,
      message: '현금영수증 발행 요청이 접수되었습니다. 운영자가 발행하면 승인번호가 표시됩니다.',
      data: maskReceipt(row)
    }, 201);
  }

  const crLookupM = p.match(/^\/api\/v1\/finance\/cash-receipts\/([^/]+)$/);
  if (crLookupM && request.method === 'GET') {
    const viewer = await requireAuth(request, env, ['ROLE_CUSTOMER', 'ROLE_ADMIN']);
    const isOp = viewer.role === 'ROLE_ADMIN';
    const receipt = await env.DB.prepare(
      `SELECT t.* FROM tax_invoices t JOIN orders o ON o.id = t.order_id
       WHERE (o.id = ? OR o.order_no = ?) AND t.invoice_type = 'CASH_RECEIPT'${isOp ? '' : ' AND o.customer_id = ?'}
       ORDER BY t.created_at DESC LIMIT 1`
    ).bind(crLookupM[1], crLookupM[1], ...(isOp ? [] : [viewer.userId])).first();
    if (!receipt) throw notFound('현금영수증 신청 내역이 없습니다.');
    return json(corsHeaders, { success: true, data: maskReceipt(receipt) });
  }

  // Operator list (permission finance.read via the admin-policy rule for /api/v1/finance/).
  if (p === '/api/v1/finance/tax-invoices' && request.method === 'GET') {
    await requireAdmin(request, env);
    const { results } = await env.DB.prepare('SELECT * FROM tax_invoices ORDER BY created_at DESC LIMIT 100').all();
    return json(corsHeaders, { success: true, count: results.length, data: results.map(maskReceipt) });
  }

  // Operator records the issuance done in the PG console / 홈택스, with the real approval number.
  const crIssueM = p.match(/^\/api\/v1\/admin\/finance\/cash-receipts\/([^/]+)\/(issue|fail)$/);
  if (crIssueM && request.method === 'POST') {
    const admin = await requireAdmin(request, env);
    const b = await readJson(request);
    const row = await env.DB.prepare("SELECT * FROM tax_invoices WHERE id = ? AND invoice_type = 'CASH_RECEIPT'").bind(crIssueM[1]).first();
    if (!row) throw notFound('현금영수증 신청 건을 찾을 수 없습니다.');
    if (row.issue_status !== 'REQUESTED') throw conflict('NOT_REQUESTED', `발행 대기 상태에서만 처리할 수 있습니다. (현재: ${row.issue_status})`);
    const issuing = crIssueM[2] === 'issue';
    let upd;
    if (issuing) {
      const approval = str(b.hometax_approval_no, { field: '국세청 승인번호', max: 40, required: true });
      if (!/^[0-9A-Za-z-]{6,40}$/.test(approval)) throw bad('INVALID_APPROVAL_NO', '승인번호 형식이 올바르지 않습니다.');
      upd = env.DB.prepare("UPDATE tax_invoices SET issue_status = 'ISSUED', hometax_approval_no = ?, issued_at = CURRENT_TIMESTAMP, memo = ? WHERE id = ? AND issue_status = 'REQUESTED'")
        .bind(approval, str(b.memo, { max: 300 }) || null, row.id);
    } else {
      upd = env.DB.prepare("UPDATE tax_invoices SET issue_status = 'FAILED', memo = ? WHERE id = ? AND issue_status = 'REQUESTED'")
        .bind(str(b.reason, { field: '사유', max: 300, required: true }), row.id);
    }
    const r = await env.DB.batch([upd, auditStatement(env, admin, { action: issuing ? 'CASH_RECEIPT_ISSUE' : 'CASH_RECEIPT_FAIL', targetType: 'tax_invoice', targetId: row.id, before: { issue_status: row.issue_status }, request })]);
    if (r[0].meta.changes !== 1) throw conflict('NOT_REQUESTED', '다른 운영자가 먼저 처리했습니다.');
    return json(corsHeaders, { success: true, id: row.id, issue_status: issuing ? 'ISSUED' : 'FAILED' });
  }

  const isFinance = p.startsWith('/api/v1/admin/finance') || p === '/api/v1/admin/reconciliation' || /^\/api\/v1\/admin\/orders\/[^/]+\/refund$/.test(p) || /^\/api\/v1\/admin\/sub-orders\/[^/]+\/delivered$/.test(p);
  if (!isFinance) return null;
  const admin = await requireAdmin(request, env);

  if (p === '/api/v1/admin/reconciliation' && request.method === 'GET') {
    return json(corsHeaders, { success: true, data: await recordReconciliation(env, 'MANUAL') });
  }

  if (p === '/api/v1/admin/finance/reconciliation-runs' && request.method === 'GET') {
    const { results } = await env.DB.prepare('SELECT * FROM reconciliation_runs ORDER BY rowid DESC LIMIT 100').all();
    const rows = results.map((r) => ({ ...r, ok: Boolean(r.ok), failed_checks: JSON.parse(r.failed_checks_json || '[]') }));
    const lastCron = rows.find((r) => r.trigger_source === 'CRON') || null;
    return json(corsHeaders, { success: true, data: { runs: rows, last_cron: lastCron, alert_channel_configured: Boolean(env.ALERT_WEBHOOK_URL) } });
  }

  if (p === '/api/v1/admin/finance/reserve-holds' && request.method === 'GET') {
    const partnerId = url.searchParams.get('partner_id');
    const { results } = await env.DB.prepare(
      `SELECT h.*, pt.business_name, CASE WHEN h.released_payout_id IS NULL AND h.release_after <= datetime('now') THEN 1 ELSE 0 END AS releasable
       FROM payout_reserve_holds h JOIN partners pt ON pt.id = h.partner_id WHERE (? IS NULL OR h.partner_id = ?) ORDER BY h.created_at DESC LIMIT 500`
    ).bind(partnerId, partnerId).all();
    return json(corsHeaders, { success: true, data: results });
  }

  if (p === '/api/v1/admin/finance/payouts' && request.method === 'GET') {
    const { results } = await env.DB.prepare('SELECT po.*, pt.business_name FROM payouts po JOIN partners pt ON pt.id = po.partner_id ORDER BY po.created_at DESC LIMIT 200').all();
    const { results: partners } = await env.DB.prepare("SELECT id, business_name FROM partners WHERE sales_model = 'MARKETPLACE'").all();
    const pending = [];
    for (const pt of partners) {
      const pv = await payablePreview(env, pt.id);
      if (pv.settlements.length || pv.carried.length || pv.releasable.length || pv.reserve_outstanding) {
        pending.push({
          partner_id: pt.id, business_name: pt.business_name, settlements: pv.settlements.length, carried_adjustments: pv.carried.length,
          gross_amount: pv.gross, reserve_to_hold: pv.held, reserve_to_release: pv.released, amount: pv.amount,
          reserve_outstanding: pv.reserve_outstanding, next_reserve_release: pv.next_release
        });
      }
    }
    return json(corsHeaders, { success: true, data: { payouts: results, pending } });
  }

  function payoutPayload(p) {
    return { payout_id: p.id, amount: p.amount, gross_amount: p.gross_amount, reserve_held: p.reserve_held, reserve_released: p.reserve_released, reserve_release_days: p.reserve_release_days ?? null, operator_entity_id: p.operator_entity_id, other_entities_pending: Boolean(p.other_entities_pending), settlement_count: p.settlement_count, bank_transfer: 'MANUAL — 은행 이체 후 /transferred 로 이체 참조번호를 기록하세요.' };
  }

  if (p === '/api/v1/admin/finance/payouts' && request.method === 'POST') {
    const b = await readJson(request);
    const idemKey = request.headers.get('X-Idempotency-Key') || b.idempotency_key || null;
    if (idemKey && !/^[A-Za-z0-9_.:-]{8,100}$/.test(idemKey)) throw bad('INVALID_IDEMPOTENCY_KEY', '멱등성 키 형식이 올바르지 않습니다.');
    if (idemKey) {
      const prior = await env.DB.prepare('SELECT * FROM payouts WHERE idempotency_key = ?').bind(idemKey).first();
      if (prior) return json(corsHeaders, { success: true, idempotent_replay: true, data: payoutPayload(prior) });
    }
    const partner = await env.DB.prepare('SELECT * FROM partners WHERE id = ?').bind(String(b.partner_id || '')).first();
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
        .bind(payoutId, partner.id, entityId, pv.amount, pv.gross, pv.held, pv.released, ids.length, pv.carried.length, 'APPROVED', admin.userId, idemKey, releaseDays, pv.other_entities_pending ? 1 : 0)
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
    st.push(auditStatement(env, admin, { action: 'PAYOUT_APPROVE', targetType: 'partner', targetId: partner.id, after: { payoutId, amount: pv.amount, gross: pv.gross, reserveHeld: pv.held, reserveReleased: pv.released, settlements: ids }, request }));
    try {
      await runBatch(env, st);
    } catch (e) {
      // Lost a same-key race: the winner's row is the answer, not an error.
      if (idemKey && String(e.message).includes('idempotency_key')) {
        const winner = await env.DB.prepare('SELECT * FROM payouts WHERE idempotency_key = ?').bind(idemKey).first();
        if (winner) return json(corsHeaders, { success: true, idempotent_replay: true, data: payoutPayload(winner) });
      }
      throw e;
    }
    const created = await env.DB.prepare('SELECT * FROM payouts WHERE id = ?').bind(payoutId).first();
    return json(corsHeaders, { success: true, data: payoutPayload(created) }, 201);
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
