// apps/cloudflare-gateway/src/routes/suppliers.js
// MODEL A (operator direct sales of sourced B2B goods): suppliers, SKU sourcing with resale authorisation,
// purchase orders. Supplier API dispatch is NOT integrated: POs are dispatched manually and tracked here.

import { requireAdmin } from '../lib/auth.js';
import { json, readJson, bad, conflict, notFound, str, intParam } from '../lib/http.js';
import { newId } from '../lib/ids.js';
import { auditStatement, getActiveOperator } from '../lib/ledger.js';

const PO_TRANSITIONS = {
  DRAFT: ['SENT', 'CANCELLED'],
  SENT: ['CONFIRMED', 'FAILED', 'CANCELLED'],
  CONFIRMED: ['SHIPPED', 'FAILED'],
  FAILED: ['SENT', 'CANCELLED'],
  SHIPPED: [],
  CANCELLED: []
};

export async function handleSupplierRoutes(request, url, env, corsHeaders) {
  const p = url.pathname;
  const isSupplierPath = p.startsWith('/api/v1/admin/suppliers') || p.startsWith('/api/v1/admin/supplier-mappings') || p.startsWith('/api/v1/admin/purchase-orders') || /^\/api\/v1\/admin\/partners\/[^/]+\/sales-model$/.test(p);
  if (!isSupplierPath) return null;
  const admin = await requireAdmin(request, env);

  if (p === '/api/v1/admin/suppliers' && request.method === 'GET') {
    const { results } = await env.DB.prepare(
      `SELECT s.*, (SELECT COUNT(*) FROM supplier_sku_mappings m WHERE m.supplier_id = s.id AND m.is_active = 1) AS active_mappings,
              (SELECT COUNT(*) FROM purchase_orders po WHERE po.supplier_id = s.id AND po.status IN ('DRAFT','SENT','CONFIRMED')) AS open_pos
       FROM suppliers s ORDER BY s.created_at DESC`
    ).all();
    return json(corsHeaders, { success: true, count: results.length, data: results });
  }

  if (p === '/api/v1/admin/suppliers' && request.method === 'POST') {
    const b = await readJson(request);
    const row = {
      id: newId('sup'), name: str(b.name, { field: '공급사명', max: 100, required: true }),
      business_reg_number: str(b.business_reg_number, { max: 20 }) || null, contact_name: str(b.contact_name, { max: 50 }) || null,
      contact_phone: str(b.contact_phone, { max: 30 }) || null, contact_email: str(b.contact_email, { max: 254 }) || null,
      contract_ref: str(b.contract_ref, { max: 200 }) || null
    };
    await env.DB.batch([
      env.DB.prepare('INSERT INTO suppliers (id, name, business_reg_number, contact_name, contact_phone, contact_email, contract_ref) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .bind(row.id, row.name, row.business_reg_number, row.contact_name, row.contact_phone, row.contact_email, row.contract_ref),
      auditStatement(env, admin, { action: 'SUPPLIER_CREATE', targetType: 'supplier', targetId: row.id, after: row, request })
    ]);
    return json(corsHeaders, { success: true, data: row }, 201);
  }

  const supM = p.match(/^\/api\/v1\/admin\/suppliers\/([^/]+)(?:\/(mappings))?$/);
  if (supM) {
    const sup = await env.DB.prepare('SELECT * FROM suppliers WHERE id = ?').bind(supM[1]).first();
    if (!sup) throw notFound('공급사를 찾을 수 없습니다.');
    if (supM[2] === 'mappings' && request.method === 'GET') {
      const { results } = await env.DB.prepare(
        `SELECT m.*, s.sku_code, s.sale_price, p.title AS product_title, p.id AS product_id
         FROM supplier_sku_mappings m JOIN product_skus s ON s.id = m.sku_id JOIN products p ON p.id = s.product_id
         WHERE m.supplier_id = ? ORDER BY m.is_active DESC, m.created_at DESC`
      ).bind(sup.id).all();
      return json(corsHeaders, { success: true, count: results.length, data: results.map((r) => ({ ...r, margin_amount: r.sale_price - r.unit_cost })) });
    }
    if (!supM[2] && (request.method === 'PUT' || request.method === 'PATCH')) {
      const b = await readJson(request);
      const status = b.status && ['ACTIVE', 'SUSPENDED', 'TERMINATED'].includes(b.status) ? b.status : sup.status;
      if (b.api_integration_status && b.api_integration_status !== sup.api_integration_status) {
        throw conflict('API_STATUS_MANAGED_BY_ENGINEERING', '공급사 API 연동 상태는 실제 연동 배포 시에만 변경됩니다.');
      }
      await env.DB.batch([
        env.DB.prepare('UPDATE suppliers SET name = ?, contact_name = ?, contact_phone = ?, contact_email = ?, contract_ref = ?, status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
          .bind(str(b.name ?? sup.name, { max: 100, required: true }), b.contact_name ?? sup.contact_name, b.contact_phone ?? sup.contact_phone, b.contact_email ?? sup.contact_email, b.contract_ref ?? sup.contract_ref, status, sup.id),
        auditStatement(env, admin, { action: 'SUPPLIER_UPDATE', targetType: 'supplier', targetId: sup.id, before: sup, after: b, request })
      ]);
      return json(corsHeaders, { success: true });
    }
  }

  if (p === '/api/v1/admin/supplier-mappings' && request.method === 'POST') {
    const b = await readJson(request);
    const sku = await env.DB.prepare(
      'SELECT s.id, s.sale_price, p.partner_id, pt.sales_model FROM product_skus s JOIN products p ON p.id = s.product_id JOIN partners pt ON pt.id = p.partner_id WHERE s.id = ?'
    ).bind(String(b.sku_id || '')).first();
    if (!sku) throw notFound('SKU를 찾을 수 없습니다.');
    if (sku.sales_model !== 'DIRECT') throw conflict('NOT_DIRECT_SKU', '직영(DIRECT) 스토어 상품만 공급사 소싱을 연결할 수 있습니다.');
    const sup = await env.DB.prepare("SELECT id FROM suppliers WHERE id = ? AND status = 'ACTIVE'").bind(String(b.supplier_id || '')).first();
    if (!sup) throw notFound('활성 공급사를 찾을 수 없습니다.');
    const unitCost = intParam(b.unit_cost, { min: 0, field: 'unit_cost' });
    const resale = b.resale_authorized === true ? 1 : 0;
    const evidence = str(b.authorization_evidence, { max: 500 });
    if (resale && !evidence) throw bad('EVIDENCE_REQUIRED', '재판매 권한 승인 시 근거(계약서 번호·문서 링크 등)를 입력해야 합니다.');
    const id = newId('ssm');
    await env.DB.batch([
      env.DB.prepare('UPDATE supplier_sku_mappings SET is_active = 0, updated_at = CURRENT_TIMESTAMP WHERE sku_id = ? AND is_active = 1').bind(sku.id),
      env.DB.prepare(`INSERT INTO supplier_sku_mappings (id, sku_id, supplier_id, supplier_sku_code, unit_cost, fulfillment_mode, resale_authorized, image_use_authorized, authorization_evidence, valid_until)
                      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(id, sku.id, sup.id, str(b.supplier_sku_code, { field: '공급사 상품코드', max: 100, required: true }), unitCost,
          b.fulfillment_mode === 'SELF_SHIP' ? 'SELF_SHIP' : 'DROP_SHIP', resale, b.image_use_authorized === true ? 1 : 0, evidence || null, str(b.valid_until, { max: 30 }) || null),
      auditStatement(env, admin, { action: 'SUPPLIER_MAPPING_SET', targetType: 'sku', targetId: sku.id, after: { ...b, id }, request })
    ]);
    return json(corsHeaders, { success: true, data: { id, sku_id: sku.id, unit_cost: unitCost, sale_price: sku.sale_price, margin_amount: sku.sale_price - unitCost, below_cost: sku.sale_price < unitCost } }, 201);
  }

  if (p === '/api/v1/admin/purchase-orders' && request.method === 'GET') {
    const status = url.searchParams.get('status');
    const { results } = await env.DB.prepare(
      `SELECT po.*, s.name AS supplier_name, so.sub_order_no, so.status AS sub_order_status, o.order_no, o.recipient_name, o.shipping_address_line1, o.shipping_postal_code
       FROM purchase_orders po JOIN suppliers s ON s.id = po.supplier_id JOIN sub_orders so ON so.id = po.sub_order_id JOIN orders o ON o.id = so.parent_order_id
       WHERE (? IS NULL OR po.status = ?) ORDER BY po.created_at DESC LIMIT 200`
    ).bind(status, status).all();
    for (const po of results) {
      po.items = (await env.DB.prepare('SELECT poi.*, i.product_title, i.option_summary FROM purchase_order_items poi JOIN order_items i ON i.id = poi.order_item_id WHERE poi.purchase_order_id = ?').bind(po.id).all()).results;
    }
    return json(corsHeaders, { success: true, count: results.length, data: results, supplier_api: 'NOT_INTEGRATED' });
  }

  const poM = p.match(/^\/api\/v1\/admin\/purchase-orders\/([^/]+)\/status$/);
  if (poM && (request.method === 'PUT' || request.method === 'POST')) {
    const b = await readJson(request);
    const po = await env.DB.prepare('SELECT * FROM purchase_orders WHERE id = ?').bind(poM[1]).first();
    if (!po) throw notFound('발주서를 찾을 수 없습니다.');
    const next = String(b.status || '');
    if (!(PO_TRANSITIONS[po.status] || []).includes(next)) throw conflict('ILLEGAL_PO_TRANSITION', `${po.status} → ${next} 전환은 허용되지 않습니다.`);
    const st = [
      env.DB.prepare('UPDATE purchase_orders SET status = ?, supplier_order_ref = COALESCE(?, supplier_order_ref), failure_reason = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = ?')
        .bind(next, str(b.supplier_order_ref, { max: 100 }) || null, next === 'FAILED' ? (str(b.failure_reason, { max: 300 }) || '공급사 발주 실패') : null, po.id, po.status),
      auditStatement(env, admin, { action: 'PO_STATUS', targetType: 'purchase_order', targetId: po.id, before: { status: po.status }, after: { status: next, ...b }, request })
    ];
    if (next === 'SHIPPED' && po.fulfillment_mode === 'DROP_SHIP') {
      const tracking = str(b.tracking_number, { field: '송장번호', max: 40, required: true });
      st.push(env.DB.prepare("UPDATE sub_orders SET status = 'SHIPPED', carrier_code = ?, tracking_number = ?, shipped_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status IN ('PAYMENT_CONFIRMED','PREPARING')")
        .bind(str(b.carrier, { max: 40 }) || 'CJ대한통운', tracking, po.sub_order_id));
    }
    await env.DB.batch(st);
    return json(corsHeaders, {
      success: true, status: next,
      ...(next === 'FAILED' ? { next_action: '공급사 재고 소진/발주 실패: 대체 공급사 재발주(SENT) 또는 고객 주문 취소·환불(/api/v1/orders/:id/sub-orders/:sid/cancel, 관리자) 중 선택하세요.' } : {})
    });
  }

  const smM = p.match(/^\/api\/v1\/admin\/partners\/([^/]+)\/sales-model$/);
  if (smM && (request.method === 'PUT' || request.method === 'POST')) {
    const b = await readJson(request);
    const model = b.sales_model === 'DIRECT' ? 'DIRECT' : 'MARKETPLACE';
    const partner = await env.DB.prepare('SELECT * FROM partners WHERE id = ?').bind(smM[1]).first();
    if (!partner) throw notFound('입점사를 찾을 수 없습니다.');
    const operator = await getActiveOperator(env);
    if (model === 'DIRECT' && !operator) throw conflict('OPERATOR_NOT_CONFIGURED', '직영 스토어 지정 전에 운영 사업자를 활성화해야 합니다.');
    const open = await env.DB.prepare("SELECT COUNT(*) c FROM sub_orders WHERE partner_id = ? AND status IN ('PAYMENT_PENDING','PAYMENT_CONFIRMED','PREPARING','SHIPPED','IN_TRANSIT','DELIVERED','RETURN_REQUESTED')").bind(partner.id).first('c');
    if (open > 0) throw conflict('OPEN_ORDERS_EXIST', `진행 중인 주문 ${open}건이 있어 판매 모델을 변경할 수 없습니다.`);
    await env.DB.batch([
      env.DB.prepare('UPDATE partners SET sales_model = ?, operator_entity_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').bind(model, model === 'DIRECT' ? operator.id : null, partner.id),
      auditStatement(env, admin, { action: 'PARTNER_SALES_MODEL', targetType: 'partner', targetId: partner.id, before: { sales_model: partner.sales_model }, after: { sales_model: model }, request })
    ]);
    return json(corsHeaders, { success: true, partner_id: partner.id, sales_model: model });
  }

  return null;
}
