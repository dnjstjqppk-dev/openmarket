// Work order 2-2: fee engine (seller > category > default, PG policy,
// 60% safeguard, 7-day notice, no-retro batch verify).
import assert from 'node:assert/strict'
import { createRunner, createGateway } from './lib/harness.mjs'

const t = createRunner('Fee engine')
const boot = () => createGateway({ seedFiles: ['migrations/dev/seed_local_dev.sql'] })

async function seedSchedule(db, table, row) {
  const cols = Object.keys(row)
  db.prepare(`INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`).run(...cols.map((c) => row[c]))
}

await t.test('F01 seller schedule beats category beats row default', async () => {
  const g = await boot()
  const { resolveSellerBps } = await import('../apps/cloudflare-gateway/src/services/fees.js')
  const cat = g.db.prepare('SELECT id FROM categories LIMIT 1').get()
  assert.ok(cat, 'seed carries a category')
  const at = '2026-06-01 12:00:00'
  await seedSchedule(g.db, 'fee_schedules', { id: 'fs_f01', name: 't', category_id: cat.id, rate_bp: 500, valid_from: '2026-01-01 00:00:00', is_active: 1 })
  await seedSchedule(g.db, 'partner_fees', { id: 'pf_f01', partner_id: 'pt_001', rate_bp: 800, valid_from: '2026-01-01 00:00:00', is_active: 1 })
  assert.equal(await resolveSellerBps(g.env, { partnerId: 'pt_001', categoryId: cat.id, rowBps: 1000, at }), 800)
  g.db.prepare("DELETE FROM partner_fees WHERE id = 'pf_f01'").run()
  assert.equal(await resolveSellerBps(g.env, { partnerId: 'pt_001', categoryId: cat.id, rowBps: 1000, at }), 500)
  g.db.prepare("DELETE FROM fee_schedules WHERE id = 'fs_f01'").run()
  assert.equal(await resolveSellerBps(g.env, { partnerId: 'pt_001', categoryId: cat.id, rowBps: 1000, at }), 1000)
})

await t.test('F02 uniform lines equal the legacy one-shot formula', async () => {
  const g = await boot()
  const { feeForSub } = await import('../apps/cloudflare-gateway/src/services/fees.js')
  const lines = [
    { goods: 10000, categoryId: null },
    { goods: 20000, categoryId: null }
  ]
  const r = await feeForSub(g.env, { partnerId: 'pt_001', lines, rowBps: 1000, at: '2026-06-01 12:00:00' })
  assert.equal(r.commission, 3000)
  assert.equal(r.uniform, true)
})

await t.test('F03 PG fee resolves by method and stays operator-absorbed', async () => {
  const g = await boot()
  const { pgFeeFor } = await import('../apps/cloudflare-gateway/src/services/fees.js')
  await seedSchedule(g.db, 'pg_fee_policies', { id: 'pg_f03', method: 'CARD', rate_bp: 320, fixed_fee: 0, pass_to_seller: 0, is_active: 1 })
  const pg = await pgFeeFor(g.env, { method: 'CARD', amount: 100000 })
  assert.equal(pg.fee, 3200)
  assert.equal(pg.passed, 0)
  const missing = await pgFeeFor(g.env, { method: 'NOPE', amount: 100000 })
  assert.equal(missing.fee, 0)
})

await t.test('F04 safeguard caps deductions at 60 percent of goods', async () => {
  const g = await boot()
  const { feeForSub } = await import('../apps/cloudflare-gateway/src/services/fees.js')
  await seedSchedule(g.db, 'partner_fees', { id: 'pf_f04', partner_id: 'pt_001', rate_bp: 8000, valid_from: '2026-01-01 00:00:00', is_active: 1 })
  const r = await feeForSub(g.env, {
    partnerId: 'pt_001', lines: [{ goods: 100000, categoryId: null }], rowBps: 1000, at: '2026-06-01 12:00:00'
  })
  assert.equal(r.commission, 60000)
  assert.equal(r.capped, true)
})

