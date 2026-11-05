// apps/cloudflare-gateway/src/routes/supplier-3pl.js
// Supplier drop-ship POs, 3PL fulfilment, tracking registration and supplier stock/price sync.
//
// Access rules (V3 integrity contract):
//   * operators (permission 'sourcing', see lib/admin-policy.js) see and act on everything;
//   * an APPROVED seller only on sub-orders / SKUs it owns — never on another seller's data;
//   * a PO is only raised for a paid, not-yet-shipped sub-order, and costs come from recorded supply prices
//     (nothing is estimated);
//   * shipping a sub-order goes through the same state guard as the seller shipment endpoint
//     (PAYMENT_CONFIRMED | PREPARING -> SHIPPED), so a delivered / cancelled order can never be re-shipped;
//   * stock changes are written to inventory_ledger like every other stock movement.
// There is no supplier API integration: "dispatch" means the PO was recorded, not that it reached the supplier.

import { requireAuth, requireAdmin } from '../lib/auth.js';
import { json, readJson, bad, conflict, notFound, forbidden, HttpError, str } from '../lib/http.js';
import { assertFeatureEnabled } from '../services/feature-flags.js';
import { newId } from '../lib/ids.js';

const SHIPPABLE_SUB_ORDER = ['PAYMENT_CONFIRMED', 'PREPARING'];
const TRACKING_RE = /^[A-Za-z0-9-]{6,40}$/;

async function requireSourcingActor(request, env) {
  const caller = await requireAuth(request, env, ['ROLE_PARTNER', 'ROLE_ADMIN']);
  if (caller.role === 'ROLE_PARTNER') {
    if (!caller.partner) throw forbidden('판매자 계정에 연결된 입점사 정보가 없습니다.');
    if (caller.partner.status !== 'APPROVED') {
      throw new HttpError(403, 'PARTNER_NOT_APPROVED', `입점 심사 상태(${caller.partner.status})에서는 이용할 수 없습니다.`);
    }
  }
  return { caller, partnerId: caller.role === 'ROLE_PARTNER' ? caller.partner.id : null };
}

/** Loads a PO together with the owning seller of its sub-order; 404 (not 403) for other sellers' POs. */
async function loadOwnedPo(env, poId, partnerId) {
  const po = await env.DB.prepare(
    `SELECT so.*, sub.partner_id AS sub_partner_id, sub.status AS sub_status
     FROM supplier_orders so JOIN sub_orders sub ON sub.id = so.sub_order_id WHERE so.id = ?`
  ).bind(poId).first();
  if (!po || (partnerId && po.sub_partner_id !== partnerId)) throw notFound('발주서를 찾을 수 없습니다.');
  return po;
}

function intOrNull(v, field) {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  if (!Number.isSafeInteger(n) || n < 0) throw bad('INVALID_NUMBER', `${field}은(는) 0 이상의 정수여야 합니다.`);
  return n;
}

