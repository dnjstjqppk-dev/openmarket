// apps/cloudflare-gateway/src/routes/business.js
// Operating business entities: sole proprietorship today, corporation later, affiliates in the future.
// Orders/settlements/journal rows carry operator_entity_id captured at transaction time and are never re-attributed.

import { requireAdmin } from '../lib/auth.js';
import { json, readJson, bad, conflict, notFound, str } from '../lib/http.js';
import { newId, sqlNow } from '../lib/ids.js';
import { auditStatement } from '../lib/ledger.js';

const LEGAL_FIELDS = ['entity_type', 'legal_name', 'representative_name', 'business_reg_number', 'corporate_reg_number', 'tax_type'];
const OPERATIONAL_FIELDS = ['mail_order_reg_number', 'address', 'cs_phone', 'cs_email', 'privacy_officer_name', 'privacy_officer_email',
  'hosting_provider', 'pg_provider', 'pg_merchant_ref', 'escrow_service_ref', 'settlement_bank_ref', 'terms_version'];
const REQUIRED_FOR_ACTIVATION = ['legal_name', 'representative_name', 'business_reg_number', 'mail_order_reg_number', 'address', 'cs_phone', 'cs_email', 'privacy_officer_name', 'privacy_officer_email'];

function normalizeBrn(v) {
  const digits = String(v || '').replace(/\D/g, '');
  if (digits.length !== 10) throw bad('INVALID_BRN', '사업자등록번호는 10자리 숫자여야 합니다.');
  // National Tax Service check digit
  const w = [1, 3, 7, 1, 3, 7, 1, 3, 5];
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += Number(digits[i]) * w[i];
  sum += Math.floor((Number(digits[8]) * 5) / 10);
  if ((10 - (sum % 10)) % 10 !== Number(digits[9])) throw bad('INVALID_BRN', '사업자등록번호 검증번호가 올바르지 않습니다.');
  return `${digits.slice(0, 3)}-${digits.slice(3, 5)}-${digits.slice(5)}`;
}

function pick(body, fields) {
  const out = {};
  for (const f of fields) if (body[f] !== undefined) out[f] = body[f] === null ? null : str(body[f], { field: f, max: 300 });
  return out;
}

export async function entityObligations(env, entityId) {
  const q = (sql, ...b) => env.DB.prepare(sql).bind(...b).first();
  const unpaidOrders = await q("SELECT COUNT(*) c, COALESCE(SUM(total_pay_amount),0) a FROM orders WHERE operator_entity_id = ? AND payment_status = 'READY'", entityId);
  const openFulfilment = await q(`SELECT COUNT(DISTINCT s.id) c FROM sub_orders s JOIN orders o ON o.id = s.parent_order_id
     WHERE o.operator_entity_id = ? AND s.status IN ('PAYMENT_CONFIRMED','PREPARING','SHIPPED','IN_TRANSIT','DELIVERED','RETURN_REQUESTED')`, entityId);
  const refundable = await q(`SELECT COALESCE(SUM(total_pay_amount - refunded_pg_amount),0) pg, COALESCE(SUM(credit_used_amount - refunded_credit_amount),0) cr
     FROM orders WHERE operator_entity_id = ? AND payment_status IN ('PAID','PARTIAL_REFUNDED')`, entityId);
  const payable = await q(`SELECT COUNT(*) c, COALESCE(SUM(st.net_payout_amount + COALESCE((SELECT SUM(a.net_delta) FROM settlement_adjustments a WHERE a.settlement_id = st.id), 0)),0) a
     FROM settlements st WHERE st.operator_entity_id = ? AND st.status IN ('PENDING','ELIGIBLE_FOR_PAYOUT')`, entityId);
  const carried = await q(`SELECT COALESCE(SUM(a.net_delta),0) a FROM settlement_adjustments a JOIN settlements st ON st.id = a.settlement_id
     WHERE st.operator_entity_id = ? AND st.status = 'PAID_OUT' AND a.applied_payout_id IS NULL`, entityId);
  const pos = await q("SELECT COUNT(*) c FROM purchase_orders WHERE operator_entity_id = ? AND status IN ('DRAFT','SENT','CONFIRMED')", entityId);
  const openClaims = await q("SELECT COUNT(*) c FROM returns r JOIN orders o ON o.id = r.order_id WHERE o.operator_entity_id = ? AND r.status IN ('REQUESTED','APPROVED')", entityId);
  const { results: balances } = await env.DB.prepare(
    'SELECT account_code, SUM(debit) AS debit, SUM(credit) AS credit FROM journal_entries WHERE entity_id = ? GROUP BY account_code ORDER BY account_code'
  ).bind(entityId).all();
  return {
    unpaid_orders: unpaidOrders,
    open_fulfilment_sub_orders: openFulfilment.c,
    refundable_to_customers: { pg: refundable.pg, credit: refundable.cr },
    seller_payables: { settlements: payable.c, amount: payable.a, post_payout_adjustments: carried.a },
    open_purchase_orders: pos.c,
    open_claims: openClaims.c,
    journal_balances: balances
  };
}

