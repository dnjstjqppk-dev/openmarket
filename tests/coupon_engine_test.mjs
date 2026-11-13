// Work order 2-3: coupon engine (store/platform split, single-coupon rule,
// uniform invalid errors, race-safe redemption, refund rollback).
import assert from 'node:assert/strict'
import { createRunner, createGateway } from './lib/harness.mjs'

const t = createRunner('Coupon engine')
const PW = 'DevPass!2026#'
const ADDR = { recipient_name: '김올모', recipient_phone: '010-2222-3333', shipping_address_line1: '서울특별시 중구 세종대로 110', shipping_postal_code: '04524' }
const ENV = {
  JWT_SECRET: 'e2e-secret-0123456789abcdefghijklmnopqrstu',
  ENVIRONMENT: 'development',
  CONNECTOR_SIMULATION: 'true',
  PAYMENT_MODE: 'sandbox'
}
const boot = () => createGateway({ seedFiles: ['migrations/dev/seed_local_dev.sql'], env: ENV })
const loginAs = async (g, email, password = PW, role = 'CUSTOMER') => {
  const r = await g.call('/api/v1/auth/login', { method: 'POST', body: { email, password, role } })
  assert.equal(r.status, 200, `login ${email}: ${r.text}`)
  return r.json.token
}
const skuOf = (g, partner) => g.db.prepare(
  'SELECT s.id, s.product_id FROM product_skus s JOIN products p ON p.id = s.product_id WHERE p.partner_id = ? AND s.stock_quantity > 50 ORDER BY s.id LIMIT 1'
).get(partner)
async function mkDef(g, row) {
  const base = { id: `cd_h_${Math.random().toString(36).slice(2, 9)}`, owner_type: 'PLATFORM', partner_id: null, code: null, title: 't', discount_type: 'FIXED_AMOUNT', discount_value: 1000, min_order_amount: 0, per_user_limit: 1, total_limit: null, is_active: 1 }
  const r = { ...base, ...row }
  const cols = Object.keys(r)
  g.db.prepare(`INSERT INTO coupon_definitions (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`).run(...cols.map((c) => r[c]))
  return r.id
}

await t.test('H01 store coupon discounts only its seller lines', async () => {
  const g = await boot()
  const { validateCoupon } = await import('../apps/cloudflare-gateway/src/services/coupons.js')
  const defId = await mkDef(g, { owner_type: 'SELLER', partner_id: 'pt_002', discount_value: 3000 })
  const { issueCoupon } = await import('../apps/cloudflare-gateway/src/services/coupons.js')
  const issued = await issueCoupon(g.env, { definitionId: defId, userId: 'u_customer_001' })
  const lines = [
    { goods: 10000, partnerId: 'pt_002' },
    { goods: 10000, partnerId: 'pt_001' }
  ]
  const v = await validateCoupon(g.env, { ref: issued.id, userId: 'u_customer_001', lines })
  assert.equal(v.discount, 3000)
  assert.deepEqual(v.allocations, [3000, 0])
  assert.equal(v.ownerType, 'SELLER')
})

await t.test('H02 platform coupon spans all lines, operator-funded', async () => {
  const g = await boot()
  const { validateCoupon, issueCoupon } = await import('../apps/cloudflare-gateway/src/services/coupons.js')
  const defId = await mkDef(g, { owner_type: 'PLATFORM', discount_value: 2000 })
  const issued = await issueCoupon(g.env, { definitionId: defId, userId: 'u_customer_001' })
  const v = await validateCoupon(g.env, {
    ref: issued.id, userId: 'u_customer_001',
    lines: [{ goods: 10000, partnerId: 'pt_002' }, { goods: 10000, partnerId: 'pt_001' }]
  })
  assert.equal(v.discount, 2000)
  assert.equal(v.sellerAbsorbed, 0)
  assert.equal(v.ownerType, 'PLATFORM')
})