export async function handleSupplier3plRoutes(request, url, env, corsHeaders) {
  const p = url.pathname;

  // 1. Create a supplier PO for a paid sub-order (POST /api/v1/supplier-orders)
  if (p === '/api/v1/supplier-orders' && request.method === 'POST') {
    const { partnerId } = await requireSourcingActor(request, env);
    await assertFeatureEnabled(env, 'auto_supplier_po');
    const body = await readJson(request);

    const subOrderId = str(body.sub_order_id, { field: 'sub_order_id', max: 80, required: true });
    const supplierId = str(body.supplier_id, { field: 'supplier_id', max: 80, required: true });

    const sub = await env.DB.prepare('SELECT * FROM sub_orders WHERE id = ?').bind(subOrderId).first();
    if (!sub || (partnerId && sub.partner_id !== partnerId)) throw notFound('연결할 하위 주문을 찾을 수 없습니다.');
    if (!SHIPPABLE_SUB_ORDER.includes(sub.status)) {
      throw conflict('SUB_ORDER_NOT_PAYABLE', `결제 완료·출고 전 주문만 발주할 수 있습니다. (현재: ${sub.status})`);
    }

    const sup = await env.DB.prepare('SELECT * FROM suppliers WHERE id = ?').bind(supplierId).first();
    if (!sup) throw notFound('지정된 공급업체를 찾을 수 없습니다.');
    if (sup.status !== 'ACTIVE') throw conflict('SUPPLIER_INACTIVE', `거래 중지된 공급업체입니다. (${sup.status})`);

    // One live PO per sub-order. The deterministic default key makes double clicks idempotent.
    const idempotencyKey = str(body.idempotency_key, { max: 120 }) || `sord:${sub.id}:${sup.id}`;
    const existing = await env.DB.prepare('SELECT * FROM supplier_orders WHERE idempotency_key = ?').bind(idempotencyKey).first();
    if (existing) {
      if (existing.sub_order_id !== sub.id) throw conflict('IDEMPOTENCY_KEY_REUSED', '다른 주문에 사용된 멱등키입니다.');
      return json(corsHeaders, { success: true, is_idempotent_replay: true, data: existing });
    }
    const live = await env.DB.prepare("SELECT id, po_no FROM supplier_orders WHERE sub_order_id = ? AND status NOT IN ('REJECTED','CANCELLED')").bind(sub.id).first();
    if (live) throw conflict('PO_ALREADY_EXISTS', `이미 진행 중인 발주서(${live.po_no})가 있습니다.`);

    const { results: items } = await env.DB.prepare(`
      SELECT oi.*, s.wholesale_supply_price, s.sku_code
      FROM order_items oi JOIN product_skus s ON s.id = oi.sku_id
      WHERE oi.sub_order_id = ?
    `).bind(sub.id).all();
    if (items.length === 0) throw bad('NO_ITEMS', '하위 주문에 포함된 품목이 없습니다.');
    const unpriced = items.filter((it) => !Number.isSafeInteger(Number(it.wholesale_supply_price)) || Number(it.wholesale_supply_price) <= 0);
    if (unpriced.length) {
      throw bad('SUPPLY_PRICE_MISSING', '공급가가 등록되지 않은 품목이 있어 발주할 수 없습니다. 공급가를 먼저 등록해 주세요.',
        { sku_ids: unpriced.map((it) => it.sku_id) });
    }

    const sordId = newId('sord');
    const poNo = `SPO-${sordId.slice(-12).toUpperCase()}`;
    let totalCost = 0;
    const stmts = [];
    for (const it of items) {
      const unitCost = Number(it.wholesale_supply_price);
      const qty = Number(it.quantity) - Number(it.refunded_quantity || 0);
      if (qty <= 0) continue;
      totalCost += unitCost * qty;
      stmts.push(env.DB.prepare(`
        INSERT INTO supplier_order_items (id, supplier_order_id, order_item_id, sku_id, supplier_sku_code, product_title, option_summary, quantity, unit_supply_price, total_price)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(newId('soi'), sordId, it.id, it.sku_id, it.sku_code || it.sku_id, it.product_title, it.option_summary || null, qty, unitCost, unitCost * qty));
    }
    if (!stmts.length) throw bad('NO_ITEMS', '발주할 잔여 수량이 없습니다.');
    stmts.unshift(env.DB.prepare(`
      INSERT INTO supplier_orders (id, po_no, supplier_id, sub_order_id, idempotency_key, fulfillment_mode, status, total_supply_cost, currency, retry_count, dispatched_at)
      VALUES (?, ?, ?, ?, ?, 'DROPSHIP', 'REQUESTED', ?, 'KRW', 0, NULL)
    `).bind(sordId, poNo, sup.id, sub.id, idempotencyKey, totalCost));
    await env.DB.batch(stmts);

    return json(corsHeaders, {
      success: true,
      message: '발주서가 생성되었습니다. 공급사 API가 연동되지 않았으므로 공급사에 직접 전달한 뒤 응답을 기록해 주세요.',
      data: { id: sordId, po_no: poNo, supplier_id: sup.id, supplier_name: sup.name, total_supply_cost: totalCost, status: 'REQUESTED', supplier_api: sup.api_integration_status }
    }, 201);
  }

  // 2. List POs — a seller sees only POs for its own sub-orders.
  if ((p === '/api/v1/supplier-orders' || p === '/api/v1/admin/supplier-orders') && request.method === 'GET') {
    if (p === '/api/v1/admin/supplier-orders') await requireAdmin(request, env);
    const { partnerId } = await requireSourcingActor(request, env);
    const { results } = await env.DB.prepare(`
      SELECT so.*, s.name AS supplier_name, sub.sub_order_no
      FROM supplier_orders so
      LEFT JOIN suppliers s ON s.id = so.supplier_id
      JOIN sub_orders sub ON sub.id = so.sub_order_id
      WHERE (? IS NULL OR sub.partner_id = ?)
      ORDER BY so.created_at DESC LIMIT 100
    `).bind(partnerId, partnerId).all();
    return json(corsHeaders, { success: true, count: results.length, data: results });
  }

  // 3. Record the supplier's answer (POST /api/v1/supplier-orders/:id/respond)
  const respM = p.match(/^\/api\/v1\/supplier-orders\/([^/]+)\/respond$/);
  if (respM && request.method === 'POST') {
    const { partnerId } = await requireSourcingActor(request, env);
    const body = await readJson(request);
    const action = String(body.action || '').toUpperCase();
    if (!['ACCEPT', 'REJECT'].includes(action)) throw bad('INVALID_ACTION', 'action은 ACCEPT 또는 REJECT 여야 합니다.');
    const reason = str(body.reason, { max: 300 });
    if (action === 'REJECT' && !reason) throw bad('REASON_REQUIRED', '거절 사유를 입력해 주세요.');

    const po = await loadOwnedPo(env, respM[1], partnerId);
    const newStatus = action === 'ACCEPT' ? 'ACCEPTED' : 'REJECTED';
    const r = await env.DB.prepare(`
      UPDATE supplier_orders SET status = ?, rejection_reason = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND status = 'REQUESTED'
    `).bind(newStatus, action === 'REJECT' ? reason : null, po.id).run();
    if (r.meta.changes !== 1) throw conflict('NOT_REQUESTED', `발주 대기 상태에서만 응답할 수 있습니다. (현재: ${po.status})`);

    return json(corsHeaders, {
      success: true, order_id: po.id, po_no: po.po_no, status: newStatus,
      message: action === 'ACCEPT' ? '공급사 수락이 기록되었습니다.' : '공급사 거절이 기록되었습니다. 재발주 또는 주문 취소·환불이 필요합니다.'
    });
  }

  // 4. Register the supplier / 3PL shipment (POST /api/v1/supplier-orders/:id/dispatch)
  const dispM = p.match(/^\/api\/v1\/supplier-orders\/([^/]+)\/dispatch$/);
  if (dispM && request.method === 'POST') {
    const { partnerId } = await requireSourcingActor(request, env);
    await assertFeatureEnabled(env, 'fulfillment_3pl');
    const body = await readJson(request);
    const carrierCode = str(body.carrier_code, { max: 40 }) || 'CJ대한통운';
    const trackingNumber = String(body.tracking_number || '').trim();
    if (!TRACKING_RE.test(trackingNumber)) throw bad('INVALID_TRACKING', '송장번호(운송장 번호) 형식이 올바르지 않습니다.');

    const po = await loadOwnedPo(env, dispM[1], partnerId);
    if (po.status !== 'ACCEPTED') throw conflict('PO_NOT_ACCEPTED', `공급사가 수락한 발주서만 출고 처리할 수 있습니다. (현재: ${po.status})`);

    // The sub-order transition is the guard; every other write only happens if it succeeded.
    const shippedGuard = `EXISTS (SELECT 1 FROM sub_orders WHERE id = ? AND status = 'SHIPPED' AND tracking_number = ?)`;
    const r = await env.DB.batch([
      env.DB.prepare(`
        UPDATE sub_orders SET status = 'SHIPPED', milestone_status = 'SHIPPED', carrier_code = ?, tracking_number = ?, shipped_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND status IN ('PAYMENT_CONFIRMED','PREPARING')
      `).bind(carrierCode, trackingNumber, po.sub_order_id),
      env.DB.prepare(`
        UPDATE supplier_orders SET status = 'IN_TRANSIT', carrier_code = ?, tracking_number = ?, dispatched_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND status = 'ACCEPTED' AND ${shippedGuard}
      `).bind(carrierCode, trackingNumber, po.id, po.sub_order_id, trackingNumber),
      env.DB.prepare(`
        INSERT INTO fulfillment_orders (id, supplier_order_id, carrier_code, tracking_number, status, shipped_at)
        SELECT ?, ?, ?, ?, 'SHIPPED', CURRENT_TIMESTAMP WHERE ${shippedGuard}
      `).bind(newId('fo'), po.id, carrierCode, trackingNumber, po.sub_order_id, trackingNumber),
      env.DB.prepare(`
        INSERT INTO milestone_tracking_logs (id, sub_order_id, carrier_code, tracking_number, stage_code, stage_name, location, description, occurred_at)
        SELECT ?, ?, ?, ?, 'SHIPPED', '공급사 출고', '공급사 출고지', '공급사 직배송 운송장이 등록되었습니다.', CURRENT_TIMESTAMP WHERE ${shippedGuard}
      `).bind(newId('trk'), po.sub_order_id, carrierCode, trackingNumber, po.sub_order_id, trackingNumber)
    ]);
    if (r[0].meta.changes !== 1) {
      throw conflict('SUB_ORDER_NOT_SHIPPABLE', `결제 완료·출고 전 상태의 주문만 출고 처리할 수 있습니다. (현재: ${po.sub_status})`);
    }
    return json(corsHeaders, {
      success: true, po_no: po.po_no, status: 'IN_TRANSIT', carrier_code: carrierCode, tracking_number: trackingNumber,
      message: '출고 처리 및 고객 주문 송장 등록 완료'
    });
  }

  // 5. Manual supplier stock / supply-price sync (POST /api/v1/sync/supplier-inventory)
  if (p === '/api/v1/sync/supplier-inventory' && request.method === 'POST') {
    const { partnerId } = await requireSourcingActor(request, env);
    await assertFeatureEnabled(env, 'stock_sync');
    const body = await readJson(request);
    const skuId = str(body.sku_id, { field: 'sku_id', max: 80, required: true });
    const newStock = intOrNull(body.new_stock, '재고');
    const newPrice = intOrNull(body.new_price, '공급가');
    if (newStock === null && newPrice === null) throw bad('NOTHING_TO_SYNC', 'new_stock 또는 new_price 중 하나는 필요합니다.');
    if (newPrice !== null) await assertFeatureEnabled(env, 'auto_pricing');

    const sku = await env.DB.prepare(`
      SELECT s.*, p.title, p.partner_id FROM product_skus s JOIN products p ON p.id = s.product_id WHERE s.id = ?
    `).bind(skuId).first();
    if (!sku || (partnerId && sku.partner_id !== partnerId)) throw notFound('SKU를 찾을 수 없습니다.');

    const supplierId = str(body.supplier_id, { field: 'supplier_id', max: 80, required: true });
    const sup = await env.DB.prepare('SELECT id FROM suppliers WHERE id = ?').bind(supplierId).first();
    if (!sup) throw notFound('지정된 공급업체를 찾을 수 없습니다.');

    const oldStock = Number(sku.stock_quantity || 0);
    const oldPrice = sku.wholesale_supply_price === null || sku.wholesale_supply_price === undefined ? null : Number(sku.wholesale_supply_price);
    let syncStatus = 'SUCCESS';
    let alertMsg = null;
    if (newPrice !== null && oldPrice) {
      const pct = Math.abs(newPrice - oldPrice) / oldPrice;
      if (pct >= 0.2) {
        syncStatus = 'PRICE_JUMP_ALERT';
        alertMsg = `도매 공급가 급변동 감지 (${oldPrice}원 -> ${newPrice}원, ${Math.round(pct * 100)}% 변동)`;
      }
    }
    if (newStock === 0) { syncStatus = 'OUT_OF_STOCK'; alertMsg = '공급사 재고 소진 (품절 전환)'; }

    const stmts = [];
    if (newStock !== null && newStock !== oldStock) {
      // Optimistic: only applies if no order moved the stock since it was read; the ledger row has the same guard.
      stmts.push(env.DB.prepare(`
        UPDATE product_skus SET stock_quantity = ?, status = CASE WHEN ? > 0 THEN 'IN_STOCK' ELSE 'OUT_OF_STOCK' END, updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND stock_quantity = ?
      `).bind(newStock, newStock, sku.id, oldStock));
      stmts.push(env.DB.prepare(`
        INSERT INTO inventory_ledger (id, sku_id, change_type, quantity_delta, balance_after, reference_id, idempotency_key)
        SELECT ?, ?, 'MANUAL_ADJUST', ?, ?, ?, ? WHERE (SELECT stock_quantity FROM product_skus WHERE id = ?) = ?
      `).bind(newId('ldg'), sku.id, newStock - oldStock, newStock, `supplier-sync:${sup.id}`, newId('sync'), sku.id, newStock));
    }
    if (newPrice !== null) {
      stmts.push(env.DB.prepare('UPDATE product_skus SET wholesale_supply_price = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').bind(newPrice, sku.id));
    }
    stmts.push(env.DB.prepare(`
      INSERT INTO supplier_inventory_sync_logs (id, supplier_id, sku_id, old_stock, new_stock, old_price, new_price, sync_type, sync_status, alert_message)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'MANUAL', ?, ?)
    `).bind(newId('isl'), sup.id, sku.id, oldStock, newStock, oldPrice, newPrice, syncStatus, alertMsg));
    const r = await env.DB.batch(stmts);
    if (newStock !== null && newStock !== oldStock && r[0].meta.changes !== 1) {
      throw conflict('STOCK_CHANGED', '그 사이 주문이 발생해 재고가 변경되었습니다. 다시 시도해 주세요.');
    }

    return json(corsHeaders, {
      success: true, sync_status: syncStatus, alert_message: alertMsg,
      data: { sku_id: sku.id, old_stock: oldStock, new_stock: newStock, old_price: oldPrice, new_price: newPrice }
    });
  }

  // 6. Integration counters (operators and approved sellers only; no external system is probed)
  if (p === '/api/v1/integrations/health' && request.method === 'GET') {
    await requireSourcingActor(request, env);
    const one = (sql) => env.DB.prepare(sql).first('c').then((c) => c || 0);
    const [totalJobs, publishedJobs, openOrders, totalSuppliers, liveSuppliers] = await Promise.all([
      one('SELECT COUNT(*) AS c FROM product_import_jobs'),
      one("SELECT COUNT(*) AS c FROM product_import_jobs WHERE status = 'PUBLISHED'"),
      one("SELECT COUNT(*) AS c FROM supplier_orders WHERE status IN ('REQUESTED', 'ACCEPTED', 'IN_TRANSIT')"),
      one('SELECT COUNT(*) AS c FROM suppliers'),
      one("SELECT COUNT(*) AS c FROM suppliers WHERE api_integration_status = 'LIVE'")
    ]);
    return json(corsHeaders, {
      success: true,
      service: 'OLMOA Supplier & 3PL Integration Core',
      supplier_api_live_count: liveSuppliers,
      note: liveSuppliers ? null : '연동된 공급사 API가 없습니다. 발주·출고는 수동 기록입니다.',
      metrics: { total_import_jobs: totalJobs, published_products: publishedJobs, active_supplier_orders: openOrders, registered_suppliers: totalSuppliers }
    });
  }

  // 7. Sync logs (operators)
  if ((p === '/api/v1/admin/sync/logs' || p === '/api/v1/sync/logs') && request.method === 'GET') {
    await requireAdmin(request, env);
    const { results } = await env.DB.prepare('SELECT * FROM supplier_inventory_sync_logs ORDER BY synced_at DESC LIMIT 100').all();
    return json(corsHeaders, { success: true, count: results.length, data: results });
  }

  return null;
}
