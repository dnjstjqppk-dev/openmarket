// apps/cloudflare-gateway/src/routes/global-governance.js
// OLMOA Global OpenMarket Phase 3: Central Operations Control Tower, FDS Anti-Fraud Watch & 3-Party Dispute Arbitration Tribunal

import { requireAdmin } from '../lib/auth.js';
import { json, readJson, bad, conflict, notFound, str } from '../lib/http.js';
import { logPiiView, maskLast4 } from '../services/privacy.js';
import { auditStatement } from '../lib/ledger.js';
import { maybeOpenPii } from '../lib/pii-crypto.js';

export const FDS_ACTIVE_RULES = [
  { id: 'RULE_01', code: 'VELOCITY_CARD_TEST', name: '10분 내 동일 계정 결제 3회 실패 차단', severity: 'CRITICAL', status: 'ACTIVE', hit_count_24h: null, enforcement: 'ENFORCED_AT_CHECKOUT' },
  { id: 'RULE_02', code: 'GEO_IP_MISMATCH', name: '해외 IP 첫 결제 심사 (구매 이력 있으면 통과)', severity: 'HIGH', status: 'ACTIVE', hit_count_24h: null, enforcement: 'ENFORCED_AT_CHECKOUT' },
  { id: 'RULE_03', code: 'WASH_TRADING_GUARD', name: '구매자=판매자 또는 판매자 CS 번호 수령 차단', severity: 'CRITICAL', status: 'ACTIVE', hit_count_24h: null, enforcement: 'ENFORCED_AT_CHECKOUT' },
  { id: 'RULE_04', code: 'HIGH_VALUE_ESCROW_HOLD', name: '고액 주문(150만원 이상) 정산 보류 + 수동 심사', severity: 'MEDIUM', status: 'ACTIVE', hit_count_24h: null, enforcement: 'ENFORCED_AT_CHECKOUT' },
  { id: 'RULE_05', code: 'PROHIBITED_HS_SCANNER', name: '수입금지 HS 부호 차단 (운영자 차단목록)', severity: 'HIGH', status: 'ACTIVE', hit_count_24h: null, enforcement: 'ENFORCED_AT_CHECKOUT' }
];