await t.test('H03 one coupon per order; mixed refs rejected', async () => {
  const g = await boot()
  const tok = await loginAs(g, 'customer@example.com')
  const sku = skuOf(g, 'pt_002')
  const q = await g.call('/api/v1/orders/quote', {
    method: 'POST', token: tok,
    body: { ...ADDR, items: [{ sku_id: sku.id, quantity: 1 }], user_coupon_id: 'x', coupon_code: 'y' }
  })
  assert.equal(q.status, 409, q.text)
  assert.equal(q.json.code, 'COUPON_ONLY_ONE')
})

await t.test('H04 invalid coupons share one error code', async () => {
  const g = await boot()
  const { validateCoupon, issueCoupon } = await import('../apps/cloudflare-gateway/src/services/coupons.js')
  const lines = [{ goods: 10000, partnerId: 'pt_002' }]
  const codes = []
  for (const ref of ['nope-missing', 'x'.repeat(40)]) {
    try {
      await validateCoupon(g.env, { ref, userId: 'u_customer_001', lines })
      assert.fail('must reject')
    } catch (e) { codes.push(e.code) }
  }
  const defId = await mkDef(g, { code: 'H04CODE', per_user_limit: 1 })
  const issued = await issueCoupon(g.env, { definitionId: defId, userId: 'u_customer_001' })
  g.db.prepare("UPDATE coupon_issued SET status = 'USED' WHERE id = ?").run(issued.id)
  try {
    await validateCoupon(g.env, { ref: issued.id, userId: 'u_customer_001', lines })
    assert.fail('must reject')
  } catch (e) { codes.push(e.code) }
  assert.deepEqual(codes, ['COUPON_NOT_AVAILABLE', 'COUPON_NOT_AVAILABLE', 'COUPON_NOT_AVAILABLE'])
})

const mkOrder = (g, oid) => g.db.prepare(
  "INSERT INTO orders (id, order_no, customer_id, total_goods_amount, total_shipping_amount, total_discount_amount, total_pay_amount, payment_status, recipient_name, recipient_phone, shipping_address_line1, shipping_address_line2, shipping_postal_code) VALUES (?, ?, 'u_customer_001', 10000, 0, 0, 10000, 'PAID', 'n', '010', 'a', '', '06236')"
).run(oid, oid)

await t.test('H05 double redeem loses; total limit holds', async () => {
  const g = await boot()
  const { redeemCoupon, issueCoupon } = await import('../apps/cloudflare-gateway/src/services/coupons.js')
  mkOrder(g, 'ord_h05_a')
  mkOrder(g, 'ord_h05_b')
  const defId = await mkDef(g, { per_user_limit: 5, total_limit: 1 })
  const issued = await issueCoupon(g.env, { definitionId: defId, userId: 'u_customer_001' })
  await redeemCoupon(g.env, { issuedId: issued.id, orderId: 'ord_h05_a', userId: 'u_customer_001', discount: 1000 })
  try {
    await redeemCoupon(g.env, { issuedId: issued.id, orderId: 'ord_h05_b', userId: 'u_customer_001', discount: 1000 })
    assert.fail('second redeem must lose')
  } catch (e) { assert.equal(e.code, 'COUPON_NOT_AVAILABLE') }
  try {
    await issueCoupon(g.env, { definitionId: defId, userId: 'cust_demo_001' })
    assert.fail('over-limit issue must fail')
  } catch (e) { assert.equal(e.code, 'COUPON_SOLD_OUT') }
})

await t.test('H06 refund releases the coupon for reuse', async () => {
  const g = await boot()
  const { redeemCoupon, releaseCoupon, issueCoupon } = await import('../apps/cloudflare-gateway/src/services/coupons.js')
  mkOrder(g, 'ord_h06')
  mkOrder(g, 'ord_h06b')
  const defId = await mkDef(g, { per_user_limit: 5 })
  const issued = await issueCoupon(g.env, { definitionId: defId, userId: 'u_customer_001' })
  await redeemCoupon(g.env, { issuedId: issued.id, orderId: 'ord_h06', userId: 'u_customer_001', discount: 1000 })
  await releaseCoupon(g.env, { orderId: 'ord_h06' })
  const row = g.db.prepare('SELECT status FROM coupon_issued WHERE id = ?').get(issued.id)
  assert.equal(row.status, 'ISSUED')
  assert.equal(g.db.prepare('SELECT COUNT(*) c FROM coupon_redemptions WHERE order_id = ?').get('ord_h06').c, 0)
  await redeemCoupon(g.env, { issuedId: issued.id, orderId: 'ord_h06b', userId: 'u_customer_001', discount: 1000 })
})

