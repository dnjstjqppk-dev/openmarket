// apps/cloudflare-gateway/src/routes/partner-coupons.js
// Seller coupon definitions (work order 2-3). Sellers manage only their own
// SELLER-owned definitions; platform definitions are operator-only.

import { requireApprovedPartner } from '../lib/auth.js';
import { json, readJson, bad, notFound, str, intParam } from '../lib/http.js';
import { newId } from '../lib/ids.js';

function shape(row) {
  return {
    id: row.id, owner_type: row.owner_type, partner_id: row.partner_id, code: row.code,
    title: row.title, discount_type: row.discount_type, discount_value: row.discount_value,
    min_order_amount: row.min_order_amount, max_discount_amount: row.max_discount_amount,
    per_user_limit: row.per_user_limit, total_limit: row.total_limit,
    valid_from: row.valid_from, valid_to: row.valid_to, is_active: Number(row.is_active) === 1
  };
}

export async function handlePartnerCouponRoutes(request, url, env, corsHeaders) {
  const p = url.pathname;
  if (!p.startsWith('/api/v1/partner/coupons')) return null;
  const me = await requireApprovedPartner(request, env);
  const partnerId = me.partner.id;

  if (p === '/api/v1/partner/coupons' && request.method === 'GET') {
    const { results } = await env.DB.prepare(
      'SELECT * FROM coupon_definitions WHERE partner_id = ? ORDER BY created_at DESC'
    ).bind(partnerId).all();
    return json(corsHeaders, { success: true, count: results.length, data: results.map(shape) });
  }

  if (p === '/api/v1/partner/coupons' && request.method === 'POST') {
    const b = await readJson(request);
    const title = str(b.title, { field: '쿠폰명', max: 100, required: true });
    const discountType = str(b.discount_type, { field: '할인 방식', max: 20, required: true });
    if (!['PERCENT', 'FIXED_AMOUNT'].includes(discountType)) throw bad('BAD_DISCOUNT_TYPE', '할인 방식은 PERCENT 또는 FIXED_AMOUNT입니다.');
    const discountValue = discountType === 'PERCENT'
      ? intParam(b.discount_value, { field: '할인율', min: 1, max: 100 })
      : intParam(b.discount_value, { field: '할인액', min: 1, max: 10000000 });
    const code = b.code ? str(b.code, { field: '쿠폰 코드', max: 40 }).toUpperCase() : null;
    if (code) {
      const dup = await env.DB.prepare('SELECT id FROM coupon_definitions WHERE UPPER(code) = ?').bind(code).first();
      if (dup) throw bad('CODE_TAKEN', '이미 사용 중인 쿠폰 코드입니다.');
    }
    const id = newId('cd');
    await env.DB.prepare(
      `INSERT INTO coupon_definitions (id, owner_type, partner_id, code, title, discount_type, discount_value,
        min_order_amount, max_discount_amount, per_user_limit, total_limit, valid_from, valid_to, is_active)
       VALUES (?, 'SELLER', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`
    ).bind(
      id, partnerId, code, title, discountType, discountValue,
      Math.max(0, Number(b.min_order_amount) || 0),
      b.max_discount_amount == null ? null : Math.max(0, Number(b.max_discount_amount)),
      Math.max(1, Number(b.per_user_limit) || 1),
      b.total_limit == null ? null : Math.max(1, Number(b.total_limit)),
      b.valid_from || null, b.valid_to || null
    ).run();
    const row = await env.DB.prepare('SELECT * FROM coupon_definitions WHERE id = ?').bind(id).first();
    return json(corsHeaders, { success: true, data: shape(row) }, 201);
  }

  const m = p.match(/^\/api\/v1\/partner\/coupons\/([^/]+)$/);
  if (m && (request.method === 'PATCH' || request.method === 'PUT')) {
    const row = await env.DB.prepare('SELECT * FROM coupon_definitions WHERE id = ? AND partner_id = ?').bind(m[1], partnerId).first();
    if (!row) throw notFound('쿠폰을 찾을 수 없습니다.');
    const b = await readJson(request);
    const patch = {};
    if (b.title !== undefined) patch.title = str(b.title, { field: '쿠폰명', max: 100, required: true });
    if (b.is_active !== undefined) patch.is_active = b.is_active ? 1 : 0;
    if (b.valid_to !== undefined) patch.valid_to = b.valid_to || null;
    if (!Object.keys(patch).length) throw bad('NOTHING_TO_UPDATE', '변경할 항목이 없습니다.');
    const cols = Object.keys(patch);
    await env.DB.prepare(`UPDATE coupon_definitions SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`)
      .bind(...cols.map((c) => patch[c]), m[1]).run();
    const next = await env.DB.prepare('SELECT * FROM coupon_definitions WHERE id = ?').bind(m[1]).first();
    return json(corsHeaders, { success: true, data: shape(next) });
  }

  return null;
}
