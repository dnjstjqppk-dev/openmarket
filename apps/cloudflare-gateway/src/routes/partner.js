// apps/cloudflare-gateway/src/routes/partner.js
// Seller center API. Tenant = partner bound to the authenticated ROLE_PARTNER user (never a request header).

import { computeServerQualityScore } from './catalog.js';
import { requireAuth } from '../lib/auth.js';
import { json, readJson, bad, conflict, forbidden, notFound, str, intParam, HttpError } from '../lib/http.js';
import { newId } from '../lib/ids.js';
import { refundOrder, loadOrderBundle } from '../services/orders.js';


function optionSummary(json) {
  try {
    return Object.entries(JSON.parse(json || '{}')).map(([k, v]) => `${k}:${v}`).join(' / ') || '기본';
  } catch {
    return '기본';
  }
}

function priceFields(body, fallback = {}) {
  const sale = intParam(body.sale_price ?? body.price ?? body.lowest_sale_price ?? fallback.sale, { min: 100, max: 100_000_000, field: '판매가' });
  const orig = intParam(body.original_price ?? body.lowest_original_price ?? fallback.orig ?? sale, { min: sale, max: 100_000_000, field: '정상가' });
  return { sale, orig };
}

async function resolveCategory(env, body, fallback) {
  const ref = body.category_slug || body.category_id || fallback;
  if (!ref) throw bad('CATEGORY_REQUIRED', '카테고리를 지정해 주세요.');
  const cat = await env.DB.prepare('SELECT id FROM categories WHERE (slug = ? OR id = ?) AND is_active = 1').bind(ref, ref).first();
  if (!cat) throw bad('INVALID_CATEGORY', '존재하지 않는 카테고리입니다.');
  return cat.id;
}