await t.test('F05 seller fee changes need 7 days notice, no retro', async () => {
  const g = await boot()
  const { schedulePartnerFee, resolveSellerBps } = await import('../apps/cloudflare-gateway/src/services/fees.js')
  try {
    await schedulePartnerFee(g.env, { partnerId: 'pt_001', rateBp: 1200, validFrom: '2026-06-03 12:00:00', now: '2026-06-01 12:00:00' })
    assert.fail('short notice must reject')
  } catch (e) {
    assert.equal(e.code, 'NOTICE_TOO_SHORT')
  }
  await schedulePartnerFee(g.env, { partnerId: 'pt_001', rateBp: 1200, validFrom: '2026-06-09 12:00:00', now: '2026-06-01 12:00:00' })
  assert.equal(await resolveSellerBps(g.env, { partnerId: 'pt_001', categoryId: null, rowBps: 1000, at: '2026-06-01 12:00:00' }), 1000)
  assert.equal(await resolveSellerBps(g.env, { partnerId: 'pt_001', categoryId: null, rowBps: 1000, at: '2026-06-10 12:00:00' }), 1200)
})

await t.test('F06 batch verifies in chunks and alarms on failures only', async () => {
  const g = await boot()
  const { recalcBatch } = await import('../apps/cloudflare-gateway/src/services/fees.js')
  const sku = g.db.prepare('SELECT s.id AS sku, s.product_id AS pid FROM product_skus s LIMIT 1').get()
  assert.ok(sku, 'seed carries a sku')
  const prow = g.db.prepare('SELECT commission_rate_bps, commission_rate FROM partners WHERE id = ?').get('pt_002')
  const rowBps = prow.commission_rate_bps ?? Math.round(Number(prow.commission_rate || 10) * 100)
  const mk = (n) => {
    const oid = `ord_f06_${n}`, sid = `sub_f06_${n}`
    const comm = Math.floor((10000 * rowBps + 5000) / 10000)
    g.db.prepare("INSERT INTO orders (id, order_no, customer_id, total_goods_amount, total_shipping_amount, total_discount_amount, total_pay_amount, payment_status, recipient_name, recipient_phone, shipping_address_line1, shipping_address_line2, shipping_postal_code, created_at) VALUES (?, ?, 'u_customer_001', 10000, 0, 0, 10000, 'PAID', 'n', '010', 'a', '', '06236', '2026-06-01 12:00:00')").run(oid, `F06-${n}`)
    g.db.prepare('INSERT INTO sub_orders (id, parent_order_id, sub_order_no, partner_id, shipping_fee, goods_amount, discount_amount, total_amount, status) VALUES (?, ?, ?, ?, 0, 10000, 0, 10000, ?)').run(sid, oid, `F06S-${n}`, 'pt_002', 'DELIVERED')
    g.db.prepare('INSERT INTO order_items (id, sub_order_id, sku_id, product_title, option_summary, unit_price, quantity, total_price) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(`oi_f06_${n}`, sid, sku.sku, 't', 'o', 10000, 1, 10000)
    g.db.prepare('INSERT INTO settlements (id, sub_order_id, partner_id, gross_amount, shipping_fee, commission_rate, commission_amount, net_payout_amount, status) VALUES (?, ?, ?, 10000, 0, ?, ?, ?, ?)').run(`stl_f06_${n}`, sid, 'pt_002', rowBps / 100, comm, 10000 - comm, 'ELIGIBLE_FOR_PAYOUT')
    return oid
  }
  const ids = [mk(1), mk(2), mk(3)]
  const alarms = []
  const r = await recalcBatch(g.env, { orderIds: [...ids, 'ord_missing_nope'], batchSize: 2, onAlarm: (a) => alarms.push(a) })
  assert.equal(r.processed, 3)
  assert.equal(r.matched, 3)
  assert.equal(r.failed.length, 1)
  assert.equal(alarms.length, 1)
  assert.equal(r.chunks, 2)
})

t.finish()
