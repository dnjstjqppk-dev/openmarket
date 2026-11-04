// apps/cloudflare-gateway/src/routes/temu-ops.js
// Customer-care & supply-chain extras: late-delivery compensation, real sales stats, sample QC, IPR reports.
// (Reviews are handled in features.js — the duplicate handler that shadowed it was removed.)

import { requireAuth, requireCustomer, requireAdmin } from '../lib/auth.js';
import { json, readJson, bad, conflict, forbidden, notFound, str } from '../lib/http.js';
import { newId, sqlNow } from '../lib/ids.js';
import { grantCreditStatements, auditStatement } from '../lib/ledger.js';

const LATE_COMPENSATION_KRW = 5300;

export async function handleTemuOpsRoutes(request, url, env, corsHeaders) {
  const p = url.pathname;

  // 1. Late delivery guarantee: owner only, only when the promised date has actually passed.
  const lateM = p.match(/^\/api\/v1\/orders\/([^/]+)\/late-delivery-claim$/);
  if (lateM && request.method === 'POST') {
    const me = await requireCustomer(request, env);
    const order = await env.DB.prepare('SELECT * FROM orders WHERE id = ? OR order_no = ?').bind(lateM[1], lateM[1]).first();
    if (!order) throw notFound('주문을 찾을 수 없습니다.');
    if (order.customer_id !== me.userId) throw forbidden();
    const { results: subs } = await env.DB.prepare('SELECT * FROM sub_orders WHERE parent_order_id = ?').bind(order.id).all();
    const now = sqlNow();
    const late = subs.filter((s) => Number(s.is_late_compensated) === 0 && s.estimated_delivery_date
      && !['CANCELLED', 'EXPIRED', 'PAYMENT_PENDING'].includes(s.status)
      && ((s.delivered_at && s.delivered_at > s.estimated_delivery_date) || (!s.delivered_at && now > s.estimated_delivery_date)));
    if (!late.length) throw conflict('NOT_LATE', '배송 예정일을 초과한 미보상 주문이 없습니다.');
    const st = [];
    for (const s of late) {
      st.push(env.DB.prepare('UPDATE sub_orders SET is_late_compensated = 1, late_compensation_amount = ? WHERE id = ? AND is_late_compensated = 0').bind(LATE_COMPENSATION_KRW, s.id));
      st.push(env.DB.prepare("INSERT INTO idempotency_keys (scope, idem_key, principal_id, reference_id) VALUES ('LATE_COMPENSATION', ?, ?, ?)").bind(s.id, me.userId, order.id));
      st.push(...grantCreditStatements(env, { userId: me.userId, amount: LATE_COMPENSATION_KRW, reason: '배송 지연 보상', referenceId: s.id, entityId: order.operator_entity_id, txnType: 'LATE_DELIVERY_COMPENSATION' }));
    }
    try { await env.DB.batch(st); } catch (e) {
      if (String(e.message).includes('UNIQUE')) throw conflict('ALREADY_COMPENSATED', '이미 보상이 지급되었습니다.');
      throw e;
    }
    const amount = LATE_COMPENSATION_KRW * late.length;
    return json(corsHeaders, { success: true, data: { order_id: order.id, compensated_sub_orders: late.length, compensation_amount: amount } });
  }

  // 2. Sales stats: measured values only (no fabricated viewers / countdowns).
  const statM = p.match(/^\/api\/v1\/products\/([^/]+)\/urgency-stats$/);
  if (statM && request.method === 'GET') {
    const sold24h = await env.DB.prepare(
      `SELECT COALESCE(SUM(i.quantity - i.refunded_quantity), 0) AS q FROM order_items i JOIN sub_orders s ON s.id = i.sub_order_id JOIN orders o ON o.id = s.parent_order_id
       WHERE i.product_id = ? AND o.paid_at IS NOT NULL AND o.paid_at >= ?`
    ).bind(statM[1], sqlNow(-24 * 3600 * 1000)).first('q');
    const stock = await env.DB.prepare('SELECT COALESCE(SUM(stock_quantity), 0) AS s FROM product_skus WHERE product_id = ?').bind(statM[1]).first('s');
    return json(corsHeaders, { success: true, data: { product_id: statM[1], recent_24h_sales: sold24h, total_stock: stock, low_stock: stock > 0 && stock <= 5, late_compensation_krw: LATE_COMPENSATION_KRW } });
  }

  // 3. Factory sample QC (partner submits, admin inspects)
  if (p === '/api/v1/partner/sample-qc') {
    const me = await requireAuth(request, env, ['ROLE_PARTNER']);
    if (!me.partnerId) throw forbidden();
    if (request.method === 'GET') {
      const { results } = await env.DB.prepare('SELECT * FROM sample_qc_requests WHERE partner_id = ? ORDER BY created_at DESC').bind(me.partnerId).all();
      return json(corsHeaders, { success: true, count: results.length, data: results });
    }
    if (request.method === 'POST') {
      const b = await readJson(request);
      if (b.product_id) {
        const own = await env.DB.prepare('SELECT id FROM products WHERE id = ? AND partner_id = ?').bind(b.product_id, me.partnerId).first();
        if (!own) throw forbidden('본인 상품만 검수 신청할 수 있습니다.');
      }
      const id = newId('qc');
      await env.DB.prepare(`INSERT INTO sample_qc_requests (id, partner_id, product_id, product_title, sample_tracking_no, carrier, status) VALUES (?, ?, ?, ?, ?, ?, 'IN_INSPECTION')`)
        .bind(id, me.partnerId, b.product_id || null, str(b.product_title, { field: '상품명', max: 200, required: true }), str(b.sample_tracking_no, { field: '샘플 송장번호', max: 40, required: true }), str(b.carrier, { max: 40 }) || 'CJ대한통운').run();
      return json(corsHeaders, { success: true, data: { id, status: 'IN_INSPECTION' } }, 201);
    }
  }

  if (p === '/api/v1/admin/sample-qc' && request.method === 'GET') {
    await requireAdmin(request, env);
    const { results } = await env.DB.prepare('SELECT q.*, p.business_name FROM sample_qc_requests q LEFT JOIN partners p ON q.partner_id = p.id ORDER BY q.created_at DESC').all();
    return json(corsHeaders, { success: true, count: results.length, data: results });
  }

  const qcM = p.match(/^\/api\/v1\/admin\/sample-qc\/([^/]+)\/inspect$/);
  if (qcM && request.method === 'POST') {
    const admin = await requireAdmin(request, env);
    const b = await readJson(request);
    if (!['APPROVED', 'REJECTED', 'CONDITIONAL'].includes(b.decision)) throw bad('INVALID_DECISION', 'decision 값이 올바르지 않습니다.');
    const notes = str(b.inspector_notes, { field: '검수 의견', max: 1000, required: true });
    const r = await env.DB.batch([
      env.DB.prepare("UPDATE sample_qc_requests SET status = ?, inspector_notes = ?, inspected_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'IN_INSPECTION'").bind(b.decision, notes, qcM[1]),
      auditStatement(env, admin, { action: 'SAMPLE_QC_INSPECT', targetType: 'sample_qc', targetId: qcM[1], after: { decision: b.decision, notes }, request })
    ]);
    if (r[0].meta.changes !== 1) throw conflict('NOT_IN_INSPECTION', '검수 대기 상태가 아닙니다.');
    return json(corsHeaders, { success: true, data: { id: qcM[1], status: b.decision, inspector_notes: notes } });
  }

  // 4. IPR notice: recorded for operator review. Products are never hidden by an unverified report.
  if (p === '/api/v1/ipr/report' && request.method === 'POST') {
    const me = await requireAuth(request, env);
    const b = await readJson(request);
    const target = str(b.target_product_id, { field: '대상 상품', max: 100, required: true });
    const prod = await env.DB.prepare('SELECT id FROM products WHERE id = ?').bind(target).first();
    if (!prod) throw notFound('대상 상품을 찾을 수 없습니다.');
    const id = newId('ipr');
    await env.DB.prepare(`INSERT INTO ipr_takedown_reports (id, reporter_name, brand_name, target_product_id, infringement_type, evidence_url, status) VALUES (?, ?, ?, ?, ?, ?, 'SUBMITTED')`)
      .bind(id, `${str(b.reporter_name, { field: '신고자', max: 100, required: true })} <${me.userId}>`, str(b.brand_name, { field: '권리 브랜드', max: 100, required: true }), target,
        ['COUNTERFEIT', 'TRADEMARK', 'COPYRIGHT', 'DESIGN', 'PATENT'].includes(b.infringement_type) ? b.infringement_type : 'COUNTERFEIT',
        str(b.evidence_url, { field: '증빙 자료', max: 500, required: true })).run();
    return json(corsHeaders, { success: true, message: '권리침해 신고가 접수되었습니다. 운영자 검토 후 조치됩니다.', data: { report_id: id, status: 'SUBMITTED' } }, 201);
  }

  if (p === '/api/v1/admin/ipr-reports' && request.method === 'GET') {
    await requireAdmin(request, env);
    const { results } = await env.DB.prepare('SELECT r.*, p.title as product_title, p.partner_id FROM ipr_takedown_reports r LEFT JOIN products p ON r.target_product_id = p.id ORDER BY r.created_at DESC').all();
    return json(corsHeaders, { success: true, count: results.length, data: results });
  }

  return null;
}
