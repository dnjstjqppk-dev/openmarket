// apps/cloudflare-gateway/src/routes/supplier-3pl.js
// Supplier Dropship POs, 3PL Fulfillment, Tracking Registration, and Inventory/Price Sync Engine.

import { requireAuth, requireApprovedPartner, requireAdmin } from '../lib/auth.js';
import { json, readJson, bad, conflict, notFound } from '../lib/http.js';
import { newId } from '../lib/ids.js';

export async function handleSupplier3plRoutes(request, url, env, corsHeaders) {
  const p = url.pathname;

  // 1. Create External Supplier Purchase Order (POST /api/v1/supplier-orders)
  if (p === '/api/v1/supplier-orders' && request.method === 'POST') {
    const caller = await requireAuth(request, env, ['ROLE_PARTNER', 'ROLE_ADMIN']);
    const body = await readJson(request);

    const subOrderId = String(body.sub_order_id || '').trim();
    const supplierId = String(body.supplier_id || '').trim();
    const idempotencyKey = String(body.idempotency_key || `sord_idemp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`);

    if (!subOrderId || !supplierId) throw bad('PARAMS_REQUIRED', 'sub_order_id 와 supplier_id 는 필수입니다.');

    // Check existing order by idempotency key (prevent duplicate PO dispatch)
    const existing = await env.DB.prepare(`
      SELECT * FROM supplier_orders WHERE idempotency_key = ?
    `).bind(idempotencyKey).first();
    if (existing) {
      return json(corsHeaders, {
        success: true,
        is_idempotent_replay: true,
        data: existing
      });
    }

    const sub = await env.DB.prepare('SELECT * FROM sub_orders WHERE id = ?').bind(subOrderId).first();
    if (!sub) throw notFound('연결할 하위 주문을 찾을 수 없습니다.');

    const sup = await env.DB.prepare('SELECT * FROM suppliers WHERE id = ?').bind(supplierId).first();
    if (!sup) throw notFound('지정된 공급업체를 찾을 수 없습니다.');

    const { results: items } = await env.DB.prepare(`
      SELECT oi.*, s.wholesale_supply_price, s.sku_code
      FROM order_items oi
      JOIN product_skus s ON s.id = oi.sku_id
      WHERE oi.sub_order_id = ?
    `).bind(subOrderId).all();

    if (items.length === 0) throw bad('NO_ITEMS', '하위 주문에 포함된 품목이 없습니다.');

    const sordId = newId('sord');
    const poNo = `PO-${Date.now().toString(36).toUpperCase()}-${Math.floor(Math.random() * 1000).toString().padStart(3, '0')}`;
    let totalCost = 0;

    const stmts = [];

    for (const it of items) {
      const unitCost = Number(it.wholesale_supply_price || Math.round(it.unit_price * 0.7));
      const lineCost = unitCost * it.quantity;
      totalCost += lineCost;

      const soiId = newId('soi');
      stmts.push(env.DB.prepare(`
        INSERT INTO supplier_order_items (
          id, supplier_order_id, order_item_id, sku_id, supplier_sku_code,
          product_title, option_summary, quantity, unit_supply_price, total_price, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      `).bind(
        soiId, sordId, it.id, it.sku_id, it.sku_code || 'SKU_SUP',
        it.product_title, it.option_summary || '단품', it.quantity, unitCost, lineCost
      ));
    }

    stmts.unshift(env.DB.prepare(`
      INSERT INTO supplier_orders (
        id, po_no, supplier_id, sub_order_id, idempotency_key, fulfillment_mode,
        status, total_supply_cost, currency, retry_count, dispatched_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 'DROPSHIP', 'REQUESTED', ?, 'KRW', 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `).bind(
      sordId, poNo, sup.id, sub.id, idempotencyKey, totalCost
    ));

    await env.DB.batch(stmts);

    return json(corsHeaders, {
      success: true,
      message: '공급업체 발주서가 성공적으로 생성 및 전달되었습니다.',
      data: {
        id: sordId,
        po_no: poNo,
        supplier_id: sup.id,
        supplier_name: sup.name,
        total_supply_cost: totalCost,
        status: 'REQUESTED'
      }
    }, 201);
  }

  // 2. List Supplier Purchase Orders (GET /api/v1/supplier-orders or /api/v1/admin/supplier-orders)
  if ((p === '/api/v1/supplier-orders' || p === '/api/v1/admin/supplier-orders') && request.method === 'GET') {
    await requireAuth(request, env, ['ROLE_PARTNER', 'ROLE_ADMIN']);
    const { results } = await env.DB.prepare(`
      SELECT so.*, s.name as supplier_name, sub.sub_order_no
      FROM supplier_orders so
      LEFT JOIN suppliers s ON s.id = so.supplier_id
      LEFT JOIN sub_orders sub ON sub.id = so.sub_order_id
      ORDER BY so.created_at DESC
      LIMIT 100
    `).all();

    return json(corsHeaders, {
      success: true,
      count: results.length,
      data: results
    });
  }

  // 3. Supplier PO Response (POST /api/v1/supplier-orders/:id/respond)
  const respM = p.match(/^\/api\/v1\/supplier-orders\/([^/]+)\/respond$/);
  if (respM && request.method === 'POST') {
    const caller = await requireAuth(request, env, ['ROLE_PARTNER', 'ROLE_ADMIN']);
    const body = await readJson(request);
    const action = String(body.action || '').toUpperCase(); // ACCEPT | REJECT
    const reason = body.reason ? String(body.reason).trim() : null;

    if (!['ACCEPT', 'REJECT'].includes(action)) throw bad('INVALID_ACTION', 'action은 ACCEPT 또는 REJECT 여야 합니다.');

    const po = await env.DB.prepare('SELECT * FROM supplier_orders WHERE id = ?').bind(respM[1]).first();
    if (!po) throw notFound('발주서를 찾을 수 없습니다.');
    if (po.status !== 'REQUESTED') throw conflict('NOT_REQUESTED', `발주 대기 상태에서만 응답할 수 있습니다. (현재: ${po.status})`);

    const newStatus = action === 'ACCEPT' ? 'ACCEPTED' : 'REJECTED';

    await env.DB.prepare(`
      UPDATE supplier_orders
      SET status = ?, rejection_reason = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).bind(newStatus, action === 'REJECT' ? (reason || '공급업체 재고 부족으로 거절') : null, po.id).run();

    return json(corsHeaders, {
      success: true,
      order_id: po.id,
      po_no: po.po_no,
      status: newStatus,
      message: action === 'ACCEPT' ? '발주 수락 완료 (출고 준비 시작)' : '발주 거절 처리 완료'
    });
  }

  // 4. Supplier / 3PL Dispatch & Tracking Number Entry (POST /api/v1/supplier-orders/:id/dispatch)
  const dispM = p.match(/^\/api\/v1\/supplier-orders\/([^/]+)\/dispatch$/);
  if (dispM && request.method === 'POST') {
    const caller = await requireAuth(request, env, ['ROLE_PARTNER', 'ROLE_ADMIN']);
    const body = await readJson(request);

    const carrierCode = String(body.carrier_code || 'CJ대한통운').trim();
    const trackingNumber = String(body.tracking_number || '').trim();

    if (!trackingNumber) throw bad('TRACKING_REQUIRED', '송장번호(운송장 번호)를 입력해 주세요.');

    const po = await env.DB.prepare('SELECT * FROM supplier_orders WHERE id = ?').bind(dispM[1]).first();
    if (!po) throw notFound('발주서를 찾을 수 없습니다.');

    const foId = newId('fo');

    await env.DB.batch([
      // Update supplier order to IN_TRANSIT
      env.DB.prepare(`
        UPDATE supplier_orders
        SET status = 'IN_TRANSIT', carrier_code = ?, tracking_number = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).bind(carrierCode, trackingNumber, po.id),

      // Create fulfillment record
      env.DB.prepare(`
        INSERT INTO fulfillment_orders (
          id, supplier_order_id, carrier_code, tracking_number, status, shipped_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, 'SHIPPED', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      `).bind(foId, po.id, carrierCode, trackingNumber),

      // Synchronize customer sub_order to SHIPPED
      env.DB.prepare(`
        UPDATE sub_orders
        SET status = 'SHIPPED', carrier_code = ?, tracking_number = ?, shipped_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).bind(carrierCode, trackingNumber, po.sub_order_id)
    ]);

    return json(corsHeaders, {
      success: true,
      po_no: po.po_no,
      status: 'IN_TRANSIT',
      carrier_code: carrierCode,
      tracking_number: trackingNumber,
      message: '출고 처리 및 고객 배송 송장번호 동기화 완료'
    });
  }

  // 5. Periodic / Manual Price & Stock Sync (POST /api/v1/sync/supplier-inventory)
  if (p === '/api/v1/sync/supplier-inventory' && request.method === 'POST') {
    const caller = await requireAuth(request, env, ['ROLE_PARTNER', 'ROLE_ADMIN']);
    const body = await readJson(request);

    const skuId = String(body.sku_id || '').trim();
    const newStock = body.new_stock !== undefined ? Number(body.new_stock) : null;
    const newPrice = body.new_price !== undefined ? Number(body.new_price) : null;

    if (!skuId) throw bad('SKU_REQUIRED', '동기화할 sku_id 를 입력해 주세요.');

    const currentSku = await env.DB.prepare(`
      SELECT s.*, p.title
      FROM product_skus s
      JOIN products p ON p.id = s.product_id
      WHERE s.id = ?
    `).bind(skuId).first();

    if (!currentSku) throw notFound('SKU를 찾을 수 없습니다.');

    const oldStock = Number(currentSku.stock_quantity || 0);
    const oldPrice = Number(currentSku.wholesale_supply_price || currentSku.sale_price);

    let syncStatus = 'SUCCESS';
    let alertMsg = null;

    // Check price fluctuation (> 20% price change alert)
    if (newPrice !== null && oldPrice > 0) {
      const priceChangePct = Math.abs((newPrice - oldPrice) / oldPrice);
      if (priceChangePct >= 0.20) {
        syncStatus = 'PRICE_JUMP_ALERT';
        alertMsg = `도매 공급가 급변동 감지 (${oldPrice}원 -> ${newPrice}원, ${Math.round(priceChangePct * 100)}% 변동)`;
      }
    }

    if (newStock === 0) {
      syncStatus = 'OUT_OF_STOCK';
      alertMsg = '공급사 재고 완전 소진 (품절 전환)';
    }

    const logId = newId('isl');

    const stmts = [
      env.DB.prepare(`
        INSERT INTO supplier_inventory_sync_logs (
          id, supplier_id, sku_id, old_stock, new_stock, old_price, new_price,
          sync_type, sync_status, alert_message, synced_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'MANUAL', ?, ?, CURRENT_TIMESTAMP)
      `).bind(
        logId, body.supplier_id || 'sup_001', skuId, oldStock, newStock, oldPrice, newPrice, syncStatus, alertMsg
      )
    ];

    // Apply updates if provided
    if (newStock !== null) {
      stmts.push(env.DB.prepare(`
        UPDATE product_skus SET stock_quantity = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
      `).bind(newStock, skuId));
    }
    if (newPrice !== null) {
      stmts.push(env.DB.prepare(`
        UPDATE product_skus SET wholesale_supply_price = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
      `).bind(newPrice, skuId));
    }

    await env.DB.batch(stmts);

    return json(corsHeaders, {
      success: true,
      sync_status: syncStatus,
      alert_message: alertMsg,
      data: {
        sku_id: skuId,
        old_stock: oldStock,
        new_stock: newStock,
        old_price: oldPrice,
        new_price: newPrice
      }
    });
  }

  // 6. Integration Health Monitoring (GET /api/v1/integrations/health)
  if (p === '/api/v1/integrations/health' && request.method === 'GET') {
    const totalJobs = await env.DB.prepare('SELECT COUNT(*) as c FROM product_import_jobs').first('c') || 0;
    const publishedJobs = await env.DB.prepare("SELECT COUNT(*) as c FROM product_import_jobs WHERE status = 'PUBLISHED'").first('c') || 0;
    const openOrders = await env.DB.prepare("SELECT COUNT(*) as c FROM supplier_orders WHERE status IN ('REQUESTED', 'ACCEPTED', 'IN_TRANSIT')").first('c') || 0;
    const totalSuppliers = await env.DB.prepare('SELECT COUNT(*) as c FROM suppliers').first('c') || 0;

    return json(corsHeaders, {
      success: true,
      service: 'OLMOA Supplier & 3PL Integration Core',
      status: 'UP',
      crawler_status: 'ACTIVE',
      ssrf_protection: 'ENABLED',
      metrics: {
        total_import_jobs: totalJobs,
        published_products: publishedJobs,
        active_supplier_orders: openOrders,
        registered_suppliers: totalSuppliers
      }
    });
  }

  // 7. Admin List Sync Logs (GET /api/v1/admin/sync/logs)
  if ((p === '/api/v1/admin/sync/logs' || p === '/api/v1/sync/logs') && request.method === 'GET') {
    await requireAdmin(request, env);
    const { results } = await env.DB.prepare(`
      SELECT * FROM supplier_inventory_sync_logs
      ORDER BY synced_at DESC
      LIMIT 100
    `).all();

    return json(corsHeaders, {
      success: true,
      count: results.length,
      data: results
    });
  }

  return null;
}