export async function handleBusinessRoutes(request, url, env, corsHeaders) {
  const p = url.pathname;

  // Public legal disclosure (전자상거래법 제10조 사업자 정보 표시)
  if (p === '/api/v1/business-info' && request.method === 'GET') {
    const e = await env.DB.prepare("SELECT * FROM business_entities WHERE role = 'PLATFORM_OPERATOR' AND status = 'ACTIVE' LIMIT 1").first();
    if (!e) return json(corsHeaders, { success: true, configured: false, data: null });
    return json(corsHeaders, {
      success: true, configured: true,
      data: {
        entity_type: e.entity_type, legal_name: e.legal_name, representative_name: e.representative_name,
        business_reg_number: e.business_reg_number, corporate_reg_number: e.corporate_reg_number, mail_order_reg_number: e.mail_order_reg_number,
        address: e.address, cs_phone: e.cs_phone, cs_email: e.cs_email, privacy_officer_name: e.privacy_officer_name,
        privacy_officer_email: e.privacy_officer_email, hosting_provider: e.hosting_provider, escrow_service_ref: e.escrow_service_ref,
        operating_from: e.operating_from
      }
    });
  }

  if (!p.startsWith('/api/v1/admin/business-entities')) return null;
  const admin = await requireAdmin(request, env);

  if (p === '/api/v1/admin/business-entities' && request.method === 'GET') {
    const { results } = await env.DB.prepare('SELECT * FROM business_entities ORDER BY created_at').all();
    return json(corsHeaders, { success: true, count: results.length, data: results });
  }

  if (p === '/api/v1/admin/business-entities' && request.method === 'POST') {
    const body = await readJson(request);
    const legal = pick(body, LEGAL_FIELDS);
    if (!['INDIVIDUAL', 'CORPORATION'].includes(legal.entity_type)) throw bad('INVALID_ENTITY_TYPE', 'entity_type은 INDIVIDUAL 또는 CORPORATION 이어야 합니다.');
    if (!legal.legal_name || !legal.representative_name) throw bad('REQUIRED', '상호(법인명)와 대표자명은 필수입니다.');
    legal.business_reg_number = normalizeBrn(body.business_reg_number);
    if (legal.entity_type === 'CORPORATION' && !/^\d{6}-?\d{7}$/.test(String(legal.corporate_reg_number || ''))) throw bad('INVALID_CRN', '법인등록번호(13자리)가 필요합니다.');
    const ops = pick(body, OPERATIONAL_FIELDS);
    const row = { id: newId('be'), role: body.role === 'AFFILIATE' ? 'AFFILIATE' : 'PLATFORM_OPERATOR', tax_type: legal.tax_type || 'GENERAL', ...legal, ...ops, address: ops.address || '', cs_phone: ops.cs_phone || '', cs_email: ops.cs_email || '' };
    const cols = Object.keys(row);
    try {
      await env.DB.batch([
        env.DB.prepare(`INSERT INTO business_entities (${cols.join(', ')}, status) VALUES (${cols.map(() => '?').join(', ')}, 'DRAFT')`).bind(...cols.map((c) => row[c] ?? null)),
        env.DB.prepare('INSERT INTO business_entity_events (id, entity_id, event_type, after_json, actor_user_id) VALUES (?, ?, ?, ?, ?)').bind(newId('bev'), row.id, 'CREATED', JSON.stringify(row), admin.userId),
        auditStatement(env, admin, { action: 'BUSINESS_ENTITY_CREATE', targetType: 'business_entity', targetId: row.id, after: row, request })
      ]);
    } catch (e) {
      if (String(e.message).includes('UNIQUE')) throw conflict('BRN_EXISTS', '이미 등록된 사업자등록번호입니다.');
      throw e;
    }
    return json(corsHeaders, { success: true, data: await env.DB.prepare('SELECT * FROM business_entities WHERE id = ?').bind(row.id).first() }, 201);
  }

  const m = p.match(/^\/api\/v1\/admin\/business-entities\/([^/]+)(?:\/(activate|obligations|events))?$/);
  if (!m) return null;
  const entity = await env.DB.prepare('SELECT * FROM business_entities WHERE id = ?').bind(m[1]).first();
  if (!entity) throw notFound('사업자 정보를 찾을 수 없습니다.');

  if (!m[2] && (request.method === 'PUT' || request.method === 'PATCH')) {
    const body = await readJson(request);
    if (entity.status === 'RETIRED') throw conflict('ENTITY_RETIRED', '운영 종료된 사업자 정보는 수정할 수 없습니다. (거래 귀속 보존)');
    const changes = pick(body, OPERATIONAL_FIELDS);
    if (entity.status === 'DRAFT') {
      Object.assign(changes, pick(body, LEGAL_FIELDS));
      if (body.business_reg_number !== undefined) changes.business_reg_number = normalizeBrn(body.business_reg_number);
    } else if (LEGAL_FIELDS.some((f) => body[f] !== undefined && body[f] !== entity[f])) {
      throw conflict('LEGAL_FIELDS_LOCKED', '운영 중인 사업자의 법적 식별정보는 변경할 수 없습니다. 새 사업자를 등록하고 전환 절차를 진행하세요.');
    }
    const keys = Object.keys(changes);
    if (!keys.length) throw bad('NO_CHANGES', '변경할 항목이 없습니다.');
    await env.DB.batch([
      env.DB.prepare(`UPDATE business_entities SET ${keys.map((k) => `${k} = ?`).join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).bind(...keys.map((k) => changes[k]), entity.id),
      env.DB.prepare('INSERT INTO business_entity_events (id, entity_id, event_type, before_json, after_json, actor_user_id) VALUES (?, ?, ?, ?, ?, ?)').bind(newId('bev'), entity.id, 'UPDATED', JSON.stringify(entity), JSON.stringify(changes), admin.userId),
      auditStatement(env, admin, { action: 'BUSINESS_ENTITY_UPDATE', targetType: 'business_entity', targetId: entity.id, before: entity, after: changes, request })
    ]);
    return json(corsHeaders, { success: true, data: await env.DB.prepare('SELECT * FROM business_entities WHERE id = ?').bind(entity.id).first() });
  }

  if (m[2] === 'obligations' && request.method === 'GET') {
    return json(corsHeaders, { success: true, entity_id: entity.id, data: await entityObligations(env, entity.id) });
  }

  if (m[2] === 'events' && request.method === 'GET') {
    const { results } = await env.DB.prepare('SELECT * FROM business_entity_events WHERE entity_id = ? ORDER BY created_at').bind(entity.id).all();
    return json(corsHeaders, { success: true, data: results });
  }

  // Operator switch-over: new transactions are attributed to the new entity from this moment.
  // Historical transactions stay with the old entity; its open obligations are reported, not moved.
  if (m[2] === 'activate' && request.method === 'POST') {
    const body = await readJson(request);
    if (entity.status !== 'DRAFT') throw conflict('ENTITY_NOT_DRAFT', '등록 대기(DRAFT) 상태의 사업자만 활성화할 수 있습니다.');
    const missing = REQUIRED_FOR_ACTIVATION.filter((f) => !entity[f]);
    if (missing.length) throw bad('ENTITY_INCOMPLETE', `활성화 전 필수 항목이 누락되었습니다: ${missing.join(', ')}`, { missing });
    if (body.confirm_legal_review !== true) {
      throw bad('LEGAL_REVIEW_CONFIRMATION_REQUIRED', '운영 주체 전환은 세무·법률·PG 계약 검토 완료 확인(confirm_legal_review=true)이 필요합니다.');
    }
    const current = await env.DB.prepare("SELECT * FROM business_entities WHERE role = 'PLATFORM_OPERATOR' AND status = 'ACTIVE'").first();
    const now = sqlNow();
    const st = [];
    if (current) {
      st.push(env.DB.prepare("UPDATE business_entities SET status = 'RETIRED', operating_to = ?, successor_entity_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'ACTIVE'").bind(now, entity.id, current.id));
      st.push(env.DB.prepare('INSERT INTO business_entity_events (id, entity_id, event_type, before_json, after_json, actor_user_id, note) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .bind(newId('bev'), current.id, 'RETIRED_AS_OPERATOR', JSON.stringify({ status: 'ACTIVE' }), JSON.stringify({ status: 'RETIRED', successor: entity.id, operating_to: now }), admin.userId, str(body.note, { max: 500 }) || null));
    }
    st.push(env.DB.prepare("UPDATE business_entities SET status = 'ACTIVE', operating_from = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'DRAFT'").bind(now, entity.id));
    st.push(env.DB.prepare('INSERT INTO business_entity_events (id, entity_id, event_type, before_json, after_json, actor_user_id, note) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .bind(newId('bev'), entity.id, 'ACTIVATED_AS_OPERATOR', JSON.stringify({ status: 'DRAFT', predecessor: current ? current.id : null }), JSON.stringify({ status: 'ACTIVE', operating_from: now }), admin.userId, str(body.note, { max: 500 }) || null));
    // DIRECT (MODEL A) stores belong to the operator: future direct sales accrue to the new entity.
    st.push(env.DB.prepare("UPDATE partners SET operator_entity_id = ?, updated_at = CURRENT_TIMESTAMP WHERE sales_model = 'DIRECT'").bind(entity.id));
    st.push(auditStatement(env, admin, { action: 'OPERATOR_SWITCH', targetType: 'business_entity', targetId: entity.id, before: current ? { active: current.id } : null, after: { active: entity.id, at: now }, request }));
    await env.DB.batch(st);
    return json(corsHeaders, {
      success: true,
      data: {
        active_entity_id: entity.id,
        retired_entity_id: current ? current.id : null,
        effective_at: now,
        predecessor_open_obligations: current ? await entityObligations(env, current.id) : null,
        note: '기존 거래·정산·원장은 이전 사업자에 귀속된 상태로 유지됩니다. 미정산·환불 채무·계약 승계는 별도 절차로 처리하세요.'
      }
    });
  }

  return null;
}
