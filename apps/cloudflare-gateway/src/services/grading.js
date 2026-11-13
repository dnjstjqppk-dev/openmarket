// apps/cloudflare-gateway/src/services/grading.js
// Work order 2-7: monthly seller grading. All metrics key on the sub-order
// creation month; paid sales only. Grade assignment is an idempotent upsert.

import { sqlNow } from '../lib/ids.js';

export function monthBounds(yearMonth) {
  if (!/^\d{4}-\d{2}$/.test(yearMonth)) throw new Error(`INVALID_YEAR_MONTH: ${yearMonth}`);
  const [y, m] = yearMonth.split('-').map(Number);
  const start = `${yearMonth}-01 00:00:00`;
  const next = m === 12 ? `${y + 1}-01-01 00:00:00` : `${y}-${String(m + 1).padStart(2, '0')}-01 00:00:00`;
  return { start, end: next };
}

async function sellerMetrics(env, partnerId, yearMonth) {
  const { start, end } = monthBounds(yearMonth);
  const sales = await env.DB.prepare(
    `SELECT COALESCE(SUM(s.goods_amount), 0) AS sales, COUNT(*) AS subs
     FROM sub_orders s JOIN orders o ON o.id = s.parent_order_id
     WHERE s.partner_id = ? AND s.created_at >= ? AND s.created_at < ? AND o.payment_status = 'PAID'`
  ).bind(partnerId, start, end).first();
  const claims = await env.DB.prepare(
    `SELECT COUNT(DISTINCT r.id) AS n FROM returns r
     WHERE r.created_at >= ? AND r.created_at < ?
       AND EXISTS (SELECT 1 FROM sub_orders s WHERE s.parent_order_id = r.order_id AND s.partner_id = ?)`
  ).bind(start, end, partnerId).first('n');
  const ship = await env.DB.prepare(
    `SELECT COUNT(*) AS total,
            COALESCE(SUM(CASE WHEN s.shipped_at <= s.ship_by_deadline THEN 1 ELSE 0 END), 0) AS ontime
     FROM sub_orders s
     WHERE s.partner_id = ? AND s.created_at >= ? AND s.created_at < ?
       AND s.shipped_at IS NOT NULL AND s.ship_by_deadline IS NOT NULL`
  ).bind(partnerId, start, end).first();
  const points = await env.DB.prepare(
    `SELECT COALESCE(SUM(points), 0) AS p FROM partner_penalties
     WHERE partner_id = ? AND created_at >= ? AND created_at < ?`
  ).bind(partnerId, start, end).first('p');
  return {
    sales: sales.sales,
    sub_count: sales.subs,
    claim_rate: sales.subs > 0 ? claims / sales.subs : 0,
    ship_on_time_rate: ship.total > 0 ? ship.ontime / ship.total : null,
    penalty_points: points
  };
}

function passes(policy, m) {
  if (policy.min_sales != null && m.sales < policy.min_sales) return false;
  if (policy.max_claim_rate != null && m.claim_rate > policy.max_claim_rate) return false;
  if (policy.min_ship_on_time_rate != null) {
    if (m.ship_on_time_rate == null) return false;
    if (m.ship_on_time_rate < policy.min_ship_on_time_rate) return false;
  }
  if (policy.max_penalty_points != null && m.penalty_points > policy.max_penalty_points) return false;
  return true;
}

/** Grade every approved seller for a month; reruns overwrite the same rows. Returns the row count. */
export async function computeMonthlyGrades(env, yearMonth) {
  const { results: policies } = await env.DB.prepare(
    'SELECT * FROM grade_policies WHERE is_enabled = 1 ORDER BY sort_order DESC'
  ).all();
  const { results: sellers } = await env.DB.prepare(
    "SELECT id FROM partners WHERE status = 'APPROVED'"
  ).all();
  let n = 0;
  for (const s of sellers) {
    const m = await sellerMetrics(env, s.id, yearMonth);
    const grade = policies.find((p) => passes(p, m)) || null;
    await env.DB.prepare(
      `INSERT INTO partner_grades (partner_id, month, grade_code, metrics_json, computed_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (partner_id, month) DO UPDATE SET grade_code = excluded.grade_code,
         metrics_json = excluded.metrics_json, computed_at = excluded.computed_at`
    ).bind(s.id, yearMonth, grade ? grade.grade_code : null, JSON.stringify(m), sqlNow()).run();
    n++;
  }
  return n;
}