export async function handleGlobalGovernanceRoutes(request, url, env, corsHeaders) {
  if (!url.pathname.startsWith('/api/v1/admin/control-tower') &&
      !url.pathname.startsWith('/api/v1/admin/fds') &&
      !url.pathname.startsWith('/api/v1/admin/disputes')) {
    return null;
  }

  const govAdmin = await requireAdmin(request, env);

  // 1. Central Operations Control Tower Overview (/api/v1/admin/control-tower)
  if (url.pathname === '/api/v1/admin/control-tower' && request.method === 'GET') {
    const orderStats = await env.DB.prepare(
      "SELECT COUNT(*) as total_orders, COALESCE(SUM(total_goods_amount - volume_discount_amount + total_shipping_amount), 0) as total_gmv FROM orders WHERE paid_at IS NOT NULL AND is_sandbox = 0"
    ).first();
    const pcccOrders = await env.DB.prepare(
      "SELECT COUNT(*) as cnt FROM orders WHERE pccc IS NOT NULL AND pccc != ''"
    ).first();
    const escrowStats = await env.DB.prepare(
      "SELECT COUNT(*) as pending_count, COALESCE(SUM(net_payout_amount), 0) as escrow_balance FROM settlements WHERE status = 'PENDING'"
    ).first();
    const disputeStats = await env.DB.prepare(
      "SELECT COUNT(*) as open_disputes FROM returns WHERE status = 'REQUESTED'"
    ).first();

    return new Response(JSON.stringify({
      success: true,
      brand: 'OLMOA Central Control Tower',
      data: {
        total_gmv_krw: orderStats?.total_gmv || 0,
        total_orders: orderStats?.total_orders || 0,
        cross_border_pccc_orders: pcccOrders?.cnt || 0,
        escrow_protected_balance_krw: escrowStats?.escrow_balance || 0,
        pending_settlement_count: escrowStats?.pending_count || 0,
        open_disputes_count: disputeStats?.open_disputes || 0,
        customs_bottleneck_alerts: 0,
        // No traffic analytics source is connected, so no regional split is reported.
        regional_nodes: [],
        edge_regions: [],
        // Only what this request actually observed. The database answered the queries above.
        system_health: {
          d1_database: 'HEALTHY',
          customs_unipass_api: env.UNIPASS_API_KEY ? 'KEY_CONFIGURED' : 'NOT_CONFIGURED',
          global_fx_synchronizer: 'STATIC_RATE_TABLE',
          fds_engine: 'ENFORCED_AT_CHECKOUT'
        },
        timestamp: new Date().toISOString()
      }
    }), { headers: corsHeaders });
  }

  // 2. Fraud Detection System (FDS) Overview (/api/v1/admin/fds/overview)
  if (url.pathname === '/api/v1/admin/fds/overview' && request.method === 'GET') {
    // Wave E: every number below is measured — blocks from the audit trail, reviews from the orders table.
    const blocked = await env.DB.prepare("SELECT COUNT(*) c FROM admin_audit_log WHERE action = 'FDS_BLOCK' AND created_at > datetime('now', '-24 hours')").first('c') || 0;
    const reviews24 = await env.DB.prepare("SELECT COUNT(*) c FROM orders WHERE fds_decided_at > datetime('now', '-24 hours') AND fds_decision IN ('REVIEW','CLEARED','FRAUD')").first('c') || 0;
    const openReviews = await env.DB.prepare("SELECT COUNT(*) c FROM orders WHERE fds_decision = 'REVIEW'").first('c') || 0;
    const rules = [];
    for (const r of FDS_ACTIVE_RULES) {
      const like = `%"${r.code}"%`;
      const viaOrders = await env.DB.prepare("SELECT COUNT(*) c FROM orders WHERE fds_decided_at > datetime('now', '-24 hours') AND fds_rules_json LIKE ?").bind(like).first('c') || 0;
      const viaBlocks = await env.DB.prepare("SELECT COUNT(*) c FROM admin_audit_log WHERE action = 'FDS_BLOCK' AND created_at > datetime('now', '-24 hours') AND after_json LIKE ?").bind(like).first('c') || 0;
      rules.push({ ...r, hit_count_24h: viaOrders + viaBlocks });
    }
    return new Response(JSON.stringify({
      success: true,
      brand: 'OLMOA FDS Security Engine',
      data: { status: 'ENFORCED_AT_CHECKOUT', blocked_attempts_24h: blocked, reviews_24h: reviews24, open_reviews: openReviews, active_rules: rules }
    }), { headers: corsHeaders });
  }

  // 3. FDS manual probe (/api/v1/admin/fds/evaluate). An estimate from supplied
  // signals — checkout itself evaluates with live DB signals (services/fds.js).
  if (url.pathname === '/api/v1/admin/fds/evaluate' && request.method === 'POST') {
    const body = await readJson(request);
    const amountKrw = Number(body.amount_krw || 0);
    const ipCountry = String(body.ip_country || 'KR').toUpperCase();
    const shippingCountry = String(body.shipping_country || 'KR').toUpperCase();
    const failedAttempts = Number(body.failed_attempts_10m || 0);
    const blockAt = Number(env.FDS_BLOCK_SCORE) > 0 ? Number(env.FDS_BLOCK_SCORE) : 85;
    const reviewAt = Number(env.FDS_REVIEW_SCORE) > 0 ? Number(env.FDS_REVIEW_SCORE) : 40;
    const highValue = Number(env.FDS_HIGH_VALUE_KRW) > 0 ? Number(env.FDS_HIGH_VALUE_KRW) : 1500000;

    let riskScore = 10;
    const triggeredRules = [];

    if (failedAttempts >= 3) {
      riskScore += 75;
      triggeredRules.push('VELOCITY_CARD_TEST');
    }
    if (ipCountry !== shippingCountry) {
      riskScore += 45;
      triggeredRules.push('GEO_IP_MISMATCH');
    }
    if (amountKrw >= highValue) {
      riskScore += 35;
      triggeredRules.push('HIGH_VALUE_ESCROW_HOLD');
    }

    riskScore = Math.min(100, riskScore);
    const decision = riskScore >= blockAt ? 'BLOCK' : riskScore >= reviewAt ? 'REVIEW' : 'ALLOW';

    return new Response(JSON.stringify({
      success: true,
      brand: 'OLMOA FDS',
      data: {
        risk_score: riskScore,
        decision,
        triggered_rules: triggeredRules,
        evaluated_at: new Date().toISOString()
      }
    }), { headers: corsHeaders });
  }

  // 3b. FDS review queue: orders held for human eyes.
  if (url.pathname === '/api/v1/admin/fds/reviews' && request.method === 'GET') {
    const { results } = await env.DB.prepare(
      `SELECT o.id, o.order_no, o.customer_id, u.email AS buyer_email, o.total_pay_amount, o.payment_status,
              o.fds_score, o.fds_decision, o.fds_rules_json, o.fds_decided_at, o.created_at
       FROM orders o LEFT JOIN users u ON u.id = o.customer_id
       WHERE o.fds_decision = 'REVIEW' ORDER BY o.fds_decided_at DESC LIMIT 200`
    ).all();
    await logPiiView(env, govAdmin, 'admin.fds-reviews', 'order', results.map((r) => r.id), 'buyer_email', request);
    return json(corsHeaders, { success: true, count: results.length,
      data: results.map((r) => ({ ...r, triggered_rules: JSON.parse(r.fds_rules_json || '[]') })) });
  }

  // 3c. FDS review resolution: CLEAR releases held settlements (paid orders);
  // MARK_FRAUD keeps the money held and leaves the account to the fraud process.
  const fdsClearM = url.pathname.match(/^\/api\/v1\/admin\/fds\/reviews\/([^/]+)\/(clear|fraud)$/);
  if (fdsClearM && request.method === 'POST') {
    const body = await readJson(request);
    const note = str(body.note, { field: '심사 메모', max: 500, required: true });
    const order = await env.DB.prepare('SELECT * FROM orders WHERE id = ? OR order_no = ?').bind(fdsClearM[1], fdsClearM[1]).first();
    if (!order) throw notFound('주문을 찾을 수 없습니다.');
    if (order.fds_decision !== 'REVIEW') throw conflict('NOT_IN_REVIEW', `심사 대기 상태에서만 처리할 수 있습니다. (현재: ${order.fds_decision || '없음'})`);
    const clearing = fdsClearM[2] === 'clear';
    const next = clearing ? 'CLEARED' : 'FRAUD';
    const st = [
      env.DB.prepare('UPDATE orders SET fds_decision = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND fds_decision = ?').bind(next, order.id, 'REVIEW'),
      auditStatement(env, govAdmin, { action: clearing ? 'FDS_REVIEW_CLEAR' : 'FDS_REVIEW_FRAUD', targetType: 'order', targetId: order.id,
        before: { fds_decision: 'REVIEW', fds_score: order.fds_score }, after: { fds_decision: next, note }, request })
    ];
    if (clearing && order.payment_status === 'PAID') {
      st.push(env.DB.prepare("UPDATE settlements SET status = 'PENDING', updated_at = CURRENT_TIMESTAMP WHERE status = 'HOLD' AND sub_order_id IN (SELECT id FROM sub_orders WHERE parent_order_id = ?)").bind(order.id));
    }
    const r = await env.DB.batch(st);
    if (r[0].meta.changes !== 1) throw conflict('NOT_IN_REVIEW', '다른 운영자가 먼저 처리했습니다.');
    return json(corsHeaders, { success: true, order_id: order.id, fds_decision: next,
      ...(clearing && order.payment_status !== 'PAID' ? { note: '미결제 주문이라 보류 정산이 없습니다. 결제 시 정상 흐름으로 진행됩니다.' } : {}),
      ...(!clearing ? { next_action: '정산은 HOLD로 유지됩니다. 계정 정지·환불은 기존 관리자 절차로 진행하세요.' } : {}) });
  }

  // 3d. Prohibited HS blocklist (RULE_05 input).
  if (url.pathname === '/api/v1/admin/fds/prohibited-hs' && request.method === 'GET') {
    const { results } = await env.DB.prepare('SELECT code, reason, created_at FROM prohibited_hs_codes ORDER BY code').all();
    return json(corsHeaders, { success: true, count: results.length, data: results });
  }
  if (url.pathname === '/api/v1/admin/fds/prohibited-hs' && request.method === 'POST') {
    const body = await readJson(request);
    const code = str(body.code, { field: 'HS 부호', max: 20, required: true }).replace(/[^0-9.]/g, '');
    if (code.replace(/\D/g, '').length < 2) throw bad('INVALID_HS_CODE', 'HS 부호는 숫자 2자리 이상이어야 합니다.');
    const reason = str(body.reason, { field: '사유', max: 300, required: true });
    try {
      await env.DB.batch([
        env.DB.prepare('INSERT INTO prohibited_hs_codes (code, reason) VALUES (?, ?)').bind(code, reason),
        auditStatement(env, govAdmin, { action: 'FDS_HS_BLOCK_ADD', targetType: 'hs_code', targetId: code, after: { reason }, request })
      ]);
    } catch (e) {
      if (String(e.message).includes('UNIQUE')) throw conflict('ALREADY_BLOCKED', '이미 차단된 HS 부호입니다.');
      throw e;
    }
    return json(corsHeaders, { success: true, code, reason }, 201);
  }
  const hsDelM = url.pathname.match(/^\/api\/v1\/admin\/fds\/prohibited-hs\/([^/]+)$/);
  if (hsDelM && request.method === 'DELETE') {
    const code = decodeURIComponent(hsDelM[1]);
    const r = await env.DB.batch([
      env.DB.prepare('DELETE FROM prohibited_hs_codes WHERE code = ?').bind(code),
      auditStatement(env, govAdmin, { action: 'FDS_HS_BLOCK_REMOVE', targetType: 'hs_code', targetId: code, request })
    ]);
    if (r[0].meta.changes !== 1) throw notFound('차단 목록에 없는 HS 부호입니다.');
    return json(corsHeaders, { success: true, code });
  }

  // 4. 3-Party Dispute Arbitration List (/api/v1/admin/disputes)
  if (url.pathname === '/api/v1/admin/disputes' && request.method === 'GET') {
    const { results: claims } = await env.DB.prepare(
      `SELECT r.*, o.order_no, o.recipient_name, o.total_pay_amount, o.pccc
       FROM returns r
       LEFT JOIN orders o ON r.order_id = o.id
       ORDER BY r.created_at DESC LIMIT 50`
    ).all();
    await logPiiView(env, govAdmin, 'admin.disputes', 'claim', claims.map((c) => c.id), 'recipient_name,pccc', request);

    // SEC-10: open the sealed PCCC before masking (legacy plaintext passes through).
    const masked = [];
    for (const c of claims) masked.push({ ...c, pccc: maskLast4(await maybeOpenPii(env, c.pccc)) });
    return new Response(JSON.stringify({
      success: true,
      brand: 'OLMOA Dispute Tribunal',
      count: claims.length,
      data: masked
    }), { headers: corsHeaders });
  }

  // 5. Arbitration rulings move money, so they go through the claim/refund engine (PUT /api/v1/admin/claims/:id).
  if (url.pathname.startsWith('/api/v1/admin/disputes/') && url.pathname.endsWith('/arbitrate') && request.method === 'POST') {
    return json(corsHeaders, { success: false, code: 'USE_CLAIM_ENGINE', error: '분쟁 판정은 PUT /api/v1/admin/claims/:id (decision=APPROVE|REJECT) 로 처리합니다. 승인 시 실제 환불이 실행됩니다.' }, 410);
  }

  return null;
}
