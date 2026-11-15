// Live contract for GET /api/v1/partner/metrics dashboard series (P0-10):
// weekly GMV buckets, week-over-week change, and fulfillment quality gauges
// must come from real sub_orders rows — never hardcoded.
import assert from 'node:assert/strict'
import { createGateway, createRunner } from './lib/harness.mjs'

const t = createRunner('Partner metrics dashboard')
const env = {
  JWT_SECRET: 'e2e-secret-0123456789abcdefghijklmnopqrstu',
  ENVIRONMENT: 'development',
  CONNECTOR_SIMULATION: 'true',
  PAYMENT_MODE: 'sandbox'
}

await t.test('M01 metrics carries weekly GMV and fulfillment gauges', async () => {
  const g = await createGateway({ seedFiles: ['migrations/dev/seed_local_dev.sql'], env })
  const login = await g.call('/api/v1/auth/login', {
    method: 'POST', body: { email: 'seller@temu-supply.com', password: 'DevPass!2026#', role: 'PARTNER' }
  })
  assert.equal(login.status, 200)
  const r = await g.call('/api/v1/partner/metrics', { method: 'GET', token: login.json.token })
  assert.equal(r.status, 200)
  const m = r.json
  assert.ok(Array.isArray(m.weekly_gmv) && m.weekly_gmv.length === 7, 'seven daily buckets')
  assert.ok(m.weekly_gmv.every((b) => /^\d{4}-\d{2}-\d{2}$/.test(b.day) && Number.isInteger(b.amount)), 'buckets are {day, amount}')
  assert.ok(m.wow_pct === null || typeof m.wow_pct === 'number', 'wow_pct is null or a number')
  assert.ok(Array.isArray(m.monthly_gmv) && m.monthly_gmv.length === 30, 'thirty daily buckets')
  assert.ok(m.monthly_gmv.every((b) => /^\d{4}-\d{2}-\d{2}$/.test(b.day) && Number.isInteger(b.amount)), 'monthly buckets are {day, amount}')
  assert.ok(m.mom_pct === null || typeof m.mom_pct === 'number', 'mom_pct is null or a number')
  for (const k of ['ship_on_time_rate', 'avg_delivery_days', 'claim_rate_pct']) {
    assert.ok(m[k] === null || typeof m[k] === 'number', `${k} is null or a number`)
  }
})

function insertRow(g, table, overrides) {
  const cols = g.db.prepare(`PRAGMA table_info(${table})`).all()
  const names = []
  const vals = []
  for (const c of cols) {
    if (c.pk === 1 && overrides[c.name] === undefined) continue
    if (overrides[c.name] !== undefined) {
      names.push(c.name)
      vals.push(overrides[c.name])
    } else if (c.notnull === 1 && c.dflt_value === null) {
      names.push(c.name)
      vals.push(/^INT/i.test(c.type) ? 0 : 't')
    }
  }
  g.db.prepare(`INSERT INTO ${table} (${names.join(',')}) VALUES (${names.map(() => '?').join(',')})`).run(...vals)
}

await t.test('M02 gauges reflect fixture rows, not constants', async () => {
  const g = await createGateway({ seedFiles: ['migrations/dev/seed_local_dev.sql'], env })
  const pid = g.db.prepare("SELECT id FROM partners WHERE id = 'pt_001'").get()?.id || 'pt_001'
  const uid = g.db.prepare("SELECT id FROM users WHERE role = 'ROLE_CUSTOMER' LIMIT 1").get().id
  insertRow(g, 'orders', { id: 'o_m', order_no: 'M-1', customer_id: uid })
  insertRow(g, 'sub_orders', {
    id: 'so_m1', parent_order_id: 'o_m', sub_order_no: 'M-1-1', partner_id: pid, status: 'DELIVERED',
    goods_amount: 10000, shipping_fee: 0, total_amount: 10000
  })
  insertRow(g, 'sub_orders', {
    id: 'so_m2', parent_order_id: 'o_m', sub_order_no: 'M-1-2', partner_id: pid, status: 'SHIPPED',
    goods_amount: 20000, shipping_fee: 0, total_amount: 20000
  })
  g.db.prepare("UPDATE sub_orders SET created_at = datetime('now','-1 day'), shipped_at = datetime('now','-20 hours'), delivered_at = datetime('now','-1 hour') WHERE id = 'so_m1'").run()
  g.db.prepare("UPDATE sub_orders SET created_at = datetime('now','-2 days'), shipped_at = datetime('now','-20 hours') WHERE id = 'so_m2'").run()
  const login = await g.call('/api/v1/auth/login', {
    method: 'POST', body: { email: 'seller@temu-supply.com', password: 'DevPass!2026#', role: 'PARTNER' }
  })
  const r = await g.call('/api/v1/partner/metrics', { method: 'GET', token: login.json.token })
  const m = r.json
  const total = m.weekly_gmv.reduce((a, b) => a + b.amount, 0)
  assert.ok(total >= 30000, `weekly buckets include fixture GMV (got ${total})`)
  assert.equal(m.ship_on_time_rate, 50, 'one of two shipments left within 24h')
  assert.ok(m.avg_delivery_days !== null && m.avg_delivery_days > 0, 'delivery days measured')
})

t.finish()
