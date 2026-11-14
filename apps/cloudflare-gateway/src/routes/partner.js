// apps/cloudflare-gateway/src/routes/partner.js
// Seller center API. Tenant = partner bound to the authenticated ROLE_PARTNER user (never a request header).

import { computeServerQualityScore } from './catalog.js';
import { requireAuth } from '../lib/auth.js';
import { json, readJson, bad, conflict, forbidden, notFound, str, safeUrl, intParam, csvResponse, HttpError } from '../lib/http.js';
import { newId } from '../lib/ids.js';
import { refundOrder, loadOrderBundle } from '../services/orders.js';
import { logPiiView, maskLast4 } from '../services/privacy.js';
import { sealPii, maybeOpenPii } from '../lib/pii-crypto.js';
import { partnerReturnFees, returnFeeFor, isFullReturn } from '../services/claims.js';
import { pushOrderShipped, notifyUser } from '../services/push.js';
import { priceHistoryStatements, skuIdsOfProduct } from '../lib/price-history.js';
import { sanitizeHtml } from '../services/crawler/html-sanitizer.js';
import { payablePreview, withdrawableAmount, requestPayout, cancelPayoutRequest } from '../services/payouts.js';


function optionSummary(json) {
  try {
    return Object.entries(JSON.parse(json || '{}')).map(([k, v]) => `${k}:${v}`).join(' / ') || '기본';
  } catch {
    return '기본';
  }
}

// 2-9: recipient masking for seller lists. Postal codes stay visible
// (routing need, low sensitivity); the full text needs a reason + access log.
function maskName(v) {
  const s = String(v || '');
  if (s.length <= 1) return '*';
  if (s.length === 2) return `${s[0]}*`;
  return `${s[0]}${'*'.repeat(s.length - 2)}${s[s.length - 1]}`;
}

function maskPhone(v) {
  const d = String(v || '').replace(/\D/g, '');
  if (d.length >= 10) return `${d.slice(0, 3)}-****-${d.slice(-4)}`;
  if (d.length <= 4) return '****';
  return `${d.slice(0, 2)}${'*'.repeat(d.length - 4)}${d.slice(-2)}`;
}

function maskAddress(v) {
  const s = String(v || '');
  if (!s) return s;
  return s.length <= 6 ? '***' : `${s.slice(0, 6)}***`;
}

const STORAGE_PREFIX = '/api/v1/storage/file/';

function storageImage(u, field = '이미지') {
  const s = str(u, { field, max: 500, required: true });
  if (!s.startsWith(STORAGE_PREFIX)) throw bad('INVALID_IMAGE_URL', `${field}은 자사 저장소(${STORAGE_PREFIX}…) 이미지여야 합니다.`);
  return s;
}

export function priceFields(body, fallback = {}) {
  const sale = intParam(body.sale_price ?? body.price ?? body.lowest_sale_price ?? fallback.sale, { min: 100, max: 100_000_000, field: '판매가' });
  const orig = intParam(body.original_price ?? body.lowest_original_price ?? fallback.orig ?? sale, { min: sale, max: 100_000_000, field: '정상가' });
  return { sale, orig };
}

export async function resolveCategory(env, body, fallback) {
  const ref = body.category_slug || body.category_id || fallback;
  if (!ref) throw bad('CATEGORY_REQUIRED', '카테고리를 지정해 주세요.');
  const cat = await env.DB.prepare('SELECT id FROM categories WHERE (slug = ? OR id = ?) AND is_active = 1').bind(ref, ref).first();
  if (!cat) throw bad('INVALID_CATEGORY', '존재하지 않는 카테고리입니다.');
  return cat.id;
}