export async function handlePartnerRoutes(request, url, env, corsHeaders) {
  const p = url.pathname;
  if (!p.startsWith('/api/v1/partner')) return null;
  if (p.startsWith('/api/v1/partner/sample-qc')) return null; // handled in temu-ops.js

  const me = await requireAuth(request, env, ['ROLE_PARTNER']);
  if (!me.partner) throw forbidden('판매자 계정에 연결된 입점사 정보가 없습니다.');
  const partner = me.partner;
  const partnerId = partner.id;

  if (p === '/api/v1/partner/profile' && request.method === 'GET') {
    return json(corsHeaders, {
      success: true, partner_id: partnerId,
      data: {
        id: partner.id, business_name: partner.business_name, business_reg_number: partner.business_reg_number, status: partner.status,
        sales_model: partner.sales_model, commission_rate: (partner.commission_rate_bps ?? partner.commission_rate * 100) / 100,
        bank_code: partner.bank_code, bank_account_number: partner.bank_account_number ? `****${String(partner.bank_account_number).slice(-4)}` : null,
        bank_account_holder: partner.bank_account_holder, payout_account_verified: Number(partner.payout_account_verified) === 1,
        payout_change_pending: Boolean(partner.payout_change_request_json),
        settlement_cycle: partner.settlement_cycle, return_shipping_address: partner.return_shipping_address,
        customer_service_phone: partner.customer_service_phone, base_shipping_fee: partner.base_shipping_fee, free_shipping_threshold: partner.free_shipping_threshold
      }
    });
  }

  if (partner.status !== 'APPROVED') {
    throw new HttpError(403, 'PARTNER_NOT_APPROVED', `입점 심사 상태(${partner.status})에서는 이용할 수 없습니다.`);
  }

  if (p === '/api/v1/partner/profile' && (request.method === 'PUT' || request.method === 'PATCH')) {
    const b = await readJson(request);
    const fee = b.base_shipping_fee !== undefined ? intParam(b.base_shipping_fee, { min: 0, max: 100000, field: '기본 배송비' }) : partner.base_shipping_fee;
    const threshold = b.free_shipping_threshold !== undefined ? intParam(b.free_shipping_threshold, { min: 0, max: 10_000_000, field: '무료배송 기준' }) : partner.free_shipping_threshold;
    const st = [env.DB.prepare(
      `UPDATE partners SET settlement_cycle = ?, return_shipping_address = ?, customer_service_phone = ?, base_shipping_fee = ?, free_shipping_threshold = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`
    ).bind(['WEEKLY', 'BIWEEKLY', 'MONTHLY'].includes(b.settlement_cycle) ? b.settlement_cycle : partner.settlement_cycle,
      b.return_shipping_address !== undefined ? str(b.return_shipping_address, { max: 200 }) : partner.return_shipping_address,
      b.customer_service_phone !== undefined ? str(b.customer_service_phone, { max: 30 }) : partner.customer_service_phone, fee, threshold, partnerId)];
    let payoutChange = false;
    if (b.bank_code || b.bank_account_number || b.bank_account_holder) {
      // Payout account changes are a classic takeover vector: queue for operator verification, never apply directly.
      payoutChange = true;
      st.push(env.DB.prepare('UPDATE partners SET payout_change_request_json = ? WHERE id = ?').bind(JSON.stringify({
        bank_code: str(b.bank_code || partner.bank_code, { max: 20 }), bank_account_number: str(b.bank_account_number || partner.bank_account_number, { max: 30 }),
        bank_account_holder: str(b.bank_account_holder || partner.bank_account_holder, { max: 50 }), requested_by: me.userId, requested_at: new Date().toISOString()
      }), partnerId));
    }
    if (b.business_name && b.business_name !== partner.business_name) throw conflict('BUSINESS_NAME_LOCKED', '상호 변경은 사업자등록증 재심사가 필요합니다. 고객센터로 요청해 주세요.');
    await env.DB.batch(st);
    return json(corsHeaders, { success: true, message: payoutChange ? '설정이 저장되었습니다. 정산 계좌 변경은 운영자 실명 확인 후 반영됩니다.' : '설정이 저장되었습니다.', payout_change_pending: payoutChange });
  }

  if (p === '/api/v1/partner/products' && request.method === 'GET') {
    const { results } = await env.DB.prepare(
      `SELECT p.*, c.name AS category_name, c.slug AS category_slug, s.id AS sku_id, s.sku_code, s.option_combination_json,
              s.stock_quantity, s.original_price AS sku_original_price, s.sale_price, s.status AS sku_status
       FROM products p LEFT JOIN categories c ON p.category_id = c.id LEFT JOIN product_skus s ON s.product_id = p.id
       WHERE p.partner_id = ? ORDER BY p.created_at DESC, s.sku_code ASC`
    ).bind(partnerId).all();
    const data = results.map((r) => ({ ...r, option_summary: optionSummary(r.option_combination_json), quality_score: computeServerQualityScore(r) }));
    return json(corsHeaders, { success: true, partner_id: partnerId, business_name: partner.business_name, count: data.length, data });
  }

  if (p === '/api/v1/partner/products' && request.method === 'POST') {
    const b = await readJson(request);
    const title = str(b.title, { field: '상품명', max: 200, required: true });
    const { sale, orig } = priceFields(b);
    const stock = intParam(b.stock_quantity ?? 0, { min: 0, max: 1_000_000, field: '재고' });
    const catId = await resolveCategory(env, b);
    const thumb = str(b.thumbnail_url, { field: '대표 이미지', max: 500, required: true });
    if (!/^https:\/\//.test(thumb) && !thumb.startsWith('/api/v1/storage/file/')) throw bad('INVALID_IMAGE_URL', '이미지는 https URL 또는 업로드 파일이어야 합니다.');
    const prodId = newId('prod');
    const skuId = newId('sku');
    const skuCode = str(b.sku_code, { max: 60 }) || `SKU-${skuId.slice(-10).toUpperCase()}`;
    const optJson = b.option_combination_json ? (typeof b.option_combination_json === 'string' ? b.option_combination_json : JSON.stringify(b.option_combination_json)) : '{"옵션":"기본"}';
    try { JSON.parse(optJson); } catch { throw bad('INVALID_OPTIONS', '옵션 형식이 올바르지 않습니다.'); }
    const pkg = ['package_length_cm', 'package_width_cm', 'package_height_cm', 'package_weight_kg'].map((k) => Number(b[k] || 0));
    const volWeight = Math.round(((pkg[0] * pkg[1] * pkg[2]) / 5000) * 100) / 100;
    try {
      await env.DB.batch([
        env.DB.prepare(
          `INSERT INTO products (id, partner_id, category_id, title, thumbnail_url, description_html, lowest_original_price, lowest_sale_price, status, review_status,
             hs_code, country_origin, package_length_cm, package_width_cm, package_height_cm, package_weight_kg, volumetric_weight_kg, warehouse_location)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'DRAFT', 'PENDING', ?, ?, ?, ?, ?, ?, ?, ?)`
        ).bind(prodId, partnerId, catId, title, thumb, str(b.description_html, { max: 200000 }) || `<p>${title}</p>`, orig, sale,
          str(b.hs_code, { max: 12 }) || null, str(b.country_origin, { max: 2 }).toUpperCase() || 'KR', pkg[0], pkg[1], pkg[2], pkg[3], volWeight, str(b.warehouse_location, { max: 50 }) || null),
        env.DB.prepare(
          `INSERT INTO product_skus (id, product_id, sku_code, option_combination_json, original_price, sale_price, stock_quantity, safety_stock, status)
           VALUES (?, ?, ?, ?, ?, ?, ?, 5, ?)`
        ).bind(skuId, prodId, skuCode, optJson, orig, sale, stock, stock > 0 ? 'IN_STOCK' : 'OUT_OF_STOCK'),
        ...(stock > 0 ? [env.DB.prepare(`INSERT INTO inventory_ledger (id, sku_id, change_type, quantity_delta, balance_after, reference_id, idempotency_key) VALUES (?, ?, 'RESTOCK', ?, ?, ?, ?)`)
          .bind(newId('ldg'), skuId, stock, stock, partnerId, `init:${skuId}`)] : [])
      ]);
    } catch (e) {
      if (String(e.message).includes('UNIQUE')) throw conflict('SKU_CODE_TAKEN', '이미 사용 중인 SKU 코드입니다.');
      throw e;
    }
    const data = { product_id: prodId, sku_id: skuId, sku_code: skuCode, status: 'DRAFT', review_status: 'PENDING' };
    return json(corsHeaders, { success: true, ...data, data, message: '상품이 등록되었습니다. 운영자 심사 승인 후 판매가 시작됩니다.' }, 201);
  }

  if (p === '/api/v1/partner/products/bulk' && request.method === 'POST') {
    const b = await readJson(request, { maxBytes: 2_000_000 });
    const rows = Array.isArray(b.items) ? b.items.slice(0, 200) : [];
    if (!rows.length) throw bad('EMPTY', '업로드할 상품이 없습니다.');
    const st = [];
    const created = [];
    const errors = [];
    for (const [i, row] of rows.entries()) {
      try {
        const title = str(row.title, { field: 'title', max: 200, required: true });
        const { sale, orig } = priceFields(row);
        const stock = intParam(row.stock_quantity ?? 0, { min: 0, max: 1_000_000, field: 'stock_quantity' });
        const catId = await resolveCategory(env, row);
        const prodId = newId('prod');
        const skuId = newId('sku');
        const skuCode = str(row.sku_code, { max: 60 }) || `SKU-${skuId.slice(-10).toUpperCase()}`;
        st.push(env.DB.prepare(
          `INSERT INTO products (id, partner_id, category_id, title, thumbnail_url, description_html, lowest_original_price, lowest_sale_price, status, review_status)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'DRAFT', 'PENDING')`
        ).bind(prodId, partnerId, catId, title, str(row.thumbnail_url, { max: 500 }) || '', `<p>${title}</p>`, orig, sale));
        st.push(env.DB.prepare(
          `INSERT INTO product_skus (id, product_id, sku_code, option_combination_json, original_price, sale_price, stock_quantity, safety_stock, status) VALUES (?, ?, ?, ?, ?, ?, ?, 5, ?)`
        ).bind(skuId, prodId, skuCode, row.option_json || '{"옵션":"기본"}', orig, sale, stock, stock > 0 ? 'IN_STOCK' : 'OUT_OF_STOCK'));
        created.push({ row: i + 1, product_id: prodId, sku_id: skuId, sku_code: skuCode, title });
      } catch (e) {
        errors.push({ row: i + 1, error: e.message });
      }
    }
    if (errors.length) return json(corsHeaders, { success: false, code: 'BULK_VALIDATION_FAILED', error: `${errors.length}개 행에 오류가 있어 전체 업로드를 중단했습니다.`, errors }, 400);
    try { await env.DB.batch(st); } catch (e) {
      if (String(e.message).includes('UNIQUE')) throw conflict('SKU_CODE_TAKEN', '중복된 SKU 코드가 있어 전체 업로드를 중단했습니다.');
      throw e;
    }
    const data = { inserted_count: created.length, imported_count: created.length, products: created, items: created };
    return json(corsHeaders, { success: true, partner_id: partnerId, ...data, data, message: `${created.length}건이 심사 대기 상태로 등록되었습니다.` }, 201);
  }

  const prodM = p.match(/^\/api\/v1\/partner\/products\/([^/]+)(?:\/(price|stock))?$/);
  if (prodM && (request.method === 'PUT' || request.method === 'PATCH')) {
    const b = await readJson(request);
    const targetId = prodM[1];
    if (prodM[2] === 'stock') {
      const sku = await env.DB.prepare(
        `SELECT s.id, s.product_id, s.stock_quantity FROM product_skus s JOIN products p ON p.id = s.product_id
         WHERE (s.id = ? OR (s.product_id = ? AND ? IS NULL)) AND p.partner_id = ? ORDER BY s.sku_code LIMIT 1`
      ).bind(b.sku_id || targetId, targetId, b.sku_id || null, partnerId).first();
      if (!sku) throw forbidden('본인 상품의 옵션만 수정할 수 있습니다.');
      const target = intParam(b.stock_quantity, { min: 0, max: 1_000_000, field: '재고' });
      const delta = target - sku.stock_quantity;
      // Optimistic concurrency: if a checkout reserved stock since we read it, nothing is written.
      const r = await env.DB.batch([
        env.DB.prepare("UPDATE product_skus SET stock_quantity = ?, status = CASE WHEN ? > 0 THEN 'IN_STOCK' ELSE 'OUT_OF_STOCK' END, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND stock_quantity = ?")
          .bind(target, target, sku.id, sku.stock_quantity),
        env.DB.prepare(`INSERT INTO inventory_ledger (id, sku_id, change_type, quantity_delta, balance_after, reference_id, idempotency_key)
                        SELECT ?, ?, 'MANUAL_ADJUST', ?, ?, ?, ? WHERE (SELECT stock_quantity FROM product_skus WHERE id = ?) = ?`)
          .bind(newId('ldg'), sku.id, delta, target, partnerId, newId('adj'), sku.id, target)
      ]);
      if (r[0].meta.changes !== 1) throw conflict('STOCK_CHANGED', '그 사이 주문이 발생해 재고가 변경되었습니다. 새로고침 후 다시 시도해 주세요.');
      return json(corsHeaders, { success: true, product_id: sku.product_id, sku_id: sku.id, stock_quantity: target, previous_stock: sku.stock_quantity, delta });
    }

    const product = await env.DB.prepare('SELECT * FROM products WHERE id = ? AND partner_id = ?').bind(targetId, partnerId).first();
    if (!product) throw notFound('상품을 찾을 수 없거나 권한이 없습니다.');
    const { sale, orig } = priceFields(b, { sale: product.lowest_sale_price, orig: product.lowest_original_price });
    if (prodM[2] === 'price') {
      await env.DB.batch([
        env.DB.prepare('UPDATE products SET lowest_sale_price = ?, lowest_original_price = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').bind(sale, orig, product.id),
        env.DB.prepare('UPDATE product_skus SET sale_price = ?, original_price = ?, updated_at = CURRENT_TIMESTAMP WHERE product_id = ?').bind(sale, orig, product.id)
      ]);
      return json(corsHeaders, { success: true, product_id: product.id, lowest_sale_price: sale, lowest_original_price: orig });
    }
    const title = b.title !== undefined ? str(b.title, { field: '상품명', max: 200, required: true }) : product.title;
    const descChanged = b.description_html !== undefined && b.description_html !== product.description_html;
    const contentChanged = descChanged || title !== product.title || (b.thumbnail_url && b.thumbnail_url !== product.thumbnail_url);
    const catId = b.category_id || b.category_slug ? await resolveCategory(env, b) : product.category_id;
    await env.DB.batch([
      env.DB.prepare(
        `UPDATE products SET title = ?, description_html = ?, thumbnail_url = ?, category_id = ?, lowest_original_price = ?, lowest_sale_price = ?,
           hs_code = ?, country_origin = ?, review_status = CASE WHEN ? = 1 AND review_status = 'APPROVED' THEN 'PENDING' ELSE review_status END,
           status = CASE WHEN ? = 1 AND status = 'ACTIVE' THEN 'DRAFT' ELSE status END, updated_at = CURRENT_TIMESTAMP
         WHERE id = ? AND partner_id = ?`
      ).bind(title, b.description_html !== undefined ? str(b.description_html, { max: 200000 }) : product.description_html,
        b.thumbnail_url || product.thumbnail_url, catId, orig, sale, b.hs_code ?? product.hs_code, (b.country_origin || product.country_origin || 'KR').toUpperCase(),
        contentChanged ? 1 : 0, contentChanged ? 1 : 0, product.id, partnerId),
      env.DB.prepare('UPDATE product_skus SET sale_price = ?, original_price = ?, updated_at = CURRENT_TIMESTAMP WHERE product_id = ?').bind(sale, orig, product.id)
    ]);
    return json(corsHeaders, {
      success: true, message: contentChanged ? '상세 내용이 변경되어 재심사 후 노출됩니다.' : '상품 정보가 수정되었습니다.',
      data: { product_id: product.id, title, sale_price: sale, original_price: orig, review_status: contentChanged ? 'PENDING' : product.review_status }
    });
  }

  if (p === '/api/v1/partner/orders' && request.method === 'GET') {
    const { results: subs } = await env.DB.prepare(
      `SELECT s.*, o.order_no, o.payment_status, o.recipient_name, o.recipient_phone, o.shipping_address_line1, o.shipping_address_line2, o.shipping_postal_code, o.shipping_memo,
              o.pccc, o.customs_duty_type, o.created_at AS order_date
       FROM sub_orders s JOIN orders o ON s.parent_order_id = o.id
       WHERE s.partner_id = ? AND s.status NOT IN ('PAYMENT_PENDING','EXPIRED') ORDER BY s.created_at DESC LIMIT 500`
    ).bind(partnerId).all();
    for (const s of subs) {
      s.items = (await env.DB.prepare('SELECT i.*, p.thumbnail_url FROM order_items i LEFT JOIN products p ON p.id = i.product_id WHERE i.sub_order_id = ?').bind(s.id).all()).results;
    }
    return json(corsHeaders, { success: true, partner_id: partnerId, count: subs.length, data: subs });
  }

  async function ship(subOrderId, carrier, tracking) {
    if (!tracking || !/^[A-Za-z0-9-]{6,40}$/.test(tracking)) throw bad('INVALID_TRACKING', '송장번호 형식이 올바르지 않습니다.');
    const r = await env.DB.batch([
      env.DB.prepare(`UPDATE sub_orders SET carrier_code = ?, tracking_number = ?, status = 'SHIPPED', milestone_status = 'SHIPPED', shipped_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
                      WHERE id = ? AND partner_id = ? AND status IN ('PAYMENT_CONFIRMED','PREPARING')`).bind(carrier, tracking, subOrderId, partnerId),
      env.DB.prepare(`INSERT INTO milestone_tracking_logs (id, sub_order_id, carrier_code, tracking_number, stage_code, stage_name, location, description, occurred_at)
                      SELECT ?, ?, ?, ?, 'SHIPPED', '판매자 출고', '판매자 출고지', '운송장이 등록되었습니다.', CURRENT_TIMESTAMP
                      WHERE EXISTS (SELECT 1 FROM sub_orders WHERE id = ? AND partner_id = ? AND tracking_number = ? AND status = 'SHIPPED')`)
        .bind(newId('trk'), subOrderId, carrier, tracking, subOrderId, partnerId, tracking)
    ]);
    return r[0].meta.changes === 1;
  }

  if (p === '/api/v1/partner/orders/bulk-shipment' && (request.method === 'PUT' || request.method === 'POST')) {
    const b = await readJson(request);
    const list = Array.isArray(b.shipments) ? b.shipments.slice(0, 500) : [];
    if (!list.length) throw bad('EMPTY', '송장 목록이 비어 있습니다.');
    const results = [];
    for (const s of list) {
      try {
        const ok = await ship(String(s.sub_order_id || ''), str(s.carrier || s.carrier_code, { max: 40 }) || 'CJ대한통운', String(s.tracking_number || '').trim());
        results.push({ sub_order_id: s.sub_order_id, ok, error: ok ? undefined : '출고 가능한 상태가 아니거나 본인 주문이 아닙니다.' });
      } catch (e) {
        results.push({ sub_order_id: s.sub_order_id, ok: false, error: e.message });
      }
    }
    const updated = results.filter((r) => r.ok).length;
    return json(corsHeaders, { success: updated === results.length, updated_count: updated, failed_count: results.length - updated, results });
  }

  const shipM = p.match(/^\/api\/v1\/partner\/orders\/([^/]+)\/shipment$/);
  if (shipM && (request.method === 'PUT' || request.method === 'POST')) {
    const b = await readJson(request);
    const carrier = str(b.carrier || b.carrier_code, { max: 40 }) || 'CJ대한통운';
    const tracking = String(b.tracking_number || '').trim();
    const ok = await ship(shipM[1], carrier, tracking);
    if (!ok) throw conflict('NOT_SHIPPABLE', '결제 완료(출고 대기) 상태의 본인 주문만 출고 처리할 수 있습니다.');
    return json(corsHeaders, { success: true, sub_order_id: shipM[1], carrier, tracking_number: tracking, status: 'SHIPPED' });
  }

  const prepM = p.match(/^\/api\/v1\/partner\/orders\/([^/]+)\/prepare$/);
  if (prepM && request.method === 'POST') {
    const r = await env.DB.prepare("UPDATE sub_orders SET status = 'PREPARING', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND partner_id = ? AND status = 'PAYMENT_CONFIRMED'").bind(prepM[1], partnerId).run();
    if (r.meta.changes !== 1) throw conflict('NOT_CONFIRMABLE', '결제 완료 상태의 본인 주문만 발주 확인할 수 있습니다.');
    return json(corsHeaders, { success: true, status: 'PREPARING' });
  }

  if (p === '/api/v1/partner/settlements' && request.method === 'GET') {
    const { results } = await env.DB.prepare(
      `SELECT st.*, sub.sub_order_no, sub.status AS sub_order_status, o.order_no, o.created_at AS order_date,
              COALESCE((SELECT SUM(a.net_delta) FROM settlement_adjustments a WHERE a.settlement_id = st.id), 0) AS adjustment_total
       FROM settlements st JOIN sub_orders sub ON st.sub_order_id = sub.id JOIN orders o ON sub.parent_order_id = o.id
       WHERE st.partner_id = ? AND st.status != 'HOLD' ORDER BY st.created_at DESC`
    ).bind(partnerId).all();
    const live = results.filter((s) => s.status !== 'CANCELLED');
    const eff = (s) => s.net_payout_amount + s.adjustment_total;
    const summary = {
      gross_sales: live.reduce((a, s) => a + s.gross_amount, 0),
      total_commission: live.reduce((a, s) => a + s.commission_amount, 0),
      adjustments: live.reduce((a, s) => a + s.adjustment_total, 0),
      net_payout: live.reduce((a, s) => a + eff(s), 0),
      pending_amount: live.filter((s) => s.status === 'PENDING').reduce((a, s) => a + eff(s), 0),
      eligible_amount: live.filter((s) => s.status === 'ELIGIBLE_FOR_PAYOUT').reduce((a, s) => a + eff(s), 0),
      paid_amount: live.filter((s) => s.status === 'PAID_OUT').reduce((a, s) => a + s.net_payout_amount, 0)
    };
    summary.totalGross = summary.gross_sales; summary.commission = summary.total_commission; summary.netPayout = summary.net_payout;
    const { results: payouts } = await env.DB.prepare('SELECT id, amount, status, bank_transfer_ref, created_at FROM payouts WHERE partner_id = ? ORDER BY created_at DESC LIMIT 50').bind(partnerId).all();
    const rows = results.map((s) => ({ ...s, order_id: s.order_no, effective_net_payout: eff(s), settlement_status: s.status }));
    return json(corsHeaders, { success: true, partner_id: partnerId, business_name: partner.business_name, summary, count: rows.length, settlements: rows, payouts, data: { settlements: rows, summary, payouts } });
  }

  if (p === '/api/v1/partner/qna' && request.method === 'GET') {
    const { results } = await env.DB.prepare('SELECT q.*, p.title AS product_title FROM product_qna q JOIN products p ON q.product_id = p.id WHERE q.partner_id = ? ORDER BY q.created_at DESC').bind(partnerId).all();
    return json(corsHeaders, { success: true, count: results.length, data: results });
  }

  const qnaM = p.match(/^\/api\/v1\/partner\/qna\/([^/]+)\/answer$/);
  if (qnaM && request.method === 'POST') {
    const b = await readJson(request);
    const answer = str(b.answer, { field: '답변', max: 2000, required: true });
    const r = await env.DB.prepare("UPDATE product_qna SET answer = ?, status = 'ANSWERED', answered_at = CURRENT_TIMESTAMP WHERE id = ? AND partner_id = ?").bind(answer, qnaM[1], partnerId).run();
    if (r.meta.changes !== 1) throw notFound('문의를 찾을 수 없습니다.');
    return json(corsHeaders, { success: true, qna_id: qnaM[1], status: 'ANSWERED' });
  }

  if (p === '/api/v1/partner/returns' && request.method === 'GET') {
    const { results } = await env.DB.prepare(
      `SELECT r.*, o.order_no, so.sub_order_no, so.goods_amount, so.shipping_fee, so.total_amount, u.email AS customer_email, u.full_name AS customer_name
       FROM returns r JOIN sub_orders so ON so.id = r.sub_order_id JOIN orders o ON o.id = r.order_id LEFT JOIN users u ON u.id = r.user_id
       WHERE so.partner_id = ? ORDER BY r.created_at DESC`
    ).bind(partnerId).all();
    return json(corsHeaders, { success: true, partner_id: partnerId, count: results.length, data: results });
  }

  const retM = p.match(/^\/api\/v1\/partner\/returns\/([^/]+)(?:\/status)?$/);
  if (retM && (request.method === 'PUT' || request.method === 'POST')) {
    const b = await readJson(request);
    const claim = await env.DB.prepare('SELECT r.*, so.partner_id FROM returns r JOIN sub_orders so ON so.id = r.sub_order_id WHERE r.id = ?').bind(retM[1]).first();
    if (!claim || claim.partner_id !== partnerId) throw forbidden('본인 판매 주문의 클레임만 처리할 수 있습니다.');
    if (claim.status !== 'REQUESTED') throw conflict('CLAIM_ALREADY_PROCESSED', `이미 처리된 클레임입니다. (${claim.status})`);
    const decision = String(b.decision || b.status || '').toUpperCase();
    const notes = str(b.notes || b.comment, { max: 500 });
    if (decision === 'REJECTED' || decision === 'REJECT') {
      if (!notes) throw bad('REASON_REQUIRED', '거절 사유를 입력해 주세요.');
      await env.DB.batch([
        env.DB.prepare("UPDATE returns SET status = 'REJECTED', notes = ?, processed_by = ?, processed_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'REQUESTED'").bind(notes, me.userId, claim.id),
        env.DB.prepare("UPDATE sub_orders SET status = 'DELIVERED', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'RETURN_REQUESTED'").bind(claim.sub_order_id)
      ]);
      return json(corsHeaders, { success: true, claim_id: claim.id, status: 'REJECTED' });
    }
    if (!['APPROVED', 'APPROVE', 'REFUNDED'].includes(decision)) throw bad('INVALID_DECISION', 'decision은 APPROVE 또는 REJECT 이어야 합니다.');
    if (claim.claim_type === 'EXCHANGE') {
      await env.DB.prepare("UPDATE returns SET status = 'APPROVED', notes = ?, processed_by = ?, processed_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'REQUESTED'").bind(notes || null, me.userId, claim.id).run();
      return json(corsHeaders, { success: true, claim_id: claim.id, status: 'APPROVED', next_action: '교환품을 재출고해 주세요.' });
    }
    const lines = JSON.parse(claim.items_json || '[]');
    const returnless = b.returnless === true;
    const r = await refundOrder(env, me, claim.order_id, {
      lines, shippingSubOrderIds: [], subOrderId: claim.sub_order_id, claimId: claim.id, reasonCode: 'RETURN',
      restock: !returnless && b.restock !== false, idemKey: `claim:${claim.id}`, subStatusOnFull: 'RETURNED', orderStatusOnFull: 'REFUNDED'
    });
    if (returnless) await env.DB.prepare("UPDATE returns SET is_returnless = 1, returnless_reason = ? WHERE id = ?").bind(notes || '판매자 회수 생략 승인', claim.id).run();
    const after = await loadOrderBundle(env, claim.order_id);
    const sub = after.subs.find((s) => s.id === claim.sub_order_id);
    if (sub && sub.status === 'RETURN_REQUESTED') await env.DB.prepare("UPDATE sub_orders SET status = 'DELIVERED' WHERE id = ? AND status = 'RETURN_REQUESTED'").bind(sub.id).run();
    return json(corsHeaders, { success: true, claim_id: claim.id, status: 'REFUNDED', refund: r.refund });
  }

  if (p === '/api/v1/partner/metrics' && request.method === 'GET') {
    const q = (sql) => env.DB.prepare(sql).bind(partnerId).first();
    const prod = await q('SELECT COUNT(*) c FROM products WHERE partner_id = ?');
    const ord = await q("SELECT COUNT(*) c, COALESCE(SUM(goods_amount + shipping_fee),0) s FROM sub_orders WHERE partner_id = ? AND status NOT IN ('PAYMENT_PENDING','EXPIRED','CANCELLED')");
    const toShip = await q("SELECT COUNT(*) c FROM sub_orders WHERE partner_id = ? AND status IN ('PAYMENT_CONFIRMED','PREPARING')");
    const stl = await q("SELECT COALESCE(SUM(net_payout_amount + COALESCE((SELECT SUM(a.net_delta) FROM settlement_adjustments a WHERE a.settlement_id = settlements.id),0)),0) n FROM settlements WHERE partner_id = ? AND status IN ('PENDING','ELIGIBLE_FOR_PAYOUT')");
    const qna = await q("SELECT COUNT(*) c FROM product_qna WHERE partner_id = ? AND status = 'WAITING'");
    const claims = await q("SELECT COUNT(*) c FROM returns r JOIN sub_orders so ON so.id = r.sub_order_id WHERE so.partner_id = ? AND r.status = 'REQUESTED'");
    const review = await q("SELECT COUNT(*) c FROM products WHERE partner_id = ? AND review_status = 'PENDING'");
    return json(corsHeaders, {
      success: true, partner_id: partnerId, business_name: partner.business_name,
      products_count: prod.c, orders_count: ord.c, total_sales_amount: ord.s, to_ship_count: toShip.c,
      settlement_expected_amount: stl.n, waiting_qna_count: qna.c, open_claims_count: claims.c, pending_review_count: review.c
    });
  }

  return null;
}