await t.test('H07 sellers manage only their own definitions', async () => {
  const g = await boot()
  const s1 = await loginAs(g, 'seller@temu-supply.com', PW, 'PARTNER')
  const s2 = await loginAs(g, 'partner2@olmoa-tech.com', PW, 'PARTNER')
  const c = await g.call('/api/v1/partner/coupons', {
    method: 'POST', token: s1,
    body: { title: 's1 deal', discount_type: 'FIXED_AMOUNT', discount_value: 1500, min_order_amount: 0 }
  })
  assert.equal(c.status, 201, c.text)
  assert.equal(c.json.data.owner_type, 'SELLER')
  assert.equal(c.json.data.partner_id, 'pt_001')
  const other = await g.call(`/api/v1/partner/coupons/${c.json.data.id}`, { method: 'PATCH', token: s2, body: { is_active: 0 } })
  assert.ok([403, 404].includes(other.status), `cross-seller write blocked, got ${other.status}`)
  const list = await g.call('/api/v1/partner/coupons', { token: s2 })
  assert.ok(!(list.json.data || []).some((d) => d.id === c.json.data.id), 'seller cannot see the other coupon')
})

await t.test('H08 claim serves both generations with one bogus error', async () => {
  const g = await boot()
  const tok = await loginAs(g, 'customer@example.com')
  const bogus = await g.call('/api/v1/coupons/claim', { method: 'POST', token: tok, body: { code: 'NOPE-NEW' } })
  assert.equal(bogus.status, 404)
  assert.equal(bogus.json.error, '유효하지 않은 쿠폰 코드입니다.')
  const defId = await mkDef(g, { code: 'H08NEW', per_user_limit: 1 })
  const first = await g.call('/api/v1/coupons/claim', { method: 'POST', token: tok, body: { code: 'H08NEW' } })
  assert.equal(first.status, 200, first.text)
  assert.equal(first.json.data.definition_id, defId)
  const legacy = await g.call('/api/v1/coupons/claim', { method: 'POST', token: tok, body: { code: 'VIP20' } })
  assert.equal(legacy.status, 200, legacy.text)
})

await t.test('H09 seller coupon reduces the seller payout at checkout', async () => {
  const g = await boot()
  const tok = await loginAs(g, 'customer@example.com')
  const sku = skuOf(g, 'pt_002')
  const defId = await mkDef(g, { owner_type: 'SELLER', partner_id: 'pt_002', discount_value: 3000, min_order_amount: 0 })
  const { issueCoupon } = await import('../apps/cloudflare-gateway/src/services/coupons.js')
  const cust = g.db.prepare('SELECT id FROM users WHERE email = ?').get('customer@example.com')
  const issued = await issueCoupon(g.env, { definitionId: defId, userId: cust.id })
  const c = await g.call('/api/v1/orders/checkout', {
    method: 'POST', token: tok, headers: { 'X-Idempotency-Key': 'h09-checkout-0001' },
    body: { ...ADDR, items: [{ sku_id: sku.id, quantity: 1 }], user_coupon_id: issued.id }
  })
  assert.equal(c.status, 201, c.text)
  const st = g.db.prepare('SELECT commission_amount, net_payout_amount, gross_amount FROM settlements WHERE sub_order_id = (SELECT id FROM sub_orders WHERE parent_order_id = ? LIMIT 1)').get(c.json.order_id)
  assert.equal(st.net_payout_amount, st.gross_amount - st.commission_amount + 0 - 3000 + Number(g.db.prepare('SELECT shipping_fee FROM sub_orders WHERE parent_order_id = ? LIMIT 1').get(c.json.order_id).shipping_fee))
})

t.finish()