// NEW-11: product notice (상품정보제공고시) key-value payload. Accepts an object
// or its JSON string; returns the canonical JSON string or null (not entered).
// Anything malformed is a 400, never a silent drop or a default table.
function parseNoticeInfo(value) {
  if (value === undefined || value === null || value === '') return null;
  let obj = value;
  if (typeof obj === 'string') {
    try { obj = JSON.parse(obj); } catch { throw bad('INVALID_NOTICE_INFO', '상품정보제공고시 형식이 올바르지 않습니다.'); }
  }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) throw bad('INVALID_NOTICE_INFO', '상품정보제공고시는 항목명-내용 쌍이어야 합니다.');
  const keys = Object.keys(obj);
  if (keys.length > 50) throw bad('INVALID_NOTICE_INFO', '고시 항목은 50개를 넘을 수 없습니다.');
  const clean = {};
  for (const k of keys) {
    const key = String(k).trim();
    const val = String(obj[k] ?? '').trim();
    if (!key || !val) throw bad('INVALID_NOTICE_INFO', '고시 항목명과 내용을 모두 입력해 주세요.');
    if (key.length > 200 || val.length > 200) throw bad('INVALID_NOTICE_INFO', '고시 항목은 각 200자 이내로 입력해 주세요.');
    clean[key] = val;
  }
  return JSON.stringify(clean);
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
    const ownAccount = await maybeOpenPii(env, partner.bank_account_number);
    return json(corsHeaders, {
      success: true, partner_id: partnerId,
      data: {
        id: partner.id, business_name: partner.business_name, business_reg_number: partner.business_reg_number, status: partner.status,
        sales_model: partner.sales_model, commission_rate: (partner.commission_rate_bps ?? partner.commission_rate * 100) / 100,
        bank_code: partner.bank_code, bank_account_number: ownAccount ? maskLast4(ownAccount) : null,
        bank_account_holder: await maybeOpenPii(env, partner.bank_account_holder), payout_account_verified: Number(partner.payout_account_verified) === 1,
        payout_change_pending: Boolean(partner.payout_change_request_json),
        settlement_cycle: partner.settlement_cycle, return_shipping_address: partner.return_shipping_address,
        customer_service_phone: partner.customer_service_phone, base_shipping_fee: partner.base_shipping_fee, free_shipping_threshold: partner.free_shipping_threshold,
        representative_name: partner.representative_name, mail_order_reg_number: partner.mail_order_reg_number,
        business_address: partner.business_address, cs_email: partner.cs_email,
        return_shipping_fee: partner.return_shipping_fee ?? partner.base_shipping_fee
      }
    });
  }

  if (partner.status !== 'APPROVED') {
    throw new HttpError(403, 'PARTNER_NOT_APPROVED', `입점 심사 상태(${partner.status})에서는 이용할 수 없습니다.`);
  }

  // 2-9: fulfillment pipeline. Every count uses the same condition as its
  // list API (status filter, WAITING qna, REQUESTED claims).
  if (p === '/api/v1/partner/dashboard/pipeline' && request.method === 'GET') {
    const n = async (sql, ...a) => (await env.DB.prepare(sql).bind(partnerId, ...a).first('c')) || 0;
    const newOrders = await n("SELECT COUNT(*) AS c FROM sub_orders WHERE partner_id = ? AND status = 'PAYMENT_CONFIRMED'");
    const preparing = await n("SELECT COUNT(*) AS c FROM sub_orders WHERE partner_id = ? AND status = 'PREPARING'");
    const dueToday = await n("SELECT COUNT(*) AS c FROM sub_orders WHERE partner_id = ? AND status IN ('PAYMENT_CONFIRMED','PREPARING') AND ship_by_deadline = date('now')");
    const inTransit = await n("SELECT COUNT(*) AS c FROM sub_orders WHERE partner_id = ? AND status IN ('SHIPPED','IN_TRANSIT')");
    const cancelRequests = await n("SELECT COUNT(*) AS c FROM sub_orders WHERE partner_id = ? AND status = 'CANCEL_REQUESTED'");
    const returnRequests = await n("SELECT COUNT(*) AS c FROM returns r JOIN sub_orders s ON s.id = r.sub_order_id WHERE s.partner_id = ? AND r.claim_type = 'RETURN' AND r.status = 'REQUESTED'");
    const exchangeRequests = await n("SELECT COUNT(*) AS c FROM returns r JOIN sub_orders s ON s.id = r.sub_order_id WHERE s.partner_id = ? AND r.claim_type = 'EXCHANGE' AND r.status = 'REQUESTED'");
    const unansweredQna = await n("SELECT COUNT(*) AS c FROM product_qna WHERE partner_id = ? AND status = 'WAITING'");
    const qnaOverdue = await n("SELECT COUNT(*) AS c FROM product_qna WHERE partner_id = ? AND status = 'WAITING' AND created_at < datetime('now', '-24 hours')");
    const stl = await env.DB.prepare(
      `SELECT COALESCE(SUM(st.net_payout_amount + COALESCE((SELECT SUM(a.net_delta) FROM settlement_adjustments a WHERE a.settlement_id = st.id), 0)), 0) AS e
       FROM settlements st WHERE st.partner_id = ? AND st.status IN ('PENDING','ELIGIBLE_FOR_PAYOUT')`
    ).bind(partnerId).first('e');
    const grade = await env.DB.prepare(
      'SELECT grade_code, month FROM partner_grades WHERE partner_id = ? ORDER BY month DESC LIMIT 1'
    ).bind(partnerId).first();
    const pen = await env.DB.prepare(
      "SELECT COUNT(*) AS c, COALESCE(SUM(points), 0) AS pts FROM partner_penalties WHERE partner_id = ? AND created_at >= date('now', '-30 days')"
    ).bind(partnerId).first();
    const data = {
      new_orders: newOrders, preparing, due_today: dueToday, in_transit: inTransit,
      cancel_requests: cancelRequests, return_requests: returnRequests, exchange_requests: exchangeRequests,
      unanswered_qna: unansweredQna, qna_overdue_24h: qnaOverdue,
      settlement: {
        expected_amount: Number(stl) || 0,
        withdrawable_amount: await withdrawableAmount(env, partnerId),
        next_payout_date: null // payouts are on-request; no scheduled payout date exists
      },
      penalty_count: pen.c, penalty_points: pen.pts,
      grade: grade ? { grade_code: grade.grade_code, month: grade.month } : null
    };
    return json(corsHeaders, { success: true, ...data, data });
  }

  if (p === '/api/v1/partner/profile' && (request.method === 'PUT' || request.method === 'PATCH')) {
    const b = await readJson(request);
    const fee = b.base_shipping_fee !== undefined ? intParam(b.base_shipping_fee, { min: 0, max: 100000, field: '기본 배송비' }) : partner.base_shipping_fee;
    const threshold = b.free_shipping_threshold !== undefined ? intParam(b.free_shipping_threshold, { min: 0, max: 10_000_000, field: '무료배송 기준' }) : partner.free_shipping_threshold;
    // NEW-10: business address + CS email are seller-editable identity fields.
    const businessAddr = b.business_address !== undefined ? str(b.business_address, { field: '사업장 주소', max: 300 }) : partner.business_address;
    const csEmail = b.cs_email !== undefined ? str(b.cs_email, { field: '고객센터 이메일', max: 254 }).toLowerCase() : partner.cs_email;
    if (csEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(csEmail)) throw bad('INVALID_EMAIL', '고객센터 이메일 형식이 올바르지 않습니다.');
    if (b.representative_name && b.representative_name !== partner.representative_name) throw conflict('REPRESENTATIVE_LOCKED', '대표자명 변경은 사업자등록증 재심사가 필요합니다. 고객센터로 요청해 주세요.');
    if (b.mail_order_reg_number && b.mail_order_reg_number !== partner.mail_order_reg_number) throw conflict('MAIL_ORDER_LOCKED', '통신판매업 신고번호 변경은 재심사가 필요합니다. 고객센터로 요청해 주세요.');
    // T10: unknown cycle values are a 400, never a silent keep of the old value.
    if (b.settlement_cycle !== undefined && !['WEEKLY', 'BIWEEKLY', 'MONTHLY'].includes(b.settlement_cycle)) {
      throw bad('INVALID_CYCLE', '정산 주기는 WEEKLY, BIWEEKLY, MONTHLY 중 하나여야 합니다.');
    }
    const st = [env.DB.prepare(
      `UPDATE partners SET settlement_cycle = ?, return_shipping_address = ?, customer_service_phone = ?, business_address = ?, cs_email = ?, base_shipping_fee = ?, free_shipping_threshold = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`
    ).bind(b.settlement_cycle !== undefined ? b.settlement_cycle : partner.settlement_cycle,
      b.return_shipping_address !== undefined ? str(b.return_shipping_address, { max: 200 }) : partner.return_shipping_address,
      b.customer_service_phone !== undefined ? str(b.customer_service_phone, { max: 30 }) : partner.customer_service_phone, businessAddr, csEmail, fee, threshold, partnerId)];
    if (b.return_shipping_fee !== undefined) {
      // O14: one-way return courier fee withheld on customer-fault returns (shown to buyers before they request a return).
      const rf = b.return_shipping_fee === null ? null : intParam(b.return_shipping_fee, { min: 0, max: 100000, field: '반품 배송비(편도)' });
      st.push(env.DB.prepare('UPDATE partners SET return_shipping_fee = ? WHERE id = ?').bind(rf, partnerId));
    }
    let payoutChange = false;
    // The profile API returns the account number masked ("****1234"); echoing it back is not a change request.
    if (typeof b.bank_account_number === 'string' && b.bank_account_number.includes('*')) delete b.bank_account_number;
    // SEC-10: compare against the opened values — the stored ciphertext never equals a plaintext resubmission.
    const storedAccount = await maybeOpenPii(env, partner.bank_account_number);
    const storedHolder = await maybeOpenPii(env, partner.bank_account_holder);
    const bankChanged = (b.bank_code && b.bank_code !== partner.bank_code) || b.bank_account_number || (b.bank_account_holder && b.bank_account_holder !== storedHolder);
    if (bankChanged) {
      // Payout account changes are a classic takeover vector: queue for operator verification, never apply directly.
      // The queued request holds sealed values (approved verbatim); plaintext is validated, then sealed.
      payoutChange = true;
      const reqAccount = str(b.bank_account_number || storedAccount, { max: 30 });
      const reqHolder = str(b.bank_account_holder || storedHolder, { max: 50 });
      st.push(env.DB.prepare('UPDATE partners SET payout_change_request_json = ? WHERE id = ?').bind(JSON.stringify({
        bank_code: str(b.bank_code || partner.bank_code, { max: 20 }),
        bank_account_number: await sealPii(env, reqAccount), bank_account_holder: await sealPii(env, reqHolder),
        requested_by: me.userId, requested_at: new Date().toISOString()
      }), partnerId));
    }
    if (b.business_name && b.business_name !== partner.business_name) throw conflict('BUSINESS_NAME_LOCKED', '상호 변경은 사업자등록증 재심사가 필요합니다. 고객센터로 요청해 주세요.');
    await env.DB.batch(st);
    return json(corsHeaders, { success: true, message: payoutChange ? '설정이 저장되었습니다. 정산 계좌 변경은 운영자 실명 확인 후 반영됩니다.' : '설정이 저장되었습니다.', payout_change_pending: payoutChange });
  }

  // NEW-15: the seller's own commission tax invoices (shown on the settlement screen).
  if (p === '/api/v1/partner/tax-invoices' && request.method === 'GET') {
    const { results } = await env.DB.prepare(
      `SELECT id, invoice_type, partner_id, supply_amount, vat_amount, total_amount, issue_status,
              hometax_approval_no, item_title, period_start, period_end, issued_at, created_at
       FROM tax_invoices WHERE partner_id = ? AND invoice_type = 'TAX_INVOICE_SALES' ORDER BY created_at DESC LIMIT 100`
    ).bind(partnerId).all();
    return json(corsHeaders, { success: true, count: results.length, data: results });
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
    // 2-9: the authoring guide must not survive into the published description.
    const rawDesc = b.description_html !== undefined ? str(b.description_html, { max: 200000 }) : '';
    if (rawDesc.includes('[판매자 작성]')) throw bad('TEMPLATE_TEXT_LEFT', '상세설명의 안내 문구([판매자 작성]…)를 지우고 실제 내용을 입력해 주세요.');
    const catId = await resolveCategory(env, b);
    const custody = b.custody_type !== undefined ? str(b.custody_type, { max: 20 }) : 'SEMI_MANAGED';
    if (!['FULL_MANAGED', 'SEMI_MANAGED'].includes(custody)) throw bad('INVALID_CUSTODY', '운영 모델이 올바르지 않습니다.');
    const supply = b.supply_price !== undefined && b.supply_price !== null ? intParam(b.supply_price, { min: 0, max: 100_000_000, field: '공급가' }) : null;
    const brand = str(b.brand, { max: 100 }) || null;
    // 2-9 gallery (own storage only), options (<=3 kinds), skus (<=200, unique combos).
    const images = b.images !== undefined ? b.images : null;
    if (images !== null) {
      if (!Array.isArray(images) || !images.length) throw bad('INVALID_IMAGES', 'images는 1개 이상의 이미지 배열이어야 합니다.');
      if (images.length > 10) throw bad('TOO_MANY_IMAGES', '상품 이미지는 최대 10장까지 등록할 수 있습니다.');
    }
    const gallery = (images || []).map((im, i) => ({
      url: storageImage(im.image_url ?? im.url, `이미지 ${i + 1}`),
      alt: str(im.alt_text ?? im.alt ?? '', { field: '대체 텍스트', max: 200 })
    }));
    const optDefs = b.options !== undefined ? b.options : null;
    if (optDefs !== null) {
      if (!Array.isArray(optDefs) || !optDefs.length) throw bad('INVALID_OPTIONS', 'options는 1개 이상의 옵션 배열이어야 합니다.');
      if (optDefs.length > 3) throw bad('TOO_MANY_OPTION_KINDS', '옵션 종류는 최대 3개까지 등록할 수 있습니다.');
    }
    const declared = new Map();
    for (const o of optDefs || []) {
      const name = str(o.name, { field: '옵션명', max: 50, required: true });
      if (declared.has(name)) throw bad('DUPLICATE_OPTION', '옵션명이 중복되었습니다.');
      if (!Array.isArray(o.values) || !o.values.length || o.values.length > 100) throw bad('INVALID_OPTIONS', '옵션 값은 1~100개여야 합니다.');
      declared.set(name, new Set(o.values.map((v) => str(v, { field: '옵션값', max: 100, required: true }))));
    }
    const normCombo = (combo) => {
      const obj = typeof combo === 'string' ? JSON.parse(combo) : combo;
      if (!obj || typeof obj !== 'object' || Array.isArray(obj)) throw bad('INVALID_OPTIONS', '옵션 조합 형식이 올바르지 않습니다.');
      const keys = Object.keys(obj);
      if (!keys.length || keys.length > 3) throw bad('INVALID_OPTIONS', '옵션 조합은 1~3종이어야 합니다.');
      const clean = {};
      for (const k of keys.sort()) {
        const v = str(obj[k], { field: '옵션값', max: 100, required: true });
        if (declared.size && (!declared.has(k) || !declared.get(k).has(v))) throw bad('INVALID_OPTIONS', '선언된 옵션에 없는 조합입니다.');
        clean[k] = v;
      }
      return JSON.stringify(clean);
    };
    let skuRows;
    if (b.skus !== undefined) {
      if (!Array.isArray(b.skus) || !b.skus.length) throw bad('INVALID_SKUS', 'skus는 1개 이상의 배열이어야 합니다.');
      if (b.skus.length > 200) throw bad('TOO_MANY_SKUS', 'SKU는 최대 200개까지 등록할 수 있습니다.');
      if (declared.size) {
        const maxCombos = [...declared.values()].reduce((a, s) => a * s.size, 1);
        if (b.skus.length > maxCombos) throw bad('TOO_MANY_SKUS', 'SKU 수가 옵션 조합 수를 초과했습니다.');
      }
      const seen = new Set();
      skuRows = b.skus.map((s, i) => {
        let comboJson;
        try { comboJson = normCombo(s.option_combination ?? s.option_combination_json ?? '{"옵션":"기본"}'); }
        catch (e) { if (e instanceof HttpError) throw e; throw bad('INVALID_OPTIONS', `SKU ${i + 1}의 옵션 형식이 올바르지 않습니다.`); }
        if (seen.has(comboJson)) throw bad('DUPLICATE_COMBINATION', '중복된 옵션 조합이 있습니다.');
        seen.add(comboJson);
        const pr = priceFields(s);
        return {
          id: newId('sku'), sku_code: str(s.sku_code, { max: 60 }) || null, combo: comboJson,
          orig: pr.orig, sale: pr.sale,
          stock: intParam(s.stock_quantity ?? 0, { min: 0, max: 1_000_000, field: '재고' }),
          safety: intParam(s.safety_stock ?? 5, { min: 0, max: 1_000_000, field: '안전재고' })
        };
      });
      for (const r of skuRows) if (!r.sku_code) r.sku_code = `SKU-${r.id.slice(-10).toUpperCase()}`;
    } else {
      const { sale, orig } = priceFields(b);
      const stock = intParam(b.stock_quantity ?? 0, { min: 0, max: 1_000_000, field: '재고' });
      const skuId = newId('sku');
      let legacyCombo;
      try { legacyCombo = normCombo(b.option_combination_json ?? b.option_combination ?? '{"옵션":"기본"}'); }
      catch (e) { if (e instanceof HttpError) throw e; throw bad('INVALID_OPTIONS', '옵션 형식이 올바르지 않습니다.'); }
      skuRows = [{
        id: skuId, sku_code: str(b.sku_code, { max: 60 }) || `SKU-${skuId.slice(-10).toUpperCase()}`, combo: legacyCombo,
        orig, sale, stock, safety: 5
      }];
    }
    const floorSale = Math.min(...skuRows.map((r) => r.sale));
    const floorOrig = Math.min(...skuRows.map((r) => r.orig));
    // 2-9: notice template + required values, shipping template, bundle key.
    let tplId = null;
    let tplVersion = null;
    if (b.notice_template_id !== undefined && b.notice_template_id !== null && String(b.notice_template_id).trim() !== '') {
      const tpl = await env.DB.prepare("SELECT * FROM notice_templates WHERE id = ? AND is_active = 1").bind(String(b.notice_template_id)).first();
      if (!tpl) throw bad('INVALID_NOTICE_TEMPLATE', '사용할 수 없는 고시 템플릿입니다.');
      tplId = tpl.id;
      tplVersion = tpl.version;
    }
    const noticeInput = b.notice_values ?? b.notice_info ?? b.notice_info_json ?? null;
    const noticeJson = parseNoticeInfo(noticeInput);
    if (tplId) {
      let items = [];
      try { items = JSON.parse((await env.DB.prepare('SELECT items_json FROM notice_templates WHERE id = ?').bind(tplId).first()).items_json || '[]'); } catch { items = []; }
      const vals = noticeJson ? JSON.parse(noticeJson) : {};
      const missing = items.filter((it) => it.required).map((it) => it.key).filter((k) => !k || !String(vals[k] ?? '').trim());
      if (missing.length) throw bad('NOTICE_REQUIRED_MISSING', `고시 필수 항목이 비어 있습니다: ${missing.join(', ')}`);
    }
    let shipTplId = null;
    if (b.shipping_policy_id !== undefined && b.shipping_policy_id !== null && String(b.shipping_policy_id).trim() !== '') {
      const spt = await env.DB.prepare("SELECT id FROM shipping_policies WHERE id = ? AND partner_id = ? AND status = 'ACTIVE'").bind(String(b.shipping_policy_id), partnerId).first();
      if (!spt) throw bad('INVALID_SHIPPING_POLICY', '사용할 수 없는 배송 템플릿입니다.');
      shipTplId = spt.id;
    }
    const bundleKey = b.bundle_group_key !== undefined && b.bundle_group_key !== null && String(b.bundle_group_key).trim() !== ''
      ? str(b.bundle_group_key, { field: '묶음 키', max: 64 }) : null;
    // NEW-11/12: notice table + KC certification (optional at registration; operator reviews them).
    const kcCertified = b.kc_certified === true || b.kc_certified === 1 ? 1 : 0;
    const kcNumber = str(b.kc_cert_number, { max: 60 }) || null;
    if (kcCertified === 1 && !kcNumber) throw bad('KC_NUMBER_REQUIRED', 'KC 인증 대상 상품은 인증번호를 입력해야 합니다.');
    const thumb = gallery.length ? gallery[0].url : (() => {
      const t = str(b.thumbnail_url, { field: '대표 이미지', max: 500, required: true });
      if (!/^https:\/\//.test(t) && !t.startsWith('/api/v1/storage/file/')) throw bad('INVALID_IMAGE_URL', '이미지는 https URL 또는 업로드 파일이어야 합니다.');
      return t;
    })();
    const prodId = newId('prod');
    const pkg = ['package_length_cm', 'package_width_cm', 'package_height_cm', 'package_weight_kg'].map((k) => Number(b[k] || 0));
    const volWeight = Math.round(((pkg[0] * pkg[1] * pkg[2]) / 5000) * 100) / 100;
    try {
      await env.DB.batch([
        env.DB.prepare(
          `INSERT INTO products (id, partner_id, category_id, title, thumbnail_url, description_html, lowest_original_price, lowest_sale_price, status, review_status,
             hs_code, country_origin, package_length_cm, package_width_cm, package_height_cm, package_weight_kg, volumetric_weight_kg, warehouse_location,
             custody_type, supply_price, brand, notice_info_json, notice_template_id, notice_template_version, shipping_policy_id, bundle_group_key, kc_certified, kc_cert_number)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'DRAFT', 'PENDING', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).bind(prodId, partnerId, catId, title, thumb, sanitizeHtml(rawDesc || `<p>${title}</p>`), floorOrig, floorSale,
          str(b.hs_code, { max: 12 }) || null, str(b.country_origin, { max: 2 }).toUpperCase() || 'KR', pkg[0], pkg[1], pkg[2], pkg[3], volWeight, str(b.warehouse_location, { max: 50 }) || null,
          custody, supply, brand, noticeJson, tplId, tplVersion, shipTplId, bundleKey, kcCertified, kcNumber),
        ...skuRows.map((r) => env.DB.prepare(
          `INSERT INTO product_skus (id, product_id, sku_code, option_combination_json, original_price, sale_price, stock_quantity, safety_stock, status)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).bind(r.id, prodId, r.sku_code, r.combo, r.orig, r.sale, r.stock, r.safety, r.stock > 0 ? 'IN_STOCK' : 'OUT_OF_STOCK')),
        ...gallery.map((im, i) => env.DB.prepare(
          'INSERT INTO product_images (id, product_id, image_url, alt_text, sort_order) VALUES (?, ?, ?, ?, ?)'
        ).bind(newId('pimg'), prodId, im.url, im.alt, i)),
        ...skuRows.filter((r) => r.stock > 0).map((r) => env.DB.prepare(`INSERT INTO inventory_ledger (id, sku_id, change_type, quantity_delta, balance_after, reference_id, idempotency_key) VALUES (?, ?, 'RESTOCK', ?, ?, ?, ?)`)
          .bind(newId('ldg'), r.id, r.stock, r.stock, partnerId, `init:${r.id}`))
      ]);
    } catch (e) {
      if (String(e.message).includes('UNIQUE')) throw conflict('SKU_CODE_TAKEN', '이미 사용 중인 SKU 코드입니다.');
      throw e;
    }
    const data = { product_id: prodId, sku_id: skuRows[0].id, sku_code: skuRows[0].sku_code, status: 'DRAFT', review_status: 'PENDING' };
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

  // 2-9: bulk status/price/stock update (own products; failures stay apart).
  // Kept separate from POST .../products/bulk (CSV registration).
  if (p === '/api/v1/partner/products/bulk-update' && (request.method === 'PUT' || request.method === 'POST')) {
    const b = await readJson(request);
    if (!Array.isArray(b.updates) || !b.updates.length) throw bad('UPDATES_REQUIRED', 'updates 배열을 1개 이상 보내 주세요.');
    if (b.updates.length > 500) throw bad('BULK_TOO_LARGE', '한 번에 최대 500개까지 변경할 수 있습니다.');
    const updated = [];
    const failed = [];
    for (const u of b.updates) {
      const pid = String(u.product_id || '').trim();
      try {
        if (!pid) throw bad('PRODUCT_REQUIRED', 'product_id가 비어 있습니다.');
        const prod = await env.DB.prepare('SELECT * FROM products WHERE id = ? AND partner_id = ?').bind(pid, partnerId).first();
        if (!prod) throw notFound('상품을 찾을 수 없거나 권한이 없습니다.');
        const stmts = [];
        if (u.status !== undefined) {
          const st = String(u.status).toUpperCase();
          if (!['HIDDEN', 'DRAFT'].includes(st)) throw bad('INVALID_STATUS', '일괄 변경은 판매중지(HIDDEN·DRAFT)만 가능합니다. 판매 개시는 심사를 거쳐 주세요.');
          stmts.push(env.DB.prepare('UPDATE products SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').bind(st, pid));
        }
        if (u.price !== undefined) {
          const mode = String(u.price.mode || '').toLowerCase();
          const val = Number(u.price.value);
          if (!['set', 'ratio', 'delta'].includes(mode) || !Number.isFinite(val)) throw bad('INVALID_PRICE_OP', 'price는 {mode: set·ratio·delta, value} 형식이어야 합니다.');
          if (mode === 'set' && (!Number.isInteger(val) || val < 100 || val > 100_000_000)) throw bad('INVALID_PRICE', '지정가는 100~100,000,000원 정수여야 합니다.');
          if (mode === 'ratio' && (!Number.isInteger(val) || val < 1 || val > 1000)) throw bad('INVALID_PRICE', '비율은 1~1000(%) 정수여야 합니다.');
          if (mode === 'delta' && (!Number.isInteger(val) || Math.abs(val) > 100_000_000)) throw bad('INVALID_PRICE', '증감액은 정수여야 합니다.');
          const skus = (await env.DB.prepare('SELECT id, sale_price, original_price FROM product_skus WHERE product_id = ?').bind(pid).all()).results;
          for (const s of skus) {
            const next = mode === 'set' ? val : mode === 'ratio' ? Math.round((s.sale_price * val) / 100) : s.sale_price + val;
            if (next < 100 || next > 100_000_000) throw bad('INVALID_PRICE', `SKU ${s.id}의 변경가(${next}원)가 범위를 벗어났습니다.`);
            stmts.push(env.DB.prepare('UPDATE product_skus SET sale_price = ?, original_price = MAX(original_price, ?), updated_at = CURRENT_TIMESTAMP, price_updated_at = CURRENT_TIMESTAMP WHERE id = ?').bind(next, next, s.id));
            if (next !== s.sale_price) stmts.push(...priceHistoryStatements(env, [s.id], { orig: Math.max(s.original_price, next), sale: next, by: me.userId }));
          }
          stmts.push(env.DB.prepare(`UPDATE products SET lowest_sale_price = (SELECT MIN(sale_price) FROM product_skus WHERE product_id = ?),
            lowest_original_price = (SELECT MIN(original_price) FROM product_skus WHERE product_id = ?) WHERE id = ?`).bind(pid, pid, pid));
        }
        if (u.stock_quantity !== undefined) {
          const stock = intParam(u.stock_quantity, { min: 0, max: 1_000_000, field: '재고' });
          if (u.sku_id) {
            const one = await env.DB.prepare('SELECT id FROM product_skus WHERE id = ? AND product_id = ?').bind(String(u.sku_id), pid).first();
            if (!one) throw notFound('옵션을 찾을 수 없습니다.');
            stmts.push(env.DB.prepare("UPDATE product_skus SET stock_quantity = ?, status = CASE WHEN ? > 0 THEN 'IN_STOCK' ELSE 'OUT_OF_STOCK' END, updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(stock, stock, one.id));
          } else {
            stmts.push(env.DB.prepare("UPDATE product_skus SET stock_quantity = ?, status = CASE WHEN ? > 0 THEN 'IN_STOCK' ELSE 'OUT_OF_STOCK' END, updated_at = CURRENT_TIMESTAMP WHERE product_id = ?").bind(stock, stock, pid));
          }
        }
        if (!stmts.length) throw bad('EMPTY_UPDATE', '변경할 항목이 없습니다.');
        await env.DB.batch(stmts);
        updated.push(pid);
      } catch (e) {
        failed.push({ product_id: pid || null, error: e.message || String(e) });
      }
    }
    const data = { updated, failed };
    return json(corsHeaders, { success: failed.length === 0, updated_count: updated.length, failed_count: failed.length, ...data, data });
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
      // T06: with sku_id only that SKU moves (and only its price clock); the
      // product floor is recomputed as the MIN over SKUs. Without sku_id the
      // call is an explicit all-SKU bulk set.
      if (b.sku_id) {
        const sku = await env.DB.prepare(
          `SELECT s.id, s.sale_price, s.original_price FROM product_skus s JOIN products p ON p.id = s.product_id
           WHERE s.id = ? AND s.product_id = ? AND p.partner_id = ?`
        ).bind(b.sku_id, product.id, partnerId).first();
        if (!sku) throw notFound('옵션을 찾을 수 없거나 권한이 없습니다.');
        const scoped = priceFields(b, { sale: sku.sale_price, orig: sku.original_price });
        await env.DB.batch([
          env.DB.prepare('UPDATE product_skus SET sale_price = ?, original_price = ?, updated_at = CURRENT_TIMESTAMP, price_updated_at = CURRENT_TIMESTAMP WHERE id = ?').bind(scoped.sale, scoped.orig, sku.id),
          env.DB.prepare(`UPDATE products SET lowest_sale_price = (SELECT MIN(sale_price) FROM product_skus WHERE product_id = ?),
            lowest_original_price = (SELECT MIN(original_price) FROM product_skus WHERE product_id = ?), updated_at = CURRENT_TIMESTAMP WHERE id = ?`).bind(product.id, product.id, product.id),
          ...priceHistoryStatements(env, [sku.id], { orig: scoped.orig, sale: scoped.sale, by: me.userId })
        ]);
        return json(corsHeaders, { success: true, product_id: product.id, sku_id: sku.id, sale_price: scoped.sale, original_price: scoped.orig, scope: 'SKU' });
      }
      await env.DB.batch([
        env.DB.prepare('UPDATE products SET lowest_sale_price = ?, lowest_original_price = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').bind(sale, orig, product.id),
        env.DB.prepare('UPDATE product_skus SET sale_price = ?, original_price = ?, updated_at = CURRENT_TIMESTAMP, price_updated_at = CURRENT_TIMESTAMP WHERE product_id = ?').bind(sale, orig, product.id),
        ...priceHistoryStatements(env, await skuIdsOfProduct(env, product.id), { orig, sale, by: me.userId })
      ]);
      return json(corsHeaders, { success: true, product_id: product.id, lowest_sale_price: sale, lowest_original_price: orig, scope: 'ALL_SKUS' });
    }
    const title = b.title !== undefined ? str(b.title, { field: '상품명', max: 200, required: true }) : product.title;
    if (b.description_html !== undefined && String(b.description_html).includes('[판매자 작성]')) {
      throw bad('TEMPLATE_TEXT_LEFT', '상세설명의 안내 문구([판매자 작성]…)를 지우고 실제 내용을 입력해 주세요.');
    }
    const custody = b.custody_type !== undefined ? str(b.custody_type, { max: 20 }) : product.custody_type;
    if (!['FULL_MANAGED', 'SEMI_MANAGED'].includes(custody)) throw bad('INVALID_CUSTODY', '운영 모델이 올바르지 않습니다.');
    const supply = b.supply_price !== undefined ? (b.supply_price === null ? null : intParam(b.supply_price, { min: 0, max: 100_000_000, field: '공급가' })) : product.supply_price;
    const brand = b.brand !== undefined ? (str(b.brand, { max: 100 }) || null) : product.brand;
    // NEW-11/12: notice + KC edits re-trigger operator review (legal display must be verified).
    const noticeInputUpd = b.notice_values ?? b.notice_info ?? b.notice_info_json;
    const noticeUpd = noticeInputUpd !== undefined ? parseNoticeInfo(noticeInputUpd) : product.notice_info_json;
    const kcUpd = b.kc_certified !== undefined ? (b.kc_certified === true || b.kc_certified === 1 ? 1 : 0) : product.kc_certified;
    const kcNumUpd = b.kc_cert_number !== undefined ? (str(b.kc_cert_number, { max: 60 }) || null) : product.kc_cert_number;
    if (kcUpd === 1 && !kcNumUpd) throw bad('KC_NUMBER_REQUIRED', 'KC 인증 대상 상품은 인증번호를 입력해야 합니다.');
    // 2-9: gallery replace, template/shipping/bundle updates.
    let galleryUpd = null;
    if (b.images !== undefined) {
      if (!Array.isArray(b.images) || !b.images.length) throw bad('INVALID_IMAGES', 'images는 1개 이상의 이미지 배열이어야 합니다.');
      if (b.images.length > 10) throw bad('TOO_MANY_IMAGES', '상품 이미지는 최대 10장까지 등록할 수 있습니다.');
      galleryUpd = b.images.map((im, i) => ({
        url: storageImage(im.image_url ?? im.url, `이미지 ${i + 1}`),
        alt: str(im.alt_text ?? im.alt ?? '', { field: '대체 텍스트', max: 200 })
      }));
    }
    let tplUpd = product.notice_template_id;
    let tplVerUpd = product.notice_template_version;
    if (b.notice_template_id !== undefined) {
      if (b.notice_template_id === null || String(b.notice_template_id).trim() === '') { tplUpd = null; tplVerUpd = null; }
      else {
        const tplRow = await env.DB.prepare('SELECT * FROM notice_templates WHERE id = ? AND is_active = 1').bind(String(b.notice_template_id)).first();
        if (!tplRow) throw bad('INVALID_NOTICE_TEMPLATE', '사용할 수 없는 고시 템플릿입니다.');
        tplUpd = tplRow.id;
        tplVerUpd = tplRow.version;
      }
    }
    if (tplUpd && (b.notice_template_id !== undefined || noticeInputUpd !== undefined)) {
      let items = [];
      try { items = JSON.parse((await env.DB.prepare('SELECT items_json FROM notice_templates WHERE id = ?').bind(tplUpd).first()).items_json || '[]'); } catch { items = []; }
      const vals = noticeUpd ? JSON.parse(noticeUpd) : {};
      const missing = items.filter((it) => it.required).map((it) => it.key).filter((k) => !k || !String(vals[k] ?? '').trim());
      if (missing.length) throw bad('NOTICE_REQUIRED_MISSING', `고시 필수 항목이 비어 있습니다: ${missing.join(', ')}`);
    }
    let shipUpd = product.shipping_policy_id;
    if (b.shipping_policy_id !== undefined) {
      if (b.shipping_policy_id === null || String(b.shipping_policy_id).trim() === '') shipUpd = null;
      else {
        const spt = await env.DB.prepare("SELECT id FROM shipping_policies WHERE id = ? AND partner_id = ? AND status = 'ACTIVE'").bind(String(b.shipping_policy_id), partnerId).first();
        if (!spt) throw bad('INVALID_SHIPPING_POLICY', '사용할 수 없는 배송 템플릿입니다.');
        shipUpd = spt.id;
      }
    }
    const bundleUpd = b.bundle_group_key !== undefined
      ? (b.bundle_group_key === null || String(b.bundle_group_key).trim() === '' ? null : str(b.bundle_group_key, { field: '묶음 키', max: 64 }))
      : product.bundle_group_key;
    const descChanged = b.description_html !== undefined && b.description_html !== product.description_html;
    const legalChanged = noticeUpd !== product.notice_info_json || kcUpd !== product.kc_certified || kcNumUpd !== product.kc_cert_number;
    const contentChanged = descChanged || title !== product.title || (b.thumbnail_url && b.thumbnail_url !== product.thumbnail_url) || legalChanged || galleryUpd !== null || tplUpd !== product.notice_template_id;
    const catId = b.category_id || b.category_slug ? await resolveCategory(env, b) : product.category_id;
    // T06: sku_id scopes the price part to one SKU (floor recomputed as MIN after).
    let scopedSku = null;
    if (b.sku_id) {
      scopedSku = await env.DB.prepare(
        `SELECT s.id FROM product_skus s JOIN products p ON p.id = s.product_id
         WHERE s.id = ? AND s.product_id = ? AND p.partner_id = ?`
      ).bind(b.sku_id, product.id, partnerId).first();
      if (!scopedSku) throw notFound('옵션을 찾을 수 없거나 권한이 없습니다.');
    }
    // 2-9: explicit sku upserts replace the legacy whole-product price set.
    const hasTopPrice = ['sale_price', 'price', 'lowest_sale_price', 'original_price', 'lowest_original_price'].some((k) => b[k] !== undefined);
    let skuStmts;
    if (b.skus !== undefined) {
      if (!Array.isArray(b.skus)) throw bad('INVALID_SKUS', 'skus는 배열이어야 합니다.');
      if (hasTopPrice || b.sku_id) throw bad('MIXED_PRICE_INPUT', 'skus와 함께 낱개 가격은 지정할 수 없습니다.');
      const current = (await env.DB.prepare('SELECT * FROM product_skus WHERE product_id = ?').bind(product.id).all()).results;
      const byId = new Map(current.map((s) => [s.id, s]));
      const combos = new Set(current.map((s) => s.option_combination_json));
      if (current.length + b.skus.filter((s) => !s.id).length > 200) throw bad('TOO_MANY_SKUS', 'SKU는 최대 200개까지 등록할 수 있습니다.');
      skuStmts = [];
      const histIds = [];
      const histVals = {};
      for (const entry of b.skus) {
        if (entry.id) {
          const old = byId.get(String(entry.id));
          if (!old) throw notFound('옵션을 찾을 수 없거나 권한이 없습니다.');
          if (entry.option_combination !== undefined || entry.option_combination_json !== undefined) {
            const want = typeof (entry.option_combination ?? entry.option_combination_json) === 'string'
              ? (entry.option_combination ?? entry.option_combination_json) : JSON.stringify(entry.option_combination ?? entry.option_combination_json);
            let same = false;
            try { same = JSON.stringify(JSON.parse(want), Object.keys(JSON.parse(want)).sort()) === JSON.stringify(JSON.parse(old.option_combination_json), Object.keys(JSON.parse(old.option_combination_json)).sort()); } catch { same = false; }
            if (!same) throw bad('COMBO_IMMUTABLE', '등록된 SKU의 옵션 조합은 변경할 수 없습니다. 새 SKU로 등록해 주세요.');
          }
          const pr = priceFields(entry, { sale: old.sale_price, orig: old.original_price });
          const stock = entry.stock_quantity !== undefined ? intParam(entry.stock_quantity, { min: 0, max: 1_000_000, field: '재고' }) : old.stock_quantity;
          const safety = entry.safety_stock !== undefined ? intParam(entry.safety_stock, { min: 0, max: 1_000_000, field: '안전재고' }) : old.safety_stock;
          skuStmts.push(env.DB.prepare(
            `UPDATE product_skus SET sku_code = ?, sale_price = ?, original_price = ?, stock_quantity = ?,
               safety_stock = ?, status = CASE WHEN ? > 0 THEN 'IN_STOCK' ELSE 'OUT_OF_STOCK' END,
               updated_at = CURRENT_TIMESTAMP, price_updated_at = CASE WHEN sale_price != ? OR original_price != ? THEN CURRENT_TIMESTAMP ELSE price_updated_at END
             WHERE id = ?`
          ).bind(entry.sku_code !== undefined ? str(entry.sku_code, { max: 60, required: true }) : old.sku_code,
            pr.sale, pr.orig, stock, safety, stock, pr.sale, pr.orig, old.id));
          if (pr.sale !== old.sale_price || pr.orig !== old.original_price) { histIds.push(old.id); histVals[old.id] = { orig: pr.orig, sale: pr.sale }; }
        } else {
          const obj = entry.option_combination ?? entry.option_combination_json ?? null;
          if (!obj || typeof obj !== 'object' || Array.isArray(obj)) throw bad('INVALID_OPTIONS', '옵션 조합 형식이 올바르지 않습니다.');
          const keys = Object.keys(obj);
          if (!keys.length || keys.length > 3) throw bad('INVALID_OPTIONS', '옵션 조합은 1~3종이어야 합니다.');
          const clean = {};
          for (const k of keys.sort()) clean[k] = str(obj[k], { field: '옵션값', max: 100, required: true });
          const comboJson = JSON.stringify(clean);
          if (combos.has(comboJson)) throw bad('DUPLICATE_COMBINATION', '중복된 옵션 조합이 있습니다.');
          combos.add(comboJson);
          const pr = priceFields(entry);
          const nid = newId('sku');
          const ncode = str(entry.sku_code, { max: 60 }) || `SKU-${nid.slice(-10).toUpperCase()}`;
          const nstock = intParam(entry.stock_quantity ?? 0, { min: 0, max: 1_000_000, field: '재고' });
          skuStmts.push(env.DB.prepare(
            `INSERT INTO product_skus (id, product_id, sku_code, option_combination_json, original_price, sale_price, stock_quantity, safety_stock, status)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
          ).bind(nid, product.id, ncode, comboJson, pr.orig, pr.sale, nstock,
            intParam(entry.safety_stock ?? 5, { min: 0, max: 1_000_000, field: '안전재고' }), nstock > 0 ? 'IN_STOCK' : 'OUT_OF_STOCK'));
          if (nstock > 0) skuStmts.push(env.DB.prepare(`INSERT INTO inventory_ledger (id, sku_id, change_type, quantity_delta, balance_after, reference_id, idempotency_key) VALUES (?, ?, 'RESTOCK', ?, ?, ?, ?)`)
            .bind(newId('ldg'), nid, nstock, nstock, partnerId, `init:${nid}`));
        }
      }
      for (const hid of histIds) skuStmts.push(...priceHistoryStatements(env, [hid], { ...histVals[hid], by: me.userId }));
      skuStmts.push(env.DB.prepare(`UPDATE products SET lowest_sale_price = (SELECT MIN(sale_price) FROM product_skus WHERE product_id = ?),
        lowest_original_price = (SELECT MIN(original_price) FROM product_skus WHERE product_id = ?), updated_at = CURRENT_TIMESTAMP WHERE id = ?`).bind(product.id, product.id, product.id));
    } else {
      skuStmts = scopedSku ? [
        env.DB.prepare('UPDATE product_skus SET sale_price = ?, original_price = ?, updated_at = CURRENT_TIMESTAMP, price_updated_at = CURRENT_TIMESTAMP WHERE id = ?').bind(sale, orig, scopedSku.id),
        env.DB.prepare(`UPDATE products SET lowest_sale_price = (SELECT MIN(sale_price) FROM product_skus WHERE product_id = ?),
        lowest_original_price = (SELECT MIN(original_price) FROM product_skus WHERE product_id = ?), updated_at = CURRENT_TIMESTAMP WHERE id = ?`).bind(product.id, product.id, product.id),
        ...priceHistoryStatements(env, [scopedSku.id], { orig, sale, by: me.userId })
      ] : [
        env.DB.prepare('UPDATE product_skus SET sale_price = ?, original_price = ?, updated_at = CURRENT_TIMESTAMP, price_updated_at = CURRENT_TIMESTAMP WHERE product_id = ?').bind(sale, orig, product.id),
        ...priceHistoryStatements(env, await skuIdsOfProduct(env, product.id), { orig, sale, by: me.userId })
      ];
    }
    const imgStmts = galleryUpd ? [
      env.DB.prepare('DELETE FROM product_images WHERE product_id = ?').bind(product.id),
      ...galleryUpd.map((im, i) => env.DB.prepare('INSERT INTO product_images (id, product_id, image_url, alt_text, sort_order) VALUES (?, ?, ?, ?, ?)')
        .bind(newId('pimg'), product.id, im.url, im.alt, i))
    ] : [];
    const thumbUpd = galleryUpd ? galleryUpd[0].url : (b.thumbnail_url || product.thumbnail_url);
    try {
      await env.DB.batch([
        env.DB.prepare(
          `UPDATE products SET title = ?, description_html = ?, thumbnail_url = ?, category_id = ?, lowest_original_price = ?, lowest_sale_price = ?,
           hs_code = ?, country_origin = ?, custody_type = ?, supply_price = ?, brand = ?,
           notice_info_json = ?, notice_template_id = ?, notice_template_version = ?, shipping_policy_id = ?, bundle_group_key = ?,
           kc_certified = ?, kc_cert_number = ?,
           review_status = CASE WHEN ? = 1 AND review_status = 'APPROVED' THEN 'PENDING' ELSE review_status END,
           status = CASE WHEN ? = 1 AND status = 'ACTIVE' THEN 'DRAFT' ELSE status END, updated_at = CURRENT_TIMESTAMP
         WHERE id = ? AND partner_id = ?`
        ).bind(title, b.description_html !== undefined ? sanitizeHtml(str(b.description_html, { max: 200000 })) : product.description_html,
          thumbUpd, catId, b.skus !== undefined ? product.lowest_original_price : orig, b.skus !== undefined ? product.lowest_sale_price : sale,
          b.hs_code ?? product.hs_code, (b.country_origin || product.country_origin || 'KR').toUpperCase(),
          custody, supply, brand, noticeUpd, tplUpd, tplVerUpd, shipUpd, bundleUpd, kcUpd, kcNumUpd, contentChanged ? 1 : 0, contentChanged ? 1 : 0, product.id, partnerId),
        ...skuStmts,
        ...imgStmts
      ]);
    } catch (e) {
      if (String(e.message).includes('UNIQUE')) throw conflict('SKU_CODE_TAKEN', '이미 사용 중인 SKU 코드입니다.');
      throw e;
    }
    return json(corsHeaders, {
      success: true, message: contentChanged ? '상세 내용이 변경되어 재심사 후 노출됩니다.' : '상품 정보가 수정되었습니다.',
      data: { product_id: product.id, title, sale_price: b.skus !== undefined ? product.lowest_sale_price : sale, original_price: b.skus !== undefined ? product.lowest_original_price : orig, review_status: contentChanged ? 'PENDING' : product.review_status }
    });
  }

  if (p === '/api/v1/partner/orders' && request.method === 'GET') {
    // 2-9: status, date basis, period, keyword, carrier, page, CSV.
    // Contacts are masked; the full text needs GET .../:id/contact with a reason.
    const SUB_STATUSES = ['PAYMENT_PENDING', 'PAYMENT_CONFIRMED', 'PREPARING', 'SHIPPED', 'IN_TRANSIT', 'DELIVERED',
      'PURCHASE_CONFIRMED', 'COMPLETED', 'CANCEL_REQUESTED', 'CANCELLED', 'RETURN_REQUESTED', 'RETURNED', 'EXPIRED'];
    const statusRaw = url.searchParams.get('status');
    const status = statusRaw ? String(statusRaw).toUpperCase() : null;
    if (status && !SUB_STATUSES.includes(status)) throw bad('INVALID_STATUS', 'status 값이 올바르지 않습니다.');
    const dateFieldRaw = String(url.searchParams.get('date_field') || 'paid').toLowerCase();
    const dateCol = { paid: 'o.paid_at', confirmed: 's.confirmed_at', shipped: 's.shipped_at' }[dateFieldRaw];
    if (!dateCol) throw bad('INVALID_DATE_FIELD', 'date_field은 paid·confirmed·shipped 중 하나여야 합니다.');
    const dayRe = /^\d{4}-\d{2}-\d{2}$/;
    const from = url.searchParams.get('from') || null;
    const to = url.searchParams.get('to') || null;
    if ((from && !dayRe.test(from)) || (to && !dayRe.test(to))) throw bad('INVALID_PERIOD', 'from·to는 YYYY-MM-DD 형식이어야 합니다.');
    const q = str(url.searchParams.get('q') || '', { max: 100 });
    const carrier = str(url.searchParams.get('carrier') || '', { max: 40 });
    const where = ['s.partner_id = ?'];
    const args = [partnerId];
    if (status) { where.push('s.status = ?'); args.push(status); }
    else where.push("s.status NOT IN ('PAYMENT_PENDING','EXPIRED')");
    if (from) { where.push(`date(${dateCol}) >= date(?)`); args.push(from); }
    if (to) { where.push(`date(${dateCol}) <= date(?)`); args.push(to); }
    if (carrier) { where.push('s.carrier_code = ?'); args.push(carrier); }
    if (q) {
      const like = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
      where.push(`(o.id LIKE ? ESCAPE '\\' OR o.order_no LIKE ? ESCAPE '\\' OR s.id LIKE ? ESCAPE '\\' OR s.sub_order_no LIKE ? ESCAPE '\\'
        OR o.recipient_name LIKE ? ESCAPE '\\' OR o.recipient_phone LIKE ? ESCAPE '\\'
        OR EXISTS (SELECT 1 FROM order_items i WHERE i.sub_order_id = s.id AND (i.product_title LIKE ? ESCAPE '\\' OR i.sku_id LIKE ? ESCAPE '\\')))`);
      args.push(like, like, like, like, like, like, like, like);
    }
    const whereSql = where.join(' AND ');
    const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10) || 1);
    const perPage = Math.min(200, Math.max(1, parseInt(url.searchParams.get('per_page') || url.searchParams.get('limit') || '30', 10) || 30));
    const total = await env.DB.prepare(`SELECT COUNT(*) AS c FROM sub_orders s JOIN orders o ON s.parent_order_id = o.id WHERE ${whereSql}`).bind(...args).first('c') || 0;
    const asCsv = String(url.searchParams.get('format') || '').toLowerCase() === 'csv';
    const { results: subs } = await env.DB.prepare(
      `SELECT s.*, o.order_no, o.payment_status, o.recipient_name, o.recipient_phone, o.shipping_address_line1, o.shipping_address_line2, o.shipping_postal_code, o.shipping_memo,
              o.pccc, o.customs_duty_type, o.created_at AS order_date
       FROM sub_orders s JOIN orders o ON s.parent_order_id = o.id
       WHERE ${whereSql} ORDER BY s.created_at DESC ${asCsv ? 'LIMIT 5000' : 'LIMIT ? OFFSET ?'}`
    ).bind(...args, ...(asCsv ? [] : [perPage, (page - 1) * perPage])).all();
    for (const s of subs) {
      s.items = (await env.DB.prepare('SELECT i.*, p.thumbnail_url FROM order_items i LEFT JOIN products p ON p.id = i.product_id WHERE i.sub_order_id = ?').bind(s.id).all()).results;
      // SEC-10: the fulfilling seller is authorized for the full PCCC (customs declaration); open the sealed value.
      s.pccc = await maybeOpenPii(env, s.pccc);
      s.recipient_name = maskName(s.recipient_name);
      s.recipient_phone = maskPhone(s.recipient_phone);
      s.shipping_address_line1 = maskAddress(s.shipping_address_line1);
      s.shipping_address_line2 = maskAddress(s.shipping_address_line2);
      s.shipping_memo = s.shipping_memo ? '***' : s.shipping_memo;
    }
    // Recipient data provided to the seller for fulfilment (개인정보 제3자 제공/처리위탁) is access-logged.
    await logPiiView(env, me, 'partner.orders', 'order', subs.map((s) => s.parent_order_id), 'recipient_name,recipient_phone,shipping_address,shipping_memo,pccc', request);
    if (asCsv) {
      return csvResponse(corsHeaders, 'partner_orders.csv',
        ['order_no', 'sub_order_no', 'status', 'recipient_name', 'recipient_phone', 'postal_code', 'address', 'goods_amount', 'shipping_fee', 'total_amount', 'carrier_code', 'tracking_number', 'paid_at'],
        subs.map((s) => [s.order_no, s.sub_order_no, s.status, s.recipient_name, s.recipient_phone, s.shipping_postal_code,
          s.shipping_address_line1, s.goods_amount, s.shipping_fee, s.total_amount, s.carrier_code, s.tracking_number, s.order_date]));
    }
    return json(corsHeaders, { success: true, partner_id: partnerId, count: subs.length,
      pagination: { page, per_page: perPage, total: Number(total) || 0, total_pages: Math.max(1, Math.ceil((Number(total) || 0) / perPage)) }, data: subs });
  }

  // 2-9: full recipient text for fulfilment — reason required, access-logged.
  const contactM = p.match(/^\/api\/v1\/partner\/orders\/([^/]+)\/contact$/);
  if (contactM && request.method === 'GET') {
    const reason = str(url.searchParams.get('reason') || '', { max: 200 });
    if (!reason) throw bad('REASON_REQUIRED', '원문 보기 사유를 입력해 주세요.');
    const s = await env.DB.prepare(
      `SELECT s.id, s.parent_order_id, o.order_no, o.recipient_name, o.recipient_phone, o.shipping_address_line1,
              o.shipping_address_line2, o.shipping_postal_code, o.shipping_memo, o.pccc
       FROM sub_orders s JOIN orders o ON s.parent_order_id = o.id WHERE s.id = ? AND s.partner_id = ?`
    ).bind(contactM[1], partnerId).first();
    if (!s) throw notFound('주문을 찾을 수 없습니다.');
    await logPiiView(env, me, 'partner.orders.contact', 'order', [s.parent_order_id],
      `recipient_name,recipient_phone,shipping_address,shipping_memo,pccc,reason:${reason.slice(0, 100)}`, request);
    const data = { ...s, pccc: await maybeOpenPii(env, s.pccc) };
    return json(corsHeaders, { success: true, ...data, data });
  }

  // 2-9: bulk order confirmation (own PAYMENT_CONFIRMED rows only; the rest fail apart).
  if (p === '/api/v1/partner/orders/confirm' && (request.method === 'PUT' || request.method === 'POST')) {
    const b = await readJson(request);
    if (!Array.isArray(b.sub_order_ids) || !b.sub_order_ids.length) throw bad('SUB_ORDER_IDS_REQUIRED', 'sub_order_ids 배열을 1개 이상 보내 주세요.');
    if (b.sub_order_ids.length > 200) throw bad('CONFIRM_TOO_LARGE', '한 번에 최대 200건까지 확인할 수 있습니다.');
    const tpl = await env.DB.prepare(
      "SELECT processing_days FROM shipping_policies WHERE partner_id = ? AND status = 'ACTIVE' AND is_default = 1"
    ).bind(partnerId).first();
    const updated = [];
    const failed = [];
    for (const rawId of [...new Set(b.sub_order_ids.map((x) => String(x || '').trim()).filter(Boolean))]) {
      const s = await env.DB.prepare('SELECT id, partner_id, status, ship_by_deadline FROM sub_orders WHERE id = ?').bind(rawId).first();
      if (!s || s.partner_id !== partnerId) { failed.push({ sub_order_id: rawId, error: '본인 주문이 아닙니다.' }); continue; }
      const r = await env.DB.prepare(
        "UPDATE sub_orders SET status = 'PREPARING', confirmed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'PAYMENT_CONFIRMED'"
      ).bind(rawId).run();
      if (r.meta.changes !== 1) { failed.push({ sub_order_id: rawId, error: '결제 완료 상태의 주문만 확인할 수 있습니다.' }); continue; }
      if (!s.ship_by_deadline && tpl) {
        const due = new Date(Date.now() + Number(tpl.processing_days || 0) * 86400000).toISOString().slice(0, 10);
        await env.DB.prepare('UPDATE sub_orders SET ship_by_deadline = ? WHERE id = ?').bind(due, rawId).run();
      }
      updated.push(rawId);
    }
    const data = { updated, failed };
    return json(corsHeaders, { success: failed.length === 0, updated_count: updated.length, failed_count: failed.length, ...data, data });
  }

  // 2-9: shipment delay notice — extends the deadline, notifies the buyer.
  const delayM = p.match(/^\/api\/v1\/partner\/orders\/([^/]+)\/delay-notice$/);
  if (delayM && (request.method === 'PUT' || request.method === 'POST')) {
    const b = await readJson(request);
    const reason = str(b.reason || b.reason_code, { field: '사유', max: 500, required: true });
    const dueRaw = str(b.new_ship_by || b.new_due_date, { field: '새 출고기한', max: 10, required: true });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dueRaw)) throw bad('INVALID_DATE', '새 출고기한은 YYYY-MM-DD 형식이어야 합니다.');
    const s = await env.DB.prepare(
      'SELECT s.id, s.parent_order_id, s.status, s.ship_by_deadline, s.sub_order_no, o.customer_id, o.order_no FROM sub_orders s JOIN orders o ON s.parent_order_id = o.id WHERE s.id = ? AND s.partner_id = ?'
    ).bind(delayM[1], partnerId).first();
    if (!s) throw notFound('주문을 찾을 수 없습니다.');
    if (!['PAYMENT_CONFIRMED', 'PREPARING'].includes(s.status)) throw conflict('NOT_DELAYABLE', '출고 전 주문에만 발송 지연을 안내할 수 있습니다.');
    const baseline = s.ship_by_deadline || new Date().toISOString().slice(0, 10);
    const topDate = new Date(Date.parse(`${baseline}T00:00:00Z`) + 14 * 86400000).toISOString().slice(0, 10);
    if (!(dueRaw > baseline)) throw bad('DATE_NOT_LATER', '새 출고기한은 기존 기한보다 늦어야 합니다.');
    if (dueRaw > topDate) throw bad('DATE_TOO_FAR', '새 출고기한은 기존 기한으로부터 14일 이내여야 합니다.');
    await env.DB.prepare('UPDATE sub_orders SET ship_by_deadline = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').bind(dueRaw, s.id).run();
    const msg = `주문 ${s.order_no}(${s.sub_order_no})의 출고가 ${dueRaw}로 연기되었습니다. 사유: ${reason}`;
    await env.DB.prepare('INSERT INTO notifications (id, user_id, title, message, type, action_url) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(newId('ntf'), s.customer_id, '발송 지연 안내', msg, 'ORDER_STATUS', `/orders/${s.parent_order_id || ''}`).run();
    try {
      await notifyUser(env, { userId: s.customer_id, title: '발송 지연 안내', body: msg, templateCode: 'DELAY_NOTICE' });
    } catch { /* push logging must never fail the notice */ }
    const data = { sub_order_id: s.id, ship_by_deadline: dueRaw };
    return json(corsHeaders, { success: true, ...data, data });
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
    const ok = r[0].meta.changes === 1;
    // H-2: a push failure must never fail the shipment itself.
    if (ok) {
      try {
        const ord = await env.DB.prepare(
          'SELECT o.customer_id, o.order_no FROM orders o JOIN sub_orders s ON s.parent_order_id = o.id WHERE s.id = ?'
        ).bind(subOrderId).first();
        if (ord) await pushOrderShipped(env, { orderNo: ord.order_no, customerId: ord.customer_id, trackingNumber: tracking });
      } catch { /* logged as FAILED inside notifyUser; shipment already committed */ }
    }
    return ok;
  }

  if (p === '/api/v1/partner/orders/bulk-shipment' && (request.method === 'PUT' || request.method === 'POST')) {
    const b = await readJson(request);
    const list = Array.isArray(b.shipments) ? b.shipments.slice(0, 500) : [];
    if (!list.length) throw bad('EMPTY', '송장 목록이 비어 있습니다.');
    const results = [];
    for (const s of list) {
      try {
        const itemCarrier = str(s.carrier || s.carrier_code, { max: 40 });
        if (!itemCarrier) throw bad('CARRIER_REQUIRED', '택배사를 선택해 주세요.');
        const ok = await ship(String(s.sub_order_id || ''), itemCarrier, String(s.tracking_number || '').trim());
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
    // T02: no invented carrier — the seller must pick the real one.
    const carrier = str(b.carrier || b.carrier_code, { field: '택배사', max: 40, required: true });
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

  // 2-9: seller shipping templates. Deleting a template products use is refused.
  if (p === '/api/v1/partner/shipping-policies' && request.method === 'GET') {
    const { results } = await env.DB.prepare('SELECT * FROM shipping_policies WHERE partner_id = ? ORDER BY is_default DESC, created_at ASC').bind(partnerId).all();
    return json(corsHeaders, { success: true, count: results.length, data: results });
  }
  if (p === '/api/v1/partner/shipping-policies' && request.method === 'POST') {
    const b = await readJson(request);
    const name = str(b.name, { field: '템플릿명', max: 100, required: true });
    const method = str(b.method, { field: '배송방식', max: 20, required: true }).toUpperCase();
    if (!['PARCEL', 'DIRECT', 'OVERSEAS'].includes(method)) throw bad('INVALID_METHOD', 'method는 PARCEL·DIRECT·OVERSEAS 중 하나여야 합니다.');
    const feeType = str(b.fee_type, { field: '요금방식', max: 20, required: true }).toUpperCase();
    if (!['FREE', 'PAID', 'CONDITIONAL', 'PER_QTY'].includes(feeType)) throw bad('INVALID_FEE_TYPE', 'fee_type은 FREE·PAID·CONDITIONAL·PER_QTY 중 하나여야 합니다.');
    const tplId = newId('sp');
    const stmts = [env.DB.prepare(
      `INSERT INTO shipping_policies (id, partner_id, name, method, carrier_code, fee_type, base_fee, free_threshold, qty_unit,
        remote_surcharge, return_fee, exchange_fee, processing_days, today_cutoff, origin_address, return_address, is_default, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE')`
    ).bind(tplId, partnerId, name, method, str(b.carrier_code, { max: 40 }) || null, feeType,
      intParam(b.base_fee ?? 0, { min: 0, max: 1_000_000, field: '기본 배송비' }),
      b.free_threshold === undefined || b.free_threshold === null ? null : intParam(b.free_threshold, { min: 0, max: 100_000_000, field: '무료 기준' }),
      b.qty_unit === undefined || b.qty_unit === null ? null : intParam(b.qty_unit, { min: 1, max: 100000, field: '수량 단위' }),
      b.remote_surcharge === undefined || b.remote_surcharge === null ? null : intParam(b.remote_surcharge, { min: 0, max: 1_000_000, field: '도서산간 추가비' }),
      intParam(b.return_fee ?? 0, { min: 0, max: 1_000_000, field: '반품비' }),
      intParam(b.exchange_fee ?? 0, { min: 0, max: 1_000_000, field: '교환비' }),
      intParam(b.processing_days ?? 0, { min: 0, max: 14, field: '출고 소요일' }),
      str(b.today_cutoff, { max: 5 }) || null, str(b.origin_address, { max: 300 }) || null, str(b.return_address, { max: 300 }) || null,
      b.is_default ? 1 : 0)];
    if (b.is_default) stmts.unshift(env.DB.prepare('UPDATE shipping_policies SET is_default = 0 WHERE partner_id = ?').bind(partnerId));
    await env.DB.batch(stmts);
    const created = await env.DB.prepare('SELECT * FROM shipping_policies WHERE id = ?').bind(tplId).first();
    return json(corsHeaders, { success: true, ...created, data: created }, 201);
  }
  const shipPolM = p.match(/^\/api\/v1\/partner\/shipping-policies\/([^/]+)$/);
  if (shipPolM && (request.method === 'PUT' || request.method === 'PATCH')) {
    const b = await readJson(request);
    const tpl = await env.DB.prepare('SELECT * FROM shipping_policies WHERE id = ? AND partner_id = ?').bind(shipPolM[1], partnerId).first();
    if (!tpl) throw notFound('배송 템플릿을 찾을 수 없습니다.');
    if (b.method !== undefined && !['PARCEL', 'DIRECT', 'OVERSEAS'].includes(String(b.method).toUpperCase())) throw bad('INVALID_METHOD', 'method는 PARCEL·DIRECT·OVERSEAS 중 하나여야 합니다.');
    if (b.fee_type !== undefined && !['FREE', 'PAID', 'CONDITIONAL', 'PER_QTY'].includes(String(b.fee_type).toUpperCase())) throw bad('INVALID_FEE_TYPE', 'fee_type은 FREE·PAID·CONDITIONAL·PER_QTY 중 하나여야 합니다.');
    const stmts = [env.DB.prepare(
      `UPDATE shipping_policies SET name = ?, method = ?, carrier_code = ?, fee_type = ?, base_fee = ?, free_threshold = ?, qty_unit = ?,
        remote_surcharge = ?, return_fee = ?, exchange_fee = ?, processing_days = ?, today_cutoff = ?, origin_address = ?, return_address = ?,
        is_default = ?, status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`
    ).bind(b.name !== undefined ? str(b.name, { field: '템플릿명', max: 100, required: true }) : tpl.name,
      b.method !== undefined ? String(b.method).toUpperCase() : tpl.method,
      b.carrier_code !== undefined ? (str(b.carrier_code, { max: 40 }) || null) : tpl.carrier_code,
      b.fee_type !== undefined ? String(b.fee_type).toUpperCase() : tpl.fee_type,
      b.base_fee !== undefined ? intParam(b.base_fee, { min: 0, max: 1_000_000, field: '기본 배송비' }) : tpl.base_fee,
      b.free_threshold !== undefined ? (b.free_threshold === null ? null : intParam(b.free_threshold, { min: 0, max: 100_000_000, field: '무료 기준' })) : tpl.free_threshold,
      b.qty_unit !== undefined ? (b.qty_unit === null ? null : intParam(b.qty_unit, { min: 1, max: 100000, field: '수량 단위' })) : tpl.qty_unit,
      b.remote_surcharge !== undefined ? (b.remote_surcharge === null ? null : intParam(b.remote_surcharge, { min: 0, max: 1_000_000, field: '도서산간 추가비' })) : tpl.remote_surcharge,
      b.return_fee !== undefined ? intParam(b.return_fee, { min: 0, max: 1_000_000, field: '반품비' }) : tpl.return_fee,
      b.exchange_fee !== undefined ? intParam(b.exchange_fee, { min: 0, max: 1_000_000, field: '교환비' }) : tpl.exchange_fee,
      b.processing_days !== undefined ? intParam(b.processing_days, { min: 0, max: 14, field: '출고 소요일' }) : tpl.processing_days,
      b.today_cutoff !== undefined ? (str(b.today_cutoff, { max: 5 }) || null) : tpl.today_cutoff,
      b.origin_address !== undefined ? (str(b.origin_address, { max: 300 }) || null) : tpl.origin_address,
      b.return_address !== undefined ? (str(b.return_address, { max: 300 }) || null) : tpl.return_address,
      b.is_default !== undefined ? (b.is_default ? 1 : 0) : tpl.is_default,
      b.status !== undefined ? (['ACTIVE', 'INACTIVE'].includes(String(b.status).toUpperCase()) ? String(b.status).toUpperCase() : (() => { throw bad('INVALID_STATUS', 'status는 ACTIVE·INACTIVE 중 하나여야 합니다.'); })()) : tpl.status,
      tpl.id)];
    if (b.is_default) stmts.unshift(env.DB.prepare('UPDATE shipping_policies SET is_default = 0 WHERE partner_id = ?').bind(partnerId));
    await env.DB.batch(stmts);
    const updatedTpl = await env.DB.prepare('SELECT * FROM shipping_policies WHERE id = ?').bind(tpl.id).first();
    return json(corsHeaders, { success: true, ...updatedTpl, data: updatedTpl });
  }
  if (shipPolM && request.method === 'DELETE') {
    const tpl = await env.DB.prepare('SELECT id FROM shipping_policies WHERE id = ? AND partner_id = ?').bind(shipPolM[1], partnerId).first();
    if (!tpl) throw notFound('배송 템플릿을 찾을 수 없습니다.');
    const used = await env.DB.prepare('SELECT COUNT(*) AS c FROM products WHERE shipping_policy_id = ?').bind(tpl.id).first('c');
    if (used > 0) throw conflict('TEMPLATE_IN_USE', '사용 중인 배송 템플릿은 삭제할 수 없습니다.');
    await env.DB.prepare('DELETE FROM shipping_policies WHERE id = ?').bind(tpl.id).run();
    return json(corsHeaders, { success: true, deleted: true });
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
    const { results: payouts } = await env.DB.prepare('SELECT id, amount, gross_amount, reserve_held, reserve_released, status, bank_transfer_ref, created_at FROM payouts WHERE partner_id = ? ORDER BY created_at DESC LIMIT 50').bind(partnerId).all();
    // Rolling reserve (O18): money withheld from payouts that is still owed to the seller.
    const reserve = await env.DB.prepare(
      'SELECT COALESCE(SUM(amount),0) AS outstanding, MIN(release_after) AS next_release FROM payout_reserve_holds WHERE partner_id = ? AND released_payout_id IS NULL'
    ).bind(partnerId).first();
    summary.reserve_outstanding = reserve ? reserve.outstanding : 0;
    summary.next_reserve_release = reserve ? reserve.next_release : null;
    summary.rolling_reserve_pct = Number(partner.rolling_reserve_pct || 0);
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
    // 2-9: type/status/period/page. (Cancellations live on the orders list by status.)
    const typeRaw = url.searchParams.get('claim_type');
    const ctype = typeRaw ? String(typeRaw).toUpperCase() : null;
    if (ctype && !['RETURN', 'EXCHANGE', 'PRICE_ADJUSTMENT'].includes(ctype)) throw bad('INVALID_CLAIM_TYPE', 'claim_type이 올바르지 않습니다.');
    const stRaw = url.searchParams.get('status');
    const rst = stRaw ? String(stRaw).toUpperCase() : null;
    if (rst && !['REQUESTED', 'APPROVED', 'REJECTED', 'REFUNDED'].includes(rst)) throw bad('INVALID_STATUS', 'status 값이 올바르지 않습니다.');
    const dayRe = /^\d{4}-\d{2}-\d{2}$/;
    const from = url.searchParams.get('from') || null;
    const to = url.searchParams.get('to') || null;
    if ((from && !dayRe.test(from)) || (to && !dayRe.test(to))) throw bad('INVALID_PERIOD', 'from·to는 YYYY-MM-DD 형식이어야 합니다.');
    const where = ['so.partner_id = ?'];
    const args = [partnerId];
    if (ctype) { where.push('r.claim_type = ?'); args.push(ctype); }
    if (rst) { where.push('r.status = ?'); args.push(rst); }
    if (from) { where.push('date(r.created_at) >= date(?)'); args.push(from); }
    if (to) { where.push('date(r.created_at) <= date(?)'); args.push(to); }
    const whereSql = where.join(' AND ');
    const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10) || 1);
    const perPage = Math.min(200, Math.max(1, parseInt(url.searchParams.get('per_page') || url.searchParams.get('limit') || '30', 10) || 30));
    const total = await env.DB.prepare(`SELECT COUNT(*) AS c FROM returns r JOIN sub_orders so ON so.id = r.sub_order_id WHERE ${whereSql}`).bind(...args).first('c') || 0;
    const { results } = await env.DB.prepare(
      `SELECT r.*, o.order_no, so.sub_order_no, so.goods_amount, so.shipping_fee, so.total_amount, u.email AS customer_email, u.full_name AS customer_name
       FROM returns r JOIN sub_orders so ON so.id = r.sub_order_id JOIN orders o ON o.id = r.order_id LEFT JOIN users u ON u.id = r.user_id
       WHERE ${whereSql} ORDER BY r.created_at DESC LIMIT ? OFFSET ?`
    ).bind(...args, perPage, (page - 1) * perPage).all();
    return json(corsHeaders, { success: true, partner_id: partnerId, count: results.length,
      pagination: { page, per_page: perPage, total: Number(total) || 0, total_pages: Math.max(1, Math.ceil((Number(total) || 0) / perPage)) }, data: results });
  }

  // 2-9: return collection (tracking input). REQUESTED only, recorded once.
  const pickupM = p.match(/^\/api\/v1\/partner\/returns\/([^/]+)\/pickup$/);
  if (pickupM && (request.method === 'PUT' || request.method === 'POST')) {
    const b = await readJson(request);
    const carrier = str(b.carrier || b.carrier_code, { field: '택배사', max: 40, required: true });
    const tracking = String(b.tracking_number || '').trim();
    if (!tracking || !/^[A-Za-z0-9-]{6,40}$/.test(tracking)) throw bad('INVALID_TRACKING', '송장번호 형식이 올바르지 않습니다.');
    const claim = await env.DB.prepare('SELECT r.* FROM returns r JOIN sub_orders so ON so.id = r.sub_order_id WHERE r.id = ? AND so.partner_id = ?').bind(pickupM[1], partnerId).first();
    if (!claim) throw notFound('클레임을 찾을 수 없습니다.');
    if (claim.status !== 'REQUESTED') throw conflict('CLAIM_NOT_OPEN', '요청 상태의 클레임에만 수거를 등록할 수 있습니다.');
    if (claim.collection_requested_at) throw conflict('PICKUP_RECORDED', '이미 수거가 등록된 클레임입니다.');
    await env.DB.prepare(
      'UPDATE returns SET collection_requested_at = CURRENT_TIMESTAMP, collection_carrier = ?, collection_tracking_number = ? WHERE id = ?'
    ).bind(carrier, tracking, claim.id).run();
    const data = { claim_id: claim.id, collection_carrier: carrier, collection_tracking_number: tracking };
    return json(corsHeaders, { success: true, ...data, data });
  }

  // 2-9: return inspection. Pickup first; defect/mismatch flips fault to the
  // seller (the approval then recomputes the return fee from that fault).
  const inspectM = p.match(/^\/api\/v1\/partner\/returns\/([^/]+)\/inspect$/);
  if (inspectM && (request.method === 'PUT' || request.method === 'POST')) {
    const b = await readJson(request);
    const result = String(b.result || '').toUpperCase();
    if (!['NORMAL', 'DEFECTIVE', 'MISMATCH'].includes(result)) throw bad('INVALID_RESULT', 'result는 NORMAL·DEFECTIVE·MISMATCH 중 하나여야 합니다.');
    const memo = str(b.memo, { field: '검수 메모', max: 500 });
    let photos = [];
    if (b.photos !== undefined && b.photos !== null) {
      if (!Array.isArray(b.photos)) throw bad('INVALID_PHOTOS', 'photos는 이미지 주소 배열이어야 합니다.');
      if (b.photos.length > 5) throw bad('TOO_MANY_PHOTOS', '검수 사진은 최대 5장까지 첨부할 수 있습니다.');
      try {
        photos = b.photos.map((u) => safeUrl(u, { field: '검수 사진', allowRelative: true, required: true }));
      } catch {
        throw bad('INVALID_PHOTOS', '검수 사진은 https 또는 사이트 상대경로(URL 2000자 이내)만 첨부할 수 있습니다.');
      }
    }
    const claim = await env.DB.prepare('SELECT r.* FROM returns r JOIN sub_orders so ON so.id = r.sub_order_id WHERE r.id = ? AND so.partner_id = ?').bind(inspectM[1], partnerId).first();
    if (!claim) throw notFound('클레임을 찾을 수 없습니다.');
    if (claim.status !== 'REQUESTED') throw conflict('CLAIM_NOT_OPEN', '요청 상태의 클레임만 검수할 수 있습니다.');
    if (!claim.collection_requested_at) throw conflict('PICKUP_REQUIRED', '수거 등록 후 검수할 수 있습니다.');
    if (claim.inspected_at) throw conflict('INSPECTED_ALREADY', '이미 검수된 클레임입니다.');
    const sellerFault = result !== 'NORMAL';
    await env.DB.prepare(
      `UPDATE returns SET inspected_at = CURRENT_TIMESTAMP, collection_completed_at = CURRENT_TIMESTAMP,
        inspection_result = ?, inspection_memo = ?, inspection_photos_json = ?,
        fault = ?, fault_note = ? WHERE id = ?`
    ).bind(result, memo || null, photos.length ? JSON.stringify(photos) : null,
      sellerFault ? 'SELLER' : claim.fault, sellerFault ? (memo || `검수 결과: ${result}`) : claim.fault_note, claim.id).run();
    const data = { claim_id: claim.id, inspection_result: result, fault: sellerFault ? 'SELLER' : claim.fault };
    return json(corsHeaders, { success: true, ...data, data });
  }

  // O14: exchange re-shipment — replacement goes out (stock moves, ledgered), sub-order re-enters the delivery flow.
  const reshipM = p.match(/^\/api\/v1\/partner\/returns\/([^/]+)\/reship$/);
  if (reshipM && request.method === 'POST') {
    const b = await readJson(request);
    const claim = await env.DB.prepare('SELECT r.*, so.partner_id, so.tracking_number AS sub_tracking, so.status AS sub_status FROM returns r JOIN sub_orders so ON so.id = r.sub_order_id WHERE r.id = ?').bind(reshipM[1]).first();
    if (!claim || claim.partner_id !== partnerId) throw forbidden('본인 판매 주문의 클레임만 처리할 수 있습니다.');
    if (claim.claim_type !== 'EXCHANGE' || claim.status !== 'APPROVED' || claim.exchange_status !== 'AWAITING_RESHIPMENT') throw conflict('NOT_AWAITING_RESHIPMENT', '승인되어 재출고를 기다리는 교환 건이 아닙니다.');
    const tracking = String(b.tracking_number || '').trim();
    if (!/^[A-Za-z0-9-]{6,40}$/.test(tracking)) throw bad('INVALID_TRACKING', '송장번호 형식이 올바르지 않습니다.');
    const carrier = str(b.carrier || b.carrier_code, { field: '택배사', max: 40, required: true });
    const received = b.return_received === true;
    const items = JSON.parse(claim.exchange_items_json || '[]');
    if (!items.length) throw conflict('NO_EXCHANGE_ITEMS', '교환 품목 정보가 없습니다.');
    const st = [];
    for (const it of items) {
      // stock >= 0 is enforced by trg_sku_stock_nonnegative: an out-of-stock replacement aborts the whole batch.
      st.push(env.DB.prepare('UPDATE product_skus SET stock_quantity = stock_quantity - ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').bind(it.quantity, it.to_sku_id));
      st.push(env.DB.prepare(`INSERT INTO inventory_ledger (id, sku_id, change_type, quantity_delta, balance_after, reference_id, idempotency_key)
                              VALUES (?, ?, 'MANUAL_ADJUST', ?, (SELECT stock_quantity FROM product_skus WHERE id = ?), ?, ?)`)
        .bind(newId('ldg'), it.to_sku_id, -it.quantity, it.to_sku_id, claim.id, `exchange-out:${claim.id}:${it.order_item_id}`));
      if (received) {
        st.push(env.DB.prepare("UPDATE product_skus SET stock_quantity = stock_quantity + ?, status = CASE WHEN stock_quantity + ? > 0 THEN 'IN_STOCK' ELSE status END, updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(it.quantity, it.quantity, it.from_sku_id));
        st.push(env.DB.prepare(`INSERT INTO inventory_ledger (id, sku_id, change_type, quantity_delta, balance_after, reference_id, idempotency_key)
                                VALUES (?, ?, 'RETURN_RESTOCK', ?, (SELECT stock_quantity FROM product_skus WHERE id = ?), ?, ?)`)
          .bind(newId('ldg'), it.from_sku_id, it.quantity, it.from_sku_id, claim.id, `exchange-in:${claim.id}:${it.order_item_id}`));
      }
    }
    st.push(env.DB.prepare(`UPDATE returns SET exchange_status = 'RESHIPPED', exchange_carrier = ?, exchange_tracking_number = ?, exchange_shipped_at = CURRENT_TIMESTAMP,
                            original_tracking_number = ?, return_received = ?, processed_by = ?, processed_at = CURRENT_TIMESTAMP
                            WHERE id = ? AND status = 'APPROVED' AND exchange_status = 'AWAITING_RESHIPMENT'`)
      .bind(carrier, tracking, claim.sub_tracking || null, received ? 1 : 0, me.userId, claim.id));
    st.push(env.DB.prepare(`UPDATE sub_orders SET status = 'SHIPPED', milestone_status = 'SHIPPED', carrier_code = ?, tracking_number = ?, shipped_at = CURRENT_TIMESTAMP,
                            delivered_at = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'RETURN_REQUESTED'`).bind(carrier, tracking, claim.sub_order_id));
    st.push(env.DB.prepare(`INSERT INTO milestone_tracking_logs (id, sub_order_id, carrier_code, tracking_number, stage_code, stage_name, location, description, occurred_at)
                            VALUES (?, ?, ?, ?, 'SHIPPED', '교환품 출고', '판매자 출고지', '교환 상품 운송장이 등록되었습니다.', CURRENT_TIMESTAMP)`).bind(newId('trk'), claim.sub_order_id, carrier, tracking));
    // Concurrent double submit, or the sub-order is no longer awaiting the exchange: abort everything (no stock moved twice).
    st.push(env.DB.prepare(`INSERT INTO batch_assertions (code) SELECT 'EXCHANGE_RESHIP_DRIFT' WHERE
                              (SELECT exchange_status FROM returns WHERE id = ?) != 'RESHIPPED' OR (SELECT tracking_number FROM sub_orders WHERE id = ?) != ?
                              OR (SELECT processed_by FROM returns WHERE id = ?) IS NULL`).bind(claim.id, claim.sub_order_id, tracking, claim.id));
    try {
      await env.DB.batch(st);
    } catch (e) {
      const m = String(e && e.message);
      if (m.includes('STOCK')) throw conflict('EXCHANGE_OUT_OF_STOCK', '교환할 옵션의 재고가 부족합니다. 반품(환불)으로 전환해 주세요.');
      if (m.includes('BATCH_ASSERTION') || m.includes('UNIQUE')) throw conflict('NOT_AWAITING_RESHIPMENT', '이미 재출고된 교환 건입니다.');
      throw e;
    }
    try {
      const ord = await env.DB.prepare(
        'SELECT o.customer_id, o.order_no FROM orders o JOIN sub_orders s ON s.parent_order_id = o.id WHERE s.id = ?'
      ).bind(claim.sub_order_id).first();
      if (ord) await pushOrderShipped(env, { orderNo: ord.order_no, customerId: ord.customer_id, trackingNumber: tracking });
    } catch { /* push must never fail the re-shipment */ }
    return json(corsHeaders, { success: true, claim_id: claim.id, exchange_status: 'RESHIPPED', sub_order_status: 'SHIPPED' });
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
    // O14 fault: the customer's reason decides; the seller may only shift it to the customer with a written reason.
    const override = b.fault ? String(b.fault).toUpperCase() : null;
    if (override && !['CUSTOMER', 'SELLER'].includes(override)) throw bad('INVALID_FAULT', 'fault 는 CUSTOMER 또는 SELLER 입니다.');
    const fault = override || claim.fault || null;
    if (override === 'CUSTOMER' && claim.fault !== 'CUSTOMER' && !notes) throw bad('FAULT_REASON_REQUIRED', '고객 귀책으로 판단한 근거를 적어 주세요. 고객이 이의를 제기할 수 있습니다.');
    if (claim.claim_type === 'EXCHANGE') {
      await env.DB.prepare("UPDATE returns SET status = 'APPROVED', exchange_status = 'AWAITING_RESHIPMENT', fault = ?, fault_note = ?, notes = ?, processed_by = ?, processed_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'REQUESTED'")
        .bind(fault, override ? notes : null, notes || null, me.userId, claim.id).run();
      return json(corsHeaders, { success: true, claim_id: claim.id, status: 'APPROVED', exchange_status: 'AWAITING_RESHIPMENT', next_action: 'POST /api/v1/partner/returns/:id/reship 으로 교환품 송장을 등록해 주세요.' });
    }
    const lines = JSON.parse(claim.items_json || '[]');
    const returnless = b.returnless === true;
    const bundle = await loadOrderBundle(env, claim.order_id);
    const subRow = bundle.subs.find((s) => s.id === claim.sub_order_id);
    const subItems = bundle.items.filter((i) => i.sub_order_id === claim.sub_order_id);
    const fullReturn = isFullReturn(subItems, lines);
    const returnFee = returnFeeFor({ fault, returnless, fullReturn, subShippingFee: subRow.shipping_fee, fees: await partnerReturnFees(env, partnerId) });
    await env.DB.prepare("UPDATE returns SET fault = ?, fault_note = ? WHERE id = ? AND status = 'REQUESTED'").bind(fault, override ? notes : null, claim.id).run();
    const r = await refundOrder(env, me, claim.order_id, {
      lines, shippingSubOrderIds: fault === 'SELLER' && fullReturn ? [claim.sub_order_id] : [], subOrderId: claim.sub_order_id, claimId: claim.id, reasonCode: 'RETURN',
      restock: !returnless && b.restock !== false, idemKey: `claim:${claim.id}`, subStatusOnFull: 'RETURNED', orderStatusOnFull: 'REFUNDED', returnFee
    });
    if (r.refund) await env.DB.prepare('UPDATE returns SET return_fee_amount = ? WHERE id = ?').bind(r.refund.return_fee_amount || 0, claim.id).run();
    if (returnless) await env.DB.prepare("UPDATE returns SET is_returnless = 1, returnless_reason = ? WHERE id = ?").bind(notes || '판매자 회수 생략 승인', claim.id).run();
    const after = await loadOrderBundle(env, claim.order_id);
    const sub = after.subs.find((s) => s.id === claim.sub_order_id);
    if (sub && sub.status === 'RETURN_REQUESTED') await env.DB.prepare("UPDATE sub_orders SET status = 'DELIVERED' WHERE id = ? AND status = 'RETURN_REQUESTED'").bind(sub.id).run();
    return json(corsHeaders, { success: true, claim_id: claim.id, status: 'REFUNDED', fault, return_fee: r.refund ? r.refund.return_fee_amount || 0 : 0, refund: r.refund });
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
    // Weekly GMV buckets (UTC days, oldest first) + week-over-week change.
    const { results: buckets } = await env.DB.prepare(
      `SELECT date(created_at) d, COALESCE(SUM(goods_amount + shipping_fee),0) s FROM sub_orders
       WHERE partner_id = ? AND status NOT IN ('PAYMENT_PENDING','EXPIRED','CANCELLED')
         AND date(created_at) >= date('now','-13 days') GROUP BY d`
    ).bind(partnerId).all();
    const byDay = new Map((buckets || []).map((x) => [x.d, x.s]));
    const dayKeys = [];
    for (let i = 6; i >= 0; i--) {
      const dd = new Date(Date.now() - i * 86400000);
      dayKeys.push(dd.toISOString().slice(0, 10));
    }
    const weeklyGmv = dayKeys.map((day) => ({ day, amount: byDay.get(day) || 0 }));
    const thisWeek = weeklyGmv.reduce((t, x) => t + x.amount, 0);
    let prevWeek = 0;
    for (let i = 7; i <= 13; i++) {
      const dd = new Date(Date.now() - i * 86400000);
      prevWeek += byDay.get(dd.toISOString().slice(0, 10)) || 0;
    }
    const wowPct = prevWeek > 0 ? Math.round(((thisWeek - prevWeek) / prevWeek) * 1000) / 10 : null;
    // Fulfillment quality gauges (null until measurable — never invented).
    const ship = await q("SELECT COUNT(*) c, COALESCE(SUM(CASE WHEN shipped_at IS NOT NULL AND (julianday(shipped_at) - julianday(created_at)) * 24 <= 24 THEN 1 ELSE 0 END),0) n FROM sub_orders WHERE partner_id = ? AND shipped_at IS NOT NULL");
    const shipOnTime = ship.c > 0 ? Math.round((ship.n / ship.c) * 1000) / 10 : null;
    const del = await q("SELECT AVG((julianday(delivered_at) - julianday(shipped_at))) a FROM sub_orders WHERE partner_id = ? AND shipped_at IS NOT NULL AND delivered_at IS NOT NULL");
    const avgDays = del.a === null ? null : Math.round(del.a * 10) / 10;
    const sub = await q('SELECT COUNT(*) c FROM sub_orders WHERE partner_id = ?');
    const allClaims = await q('SELECT COUNT(*) c FROM returns r JOIN sub_orders so ON so.id = r.sub_order_id WHERE so.partner_id = ?');
    const claimRate = sub.c > 0 ? Math.round((allClaims.c / sub.c) * 1000) / 10 : null;
    return json(corsHeaders, {
      success: true, partner_id: partnerId, business_name: partner.business_name,
      products_count: prod.c, orders_count: ord.c, total_sales_amount: ord.s, to_ship_count: toShip.c,
      settlement_expected_amount: stl.n, waiting_qna_count: qna.c, open_claims_count: claims.c, pending_review_count: review.c,
      weekly_gmv: weeklyGmv, wow_pct: wowPct,
      ship_on_time_rate: shipOnTime, avg_delivery_days: avgDays, claim_rate_pct: claimRate
    });
  }

  // 2-9: store coupons. Issuer/seller/dup-group/burden are server-forced;
  // money and scope freeze once issuance starts (only suspend stays).
  if (p === '/api/v1/partner/coupons' && request.method === 'GET') {
    const { results } = await env.DB.prepare(
      "SELECT * FROM coupons WHERE issuer = 'SELLER' AND seller_id = ? ORDER BY created_at DESC"
    ).bind(partnerId).all();
    return json(corsHeaders, { success: true, count: results.length, data: results });
  }
  if (p === '/api/v1/partner/coupons' && request.method === 'POST') {
    const b = await readJson(request);
    const code = str(b.code, { field: '쿠폰 코드', max: 40, required: true }).toUpperCase();
    const title = str(b.title, { field: '쿠폰명', max: 200, required: true });
    const dtype = String(b.discount_type || 'FIXED_AMOUNT').toUpperCase();
    if (!['FIXED_AMOUNT', 'PERCENT'].includes(dtype)) throw bad('INVALID_DISCOUNT_TYPE', 'discount_type은 FIXED_AMOUNT·PERCENT 중 하나여야 합니다.');
    const dval = Number(b.discount_value);
    if (!Number.isSafeInteger(dval) || dval <= 0 || (dtype === 'PERCENT' && dval > 90)) throw bad('INVALID_DISCOUNT', '할인 값이 올바르지 않습니다.');
    const scope = String(b.scope || 'SELLER').toUpperCase();
    if (!['SELLER', 'PRODUCT', 'CATEGORY'].includes(scope)) throw bad('INVALID_SCOPE', 'scope은 SELLER·PRODUCT·CATEGORY 중 하나여야 합니다.');
    const targets = Array.isArray(b.target_ids) ? [...new Set(b.target_ids.map((x) => String(x || '').trim()).filter(Boolean))] : [];
    if (scope !== 'SELLER' && !targets.length) throw bad('TARGETS_REQUIRED', '선택 범위 쿠폰은 target_ids가 필요합니다.');
    if (scope === 'SELLER' && targets.length) throw bad('TARGETS_FORBIDDEN', '스토어 전체 쿠폰에는 target_ids를 지정할 수 없습니다.');
    for (const tid of targets) {
      const ok = scope === 'PRODUCT'
        ? await env.DB.prepare('SELECT id FROM products WHERE id = ? AND partner_id = ?').bind(tid, partnerId).first()
        : await env.DB.prepare('SELECT id FROM categories WHERE id = ? OR slug = ?').bind(tid, tid).first();
      if (!ok) throw bad('INVALID_TARGET', `대상(${tid})을 찾을 수 없습니다.`);
    }
    const method = String(b.issue_method || 'DOWNLOAD').toUpperCase();
    if (!['DOWNLOAD', 'CODE', 'AUTO'].includes(method)) throw bad('INVALID_ISSUE_METHOD', 'issue_method는 DOWNLOAD·CODE·AUTO 중 하나여야 합니다.');
    const id = newId('cpn');
    const stmts = [env.DB.prepare(
      `INSERT INTO coupons (id, code, title, discount_type, discount_value, min_order_amount, max_discount_amount,
        expires_at, starts_at, is_active, issuer, seller_id, scope, platform_share_bps, dup_group, issue_method, total_quantity, per_user_limit)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 'SELLER', ?, ?, 0, 'STORE', ?, ?, ?)`
    ).bind(id, code, title, dtype, dval,
      b.min_order_amount === undefined ? 0 : intParam(b.min_order_amount, { min: 0, max: 100_000_000, field: '최소 주문금액' }),
      b.max_discount_amount === undefined || b.max_discount_amount === null ? null : intParam(b.max_discount_amount, { min: 1, max: 100_000_000, field: '최대 할인액' }),
      str(b.expires_at, { max: 30 }) || new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 19).replace('T', ' '),
      b.starts_at === undefined || b.starts_at === null ? null : str(b.starts_at, { max: 30 }),
      partnerId, scope, method,
      b.total_quantity === undefined || b.total_quantity === null ? null : intParam(b.total_quantity, { min: 1, max: 10_000_000, field: '총 수량' }),
      b.per_user_limit === undefined || b.per_user_limit === null ? null : intParam(b.per_user_limit, { min: 1, max: 100, field: '1인 한도' }))];
    for (const tid of targets) {
      stmts.push(env.DB.prepare('INSERT INTO coupon_targets (coupon_id, target_type, target_id) VALUES (?, ?, ?)')
        .bind(id, scope === 'PRODUCT' ? 'PRODUCT' : 'CATEGORY', tid));
    }
    try {
      await env.DB.batch(stmts);
    } catch (e) {
      if (String(e.message).includes('UNIQUE')) throw conflict('COUPON_CODE_TAKEN', '이미 사용 중인 쿠폰 코드입니다.');
      throw e;
    }
    const created = await env.DB.prepare('SELECT * FROM coupons WHERE id = ?').bind(id).first();
    return json(corsHeaders, { success: true, ...created, data: created }, 201);
  }
  const pcpM = p.match(/^\/api\/v1\/partner\/coupons\/([^/]+)$/);
  if (pcpM && (request.method === 'PUT' || request.method === 'PATCH')) {
    const b = await readJson(request);
    const cp = await env.DB.prepare("SELECT * FROM coupons WHERE id = ? AND issuer = 'SELLER' AND seller_id = ?").bind(pcpM[1], partnerId).first();
    if (!cp) throw notFound('쿠폰을 찾을 수 없습니다.');
    const started = Number(cp.issued_count) > 0;
    const moneyKeys = ['discount_type', 'discount_value', 'min_order_amount', 'max_discount_amount', 'scope', 'target_ids', 'total_quantity', 'per_user_limit', 'starts_at', 'expires_at'];
    if (started && moneyKeys.some((k) => b[k] !== undefined)) {
      throw conflict('COUPON_IMMUTABLE_AFTER_ISSUE', '발급이 시작된 쿠폰은 할인값·범위를 바꿀 수 없습니다. 중지만 가능합니다.');
    }
    if (b.discount_type !== undefined && !['FIXED_AMOUNT', 'PERCENT'].includes(String(b.discount_type).toUpperCase())) {
      throw bad('INVALID_DISCOUNT_TYPE', 'discount_type은 FIXED_AMOUNT·PERCENT 중 하나여야 합니다.');
    }
    const dtype = b.discount_type !== undefined ? String(b.discount_type).toUpperCase() : cp.discount_type;
    const dval = b.discount_value !== undefined ? Number(b.discount_value) : cp.discount_value;
    if (!Number.isSafeInteger(dval) || dval <= 0 || (dtype === 'PERCENT' && dval > 90)) throw bad('INVALID_DISCOUNT', '할인 값이 올바르지 않습니다.');
    const stmts = [env.DB.prepare(
      `UPDATE coupons SET title = ?, discount_type = ?, discount_value = ?, min_order_amount = ?, max_discount_amount = ?,
        expires_at = ?, starts_at = ?, total_quantity = ?, per_user_limit = ?, is_active = ? WHERE id = ?`
    ).bind(b.title !== undefined ? str(b.title, { field: '쿠폰명', max: 200, required: true }) : cp.title, dtype, dval,
      b.min_order_amount !== undefined ? intParam(b.min_order_amount, { min: 0, max: 100_000_000, field: '최소 주문금액' }) : cp.min_order_amount,
      b.max_discount_amount !== undefined ? (b.max_discount_amount === null ? null : intParam(b.max_discount_amount, { min: 1, max: 100_000_000, field: '최대 할인액' })) : cp.max_discount_amount,
      b.expires_at !== undefined ? str(b.expires_at, { max: 30, required: true }) : cp.expires_at,
      b.starts_at !== undefined ? (b.starts_at === null ? null : str(b.starts_at, { max: 30 })) : cp.starts_at,
      b.total_quantity !== undefined ? (b.total_quantity === null ? null : intParam(b.total_quantity, { min: 1, max: 10_000_000, field: '총 수량' })) : cp.total_quantity,
      b.per_user_limit !== undefined ? (b.per_user_limit === null ? null : intParam(b.per_user_limit, { min: 1, max: 100, field: '1인 한도' })) : cp.per_user_limit,
      b.is_active !== undefined ? (b.is_active ? 1 : 0) : cp.is_active, cp.id)];
    if (b.target_ids !== undefined) {
      const scope = String(b.scope || cp.scope).toUpperCase();
      if (scope === 'SELLER') throw bad('TARGETS_FORBIDDEN', '스토어 전체 쿠폰에는 target_ids를 지정할 수 없습니다.');
      const targets = [...new Set(b.target_ids.map((x) => String(x || '').trim()).filter(Boolean))];
      if (!targets.length) throw bad('TARGETS_REQUIRED', '선택 범위 쿠폰은 target_ids가 필요합니다.');
      stmts.push(env.DB.prepare('DELETE FROM coupon_targets WHERE coupon_id = ?').bind(cp.id));
      for (const tid of targets) {
        stmts.push(env.DB.prepare('INSERT INTO coupon_targets (coupon_id, target_type, target_id) VALUES (?, ?, ?)')
          .bind(cp.id, scope === 'PRODUCT' ? 'PRODUCT' : 'CATEGORY', tid));
      }
    }
    await env.DB.batch(stmts);
    const updatedCp = await env.DB.prepare('SELECT * FROM coupons WHERE id = ?').bind(cp.id).first();
    return json(corsHeaders, { success: true, ...updatedCp, data: updatedCp });
  }

  // 2-9: flash-sale campaigns + seller applications (REQUESTED until approved).
  if (p === '/api/v1/partner/flash-sales' && request.method === 'GET') {
    const { results } = await env.DB.prepare('SELECT * FROM flash_sale_campaigns ORDER BY starts_at DESC').all();
    for (const c of results) {
      const mine = await env.DB.prepare(
        'SELECT id, status, sku_id, deal_price, allocated_stock FROM flash_sale_items WHERE campaign_id = ? AND applicant_partner_id = ? ORDER BY rowid DESC LIMIT 1'
      ).bind(c.id, partnerId).first();
      c.my_application = mine || null;
    }
    return json(corsHeaders, { success: true, count: results.length, data: results });
  }
  const flsApplyM = p.match(/^\/api\/v1\/partner\/flash-sales\/([^/]+)\/apply$/);
  if (flsApplyM && request.method === 'POST') {
    const b = await readJson(request);
    const camp = await env.DB.prepare('SELECT * FROM flash_sale_campaigns WHERE id = ?').bind(flsApplyM[1]).first();
    if (!camp) throw notFound('특가 캠페인을 찾을 수 없습니다.');
    if (camp.status === 'ENDED' || (camp.ends_at && camp.ends_at <= new Date().toISOString().slice(0, 19).replace('T', ' '))) {
      throw conflict('CAMPAIGN_CLOSED', '종료된 캠페인에는 신청할 수 없습니다.');
    }
    const sku = await env.DB.prepare(
      `SELECT s.id, s.product_id, s.sale_price, s.stock_quantity FROM product_skus s JOIN products pr ON pr.id = s.product_id
       WHERE s.id = ? AND pr.partner_id = ?`
    ).bind(String(b.sku_id || ''), partnerId).first();
    if (!sku) throw notFound('옵션을 찾을 수 없습니다.');
    const deal = intParam(b.deal_price, { min: 100, max: 100_000_000, field: '딜가' });
    if (deal >= sku.sale_price) throw bad('DEAL_NOT_BELOW_SALE', '딜가는 판매가보다 낮아야 합니다.');
    const alloc = intParam(b.allocated_stock, { min: 1, max: 1_000_000, field: '배정 수량' });
    if (alloc > sku.stock_quantity) throw bad('ALLOCATION_EXCEEDS_STOCK', '배정 수량은 현재 재고를 넘을 수 없습니다.');
    const dup = await env.DB.prepare(
      'SELECT id, status FROM flash_sale_items WHERE campaign_id = ? AND sku_id = ? AND status IN (?, ?)'
    ).bind(camp.id, sku.id, 'REQUESTED', 'APPROVED').first();
    if (dup) throw conflict('ALREADY_APPLIED', '이미 신청·편성된 특가입니다.');
    const itemId = newId('fsi');
    const prod = await env.DB.prepare('SELECT original_price FROM product_skus WHERE id = ?').bind(sku.id).first();
    await env.DB.prepare(
      `INSERT INTO flash_sale_items (id, campaign_id, product_id, sku_id, deal_price, discount_rate, allocated_stock, sold_stock, sort_order, status, applicant_partner_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, 'REQUESTED', ?)`
    ).bind(itemId, camp.id, sku.product_id, sku.id, deal,
      prod.original_price > deal ? Math.floor(((prod.original_price - deal) * 100) / prod.original_price) : 0, alloc, partnerId).run();
    const createdItem = await env.DB.prepare('SELECT * FROM flash_sale_items WHERE id = ?').bind(itemId).first();
    return json(corsHeaders, { success: true, ...createdItem, data: createdItem }, 201);
  }

  // 2-9: payout requests over the 2-4 engine (amount/account/inflight guarded).
  if (p === '/api/v1/partner/payout-requests' && request.method === 'GET') {
    const { results } = await env.DB.prepare('SELECT * FROM payout_requests WHERE partner_id = ? ORDER BY created_at DESC').bind(partnerId).all();
    const data = { requests: results, available_amount: await withdrawableAmount(env, partnerId), account_verified: Number(partner.payout_account_verified) === 1 };
    return json(corsHeaders, { success: true, count: results.length, ...data, data });
  }
  if (p === '/api/v1/partner/payout-requests' && request.method === 'POST') {
    const b = await readJson(request);
    const row = await requestPayout(env, { partnerId, amount: Number(b.amount), idemKey: request.headers.get('X-Idempotency-Key') ?? b.idempotency_key ?? null });
    return json(corsHeaders, { success: true, ...row, data: row }, row.idempotent_replay ? 200 : 201);
  }
  const pwrCancelM = p.match(/^\/api\/v1\/partner\/payout-requests\/([^/]+)\/cancel$/);
  if (pwrCancelM && request.method === 'POST') {
    const row = await cancelPayoutRequest(env, { requestId: pwrCancelM[1], partnerId });
    return json(corsHeaders, { success: true, ...row, data: row });
  }

  // 2-9: store decor; featured slots take own on-sale products only.
  if (p === '/api/v1/partner/store-profile' && request.method === 'GET') {
    const profile = await env.DB.prepare('SELECT * FROM partner_store_profiles WHERE partner_id = ?').bind(partnerId).first();
    return json(corsHeaders, { success: true, data: { profile: profile || null } });
  }
  if (p === '/api/v1/partner/store-profile' && (request.method === 'PUT' || request.method === 'POST')) {
    const b = await readJson(request);
    const featured = b.featured_product_ids !== undefined ? b.featured_product_ids : null;
    if (featured !== null) {
      if (!Array.isArray(featured)) throw bad('INVALID_FEATURED', 'featured_product_ids는 배열이어야 합니다.');
      if (featured.length > 8) throw bad('TOO_MANY_FEATURED', '대표 상품은 최대 8개까지 지정할 수 있습니다.');
      for (const pid of featured) {
        const ok = await env.DB.prepare("SELECT id FROM products WHERE id = ? AND partner_id = ? AND status = 'ACTIVE'").bind(String(pid), partnerId).first();
        if (!ok) throw bad('INVALID_FEATURED', '대표 상품은 본인의 판매중 상품만 지정할 수 있습니다.');
      }
    }
    const row = {
      logo_url: b.logo_url !== undefined ? (b.logo_url === null ? null : safeUrl(b.logo_url, { field: '로고', allowRelative: true })) : undefined,
      banner_url: b.banner_url !== undefined ? (b.banner_url === null ? null : safeUrl(b.banner_url, { field: '배너', allowRelative: true })) : undefined,
      intro: b.intro !== undefined ? (b.intro === null ? null : str(b.intro, { field: '소개', max: 1000 })) : undefined,
      notice: b.notice !== undefined ? (b.notice === null ? null : str(b.notice, { field: '공지', max: 2000 })) : undefined,
      featured: featured !== null ? JSON.stringify([...new Set(featured.map(String))]) : undefined
    };
    const exists = await env.DB.prepare('SELECT partner_id FROM partner_store_profiles WHERE partner_id = ?').bind(partnerId).first();
    if (!exists) {
      await env.DB.prepare(
        'INSERT INTO partner_store_profiles (partner_id, logo_url, banner_url, intro, notice, featured_product_ids_json) VALUES (?, ?, ?, ?, ?, ?)'
      ).bind(partnerId, row.logo_url ?? null, row.banner_url ?? null, row.intro ?? null, row.notice ?? null, row.featured ?? '[]').run();
    } else {
      const sets = [];
      const vals = [];
      for (const [col, v] of [['logo_url', row.logo_url], ['banner_url', row.banner_url], ['intro', row.intro], ['notice', row.notice], ['featured_product_ids_json', row.featured]]) {
        if (v !== undefined) { sets.push(`${col} = ?`); vals.push(v); }
      }
      if (sets.length) {
        await env.DB.prepare(`UPDATE partner_store_profiles SET ${sets.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE partner_id = ?`).bind(...vals, partnerId).run();
      }
    }
    const profile = await env.DB.prepare('SELECT * FROM partner_store_profiles WHERE partner_id = ?').bind(partnerId).first();
    return json(corsHeaders, { success: true, data: { profile } });
  }

  // 2-9: review replies + reports on own products only.
  const prvReplyM = p.match(/^\/api\/v1\/partner\/reviews\/([^/]+)\/reply$/);
  if (prvReplyM && (request.method === 'PUT' || request.method === 'POST')) {
    const b = await readJson(request);
    const body = str(b.body, { field: '답글', max: 2000, required: true });
    const rev = await env.DB.prepare(
      'SELECT r.id FROM product_reviews r JOIN products pr ON pr.id = r.product_id WHERE r.id = ? AND pr.partner_id = ?'
    ).bind(prvReplyM[1], partnerId).first();
    if (!rev) throw notFound('리뷰를 찾을 수 없습니다.');
    await env.DB.prepare(
      `INSERT INTO review_replies (id, review_id, partner_id, body) VALUES (?, ?, ?, ?)
       ON CONFLICT (review_id) DO UPDATE SET body = excluded.body, updated_at = CURRENT_TIMESTAMP`
    ).bind(newId('vr'), rev.id, partnerId, body).run();
    const reply = await env.DB.prepare('SELECT * FROM review_replies WHERE review_id = ?').bind(rev.id).first();
    return json(corsHeaders, { success: true, ...reply, data: reply });
  }
  if (prvReplyM && request.method === 'DELETE') {
    const rev = await env.DB.prepare(
      'SELECT r.id FROM product_reviews r JOIN products pr ON pr.id = r.product_id WHERE r.id = ? AND pr.partner_id = ?'
    ).bind(prvReplyM[1], partnerId).first();
    if (!rev) throw notFound('리뷰를 찾을 수 없습니다.');
    const r = await env.DB.prepare('DELETE FROM review_replies WHERE review_id = ? AND partner_id = ?').bind(rev.id, partnerId).run();
    if (r.meta.changes !== 1) throw notFound('답글을 찾을 수 없습니다.');
    return json(corsHeaders, { success: true, deleted: true });
  }
  const prvReportM = p.match(/^\/api\/v1\/partner\/reviews\/([^/]+)\/report$/);
  if (prvReportM && request.method === 'POST') {
    const b = await readJson(request);
    const reason = String(b.reason || '').toUpperCase();
    if (!['PROFANITY', 'PRIVACY', 'AD', 'IRRELEVANT', 'OTHER'].includes(reason)) {
      throw bad('INVALID_REASON', 'reason은 PROFANITY·PRIVACY·AD·IRRELEVANT·OTHER 중 하나여야 합니다.');
    }
    const rev = await env.DB.prepare(
      'SELECT r.id FROM product_reviews r JOIN products pr ON pr.id = r.product_id WHERE r.id = ? AND pr.partner_id = ?'
    ).bind(prvReportM[1], partnerId).first();
    if (!rev) throw notFound('리뷰를 찾을 수 없습니다.');
    const dup = await env.DB.prepare('SELECT id FROM review_reports WHERE review_id = ? AND reporter_user_id = ?').bind(rev.id, me.userId).first();
    if (dup) throw conflict('REPORT_EXISTS', '이미 신고한 리뷰입니다.');
    const reportId = newId('rrp');
    try {
      await env.DB.prepare('INSERT INTO review_reports (id, review_id, reporter_user_id, reason) VALUES (?, ?, ?, ?)').bind(reportId, rev.id, me.userId, reason).run();
    } catch (e) {
      if (String(e && e.message || '').includes('UNIQUE constraint failed')) throw conflict('REPORT_EXISTS', '이미 신고한 리뷰입니다.');
      throw e;
    }
    const data = { report_id: reportId, review_id: rev.id, reason };
    return json(corsHeaders, { success: true, ...data, data }, 201);
  }

  // 2-9: penalties + one appeal per penalty.
  if (p === '/api/v1/partner/penalties' && request.method === 'GET') {
    const { results } = await env.DB.prepare('SELECT * FROM partner_penalties WHERE partner_id = ? ORDER BY created_at DESC').bind(partnerId).all();
    return json(corsHeaders, { success: true, count: results.length, data: results });
  }
  const penAppealM = p.match(/^\/api\/v1\/partner\/penalties\/([^/]+)\/appeal$/);
  if (penAppealM && request.method === 'POST') {
    const b = await readJson(request);
    const body = str(b.body, { field: '이의 사유', max: 2000, required: true });
    const pen = await env.DB.prepare('SELECT * FROM partner_penalties WHERE id = ? AND partner_id = ?').bind(penAppealM[1], partnerId).first();
    if (!pen) throw notFound('페널티를 찾을 수 없습니다.');
    if (pen.appeal_body) throw conflict('APPEAL_EXISTS', '이미 이의를 제기한 페널티입니다.');
    await env.DB.prepare('UPDATE partner_penalties SET appeal_body = ? WHERE id = ?').bind(body, pen.id).run();
    const updatedPen = await env.DB.prepare('SELECT * FROM partner_penalties WHERE id = ?').bind(pen.id).first();
    return json(corsHeaders, { success: true, ...updatedPen, data: updatedPen });
  }

  return null;
}
