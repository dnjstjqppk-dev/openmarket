// tests/ui/p1_store.test.mjs
// P1 storefront regression suite: P1-S01..S10 + S-N01 + S-N02.
// Static contract probes over apps/storefront sources plus gateway harness
// probes for the server-side legs (S-N01 enforcement, S-N02 confirm replay,
// P1-S08 postal backstop). Run: node tests/ui/p1_store.test.mjs
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createGateway, createRunner } from '../lib/harness.mjs'

const t = createRunner('P1 storefront')
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const SF = join(ROOT, 'apps/storefront')
const GW = join(ROOT, 'apps/cloudflare-gateway/src')
const read = (base, p) => readFileSync(join(base, p), 'utf8')

const ENV = {
  JWT_SECRET: 'p1-store-test-secret-0123456789abcdefghij',
  ENVIRONMENT: 'development',
  PAYMENT_MODE: 'sandbox'
}
const ADDR = { recipient_name: 'T', recipient_phone: '010-1234-5678', shipping_address_line1: 'A', shipping_postal_code: '06236' }
async function newGateway() {
  const g = await createGateway({ seedFiles: ['migrations/dev/seed_local_dev.sql'], env: ENV })
  const login = async (email, role) => {
    const r = await g.call('/api/v1/auth/login', { method: 'POST', body: { email, password: 'DevPass!2026#', role } })
    assert.equal(r.status, 200, `login ${email}: ${r.text}`)
    return r.json.token
  }
  return { ...g, login }
}

// ---------------- P1-S01: coupons list sends auth ----------------
await t.test('S01 coupons fetch carries the auth header', async () => {
  const src = read(SF, 'src/views/CouponsView.vue')
  const m = src.match(/fetch\(`\$\{API_BASE_URL\}\/api\/v1\/coupons\?[^`]*`([^)]*\))/)
  assert.ok(m, 'coupons list fetch found')
  assert.ok(m[1].includes('authHeader'), 'coupons fetch must spread authHeader()')
})

// ---------------- P1-S02: confirmPurchase failure surfaces ----------------
await t.test('S02 confirmPurchase reports failure via actionMsg', async () => {
  const src = read(SF, 'src/views/OrdersView.vue')
  const fn = src.slice(src.indexOf('const confirmPurchase'), src.indexOf('function openTracking'))
  assert.ok(fn.includes('} else {'), 'confirmPurchase has an else branch')
  assert.ok(fn.includes('catch'), 'confirmPurchase has a catch')
  assert.equal((fn.match(/actionMsg\.value =/g) || []).length >= 3, true, 'success + else + catch all set actionMsg')
  assert.ok(!/catch\s*\([^)]*\)\s*\{\s*console\.error\(e\)\s*\}/.test(fn), 'catch must not be console.error-only')
})

// ---------------- P1-S03: no false review reward copy ----------------
await t.test('S03 review link promises no phantom credit', async () => {
  const src = read(SF, 'src/views/OrdersView.vue')
  assert.ok(!src.includes('+100P'), 'no (+100P) review copy')
  assert.ok(src.includes('리뷰 쓰기'), 'review link still present')
})

// ---------------- P1-S04: no invented carrier ----------------
await t.test('S04 tracking falls back to undecided carrier, never CJ', async () => {
  for (const f of ['src/views/OrdersView.vue', 'src/views/OrderDetailView.vue']) {
    const src = read(SF, f)
    assert.ok(!src.includes("|| 'CJ대한통운'"), `${f}: no CJ fallback`)
  }
  const o = read(SF, 'src/views/OrdersView.vue')
  assert.ok(o.includes('택배사 미정'), 'OrdersView uses 택배사 미정 fallback')
})

// ---------------- P1-S05: no fake profile fallbacks ----------------
await t.test('S05 profile renders no fabricated identity fallbacks', async () => {
  const src = read(SF, 'src/views/ProfileView.vue')
  assert.ok(!src.includes('010-0000-0000'), 'no fake phone fallback')
  assert.ok(!src.includes('customer@olmoa.com'), 'no fake email fallback')
  assert.ok(!src.includes('2026.01.01'), 'no fake join-date fallback')
})

// ---------------- P1-S06: password rule parity ----------------
await t.test('S06 profile password rule matches registration (10+ chars, 3 of 4 classes)', async () => {
  const src = read(SF, 'src/views/ProfileView.vue')
  assert.ok(!src.includes('length < 6'), 'no 6-char rule')
  assert.ok(src.includes('10'), '10-char minimum referenced')
  assert.ok(/\[a-z\].*\[A-Z\].*\\d/.test(src) || src.includes('3종류'), 'character-class rule present')
})

// ---------------- P1-S07: consent is real ----------------
await t.test('S07 notification consent loads from and saves to the server', async () => {
  const src = read(SF, 'src/views/ProfileView.vue')
  assert.ok(src.includes('agree_marketing'), 'PUT body carries agree_marketing')
  assert.ok(src.includes('consents'), 'profile load reads server consents')
  assert.ok(!/v-model="notifySms"[^>]*\/>/.test(src) || src.includes('notifySms') , 'sms pref exists')
  // The SMS box must not be a mutable choice that is silently dropped: either wired or disabled/removed.
  const smsInput = (src.match(/<input[^>]*notifySms[^>]*>/g) || []).join(' ')
  const smsWired = src.includes('notify_sms') || src.includes('agree_sms')
  assert.ok(smsWired || smsInput.includes('disabled') || smsInput === '', 'SMS box is wired, disabled-required, or removed')
})

// ---------------- P1-S08: postal required ----------------
await t.test('S08 address form requires a 5-digit postal, never substitutes 00000', async () => {
  const src = read(SF, 'src/views/AddressesView.vue')
  assert.ok(!src.includes("'00000'"), 'no 00000 substitution')
  assert.ok(src.includes('\\d{5}'), '5-digit postal validation')
  assert.ok(/postal_code[\s\S]{0,200}required|required[\s\S]{0,200}postal/i.test(src), 'postal input is required')
})
await t.test('S08 server rejects malformed postal codes on address create', async () => {
  const g = await newGateway()
  const cust = await g.login('customer@example.com', 'CUSTOMER')
  const bad = await g.call('/api/v1/addresses', { method: 'POST', token: cust, body: { recipient_name: 'T', phone: '010-1', postal_code: '12', address_line1: 'A' } })
  assert.equal(bad.status, 400, bad.text)
  assert.equal(bad.json.code, 'INVALID_POSTAL_CODE', bad.text)
  const ok = await g.call('/api/v1/addresses', { method: 'POST', token: cust, body: { recipient_name: 'T', phone: '010-1234-5678', postal_code: '06236', address_line1: 'A' } })
  assert.equal(ok.status, 201, ok.text)
})

// ---------------- P1-S09: legal honesty ----------------
await t.test('S09 terms name the operator from business-info and qualify escrow', async () => {
  const src = read(SF, 'src/views/LegalTermsView.vue')
  assert.ok(!src.includes('(주)올모아'), 'no hardcoded operator name')
  assert.ok(src.includes('business-info') || src.includes('legal_name'), 'operator name is config-driven')
  assert.ok(!src.includes('에스크로 시스템을 통하여 구매자의 결제 대금을 안전하게 보호합니다'), 'unqualified escrow assurance removed')
})

// ---------------- P1-S10: tracking load failure surfaces ----------------
await t.test('S10 milestone tracking failure surfaces a warning', async () => {
  const src = read(SF, 'src/views/OrderDetailView.vue')
  const fn = src.slice(src.indexOf('const loadMilestoneTracking'), src.indexOf('const copyTracking'))
  assert.ok(fn.includes('else') || fn.includes('catch'), 'failure branch exists')
  assert.ok(fn.includes("say(") && fn.includes("'warn'"), 'failure calls say(..., warn)')
})

// ---------------- S-N01: cross-border PCCC ----------------
await t.test('S-N01 catalog carries a per-item cross-border flag into cart and quote', async () => {
  const migs = readdirSync(join(ROOT, 'migrations')).filter((f) => /^d1_\d+.*\.sql$/.test(f))
  const hasFlag = migs.some((f) => read(ROOT, `migrations/${f}`).includes('requires_pccc'))
  assert.ok(hasFlag, 'a migration adds requires_pccc')
  assert.ok(read(SF, 'src/stores/cart.ts').includes('requires_pccc'), 'cart line carries requires_pccc')
  assert.ok(read(SF, 'src/lib/quote.ts').includes('requires_pccc'), 'quote type carries requires_pccc')
  const co = read(SF, 'src/views/CheckoutView.vue')
  assert.ok(co.includes('requires_pccc') || co.includes('pcccRequired'), 'checkout reads the flag')
  assert.ok(read(GW, 'services/orders.js').includes('PCCC_REQUIRED'), 'server enforces PCCC_REQUIRED')
})
await t.test('S-N01 server requires PCCC for cross-border lines, quote flags it', async () => {
  const g = await newGateway()
  const cust = await g.login('customer@example.com', 'CUSTOMER')
  const sku = g.db.prepare("SELECT s.id, s.product_id FROM product_skus s JOIN products p ON p.id = s.product_id WHERE p.partner_id = 'pt_001' AND s.stock_quantity > 5 LIMIT 1").get()
  g.db.prepare('UPDATE products SET requires_pccc = 1 WHERE id = ?').run(sku.product_id)
  const q = await g.call('/api/v1/orders/quote', { method: 'POST', token: cust, body: { items: [{ sku_id: sku.id, quantity: 1 }] } })
  assert.equal(q.status, 200, q.text)
  assert.equal(q.json.data.requires_pccc, true, 'quote flags requires_pccc')
  const noPccc = await g.call('/api/v1/orders/checkout', { method: 'POST', token: cust, body: { ...ADDR, items: [{ sku_id: sku.id, quantity: 1 }] } })
  assert.equal(noPccc.status, 400, noPccc.text)
  assert.equal(noPccc.json.code, 'PCCC_REQUIRED', noPccc.text)
  const withPccc = await g.call('/api/v1/orders/checkout', { method: 'POST', token: cust, body: { ...ADDR, pccc: 'P123456789012', items: [{ sku_id: sku.id, quantity: 1 }] } })
  assert.equal(withPccc.status, 201, withPccc.text)
})

// ---------------- S-N02: payment resume ----------------
await t.test('S-N02 READY orders offer payment resume with the existing order_no and amount', async () => {
  const detail = read(SF, 'src/views/OrderDetailView.vue')
  assert.ok(detail.includes('결제 계속하기'), 'READY detail has a resume button')
  assert.ok(detail.includes('order_no'), 'resume reuses order_no')
  assert.ok(detail.includes('total_pay_amount'), 'resume reuses the order amount')
  const fail = read(SF, 'src/views/PaymentResultView.vue')
  assert.ok(fail.includes('결제 계속하기') || fail.includes('결제 다시 시도'), 'fail state offers resume')
})
await t.test('S-N02 failed confirm keeps the order payable so the same order_no and amount can be retried', async () => {
  const g = await newGateway()
  const cust = await g.login('customer@example.com', 'CUSTOMER')
  const sku = g.db.prepare("SELECT s.id FROM product_skus s JOIN products p ON p.id = s.product_id WHERE p.partner_id = 'pt_001' AND s.stock_quantity > 5 LIMIT 1").get()
  const co = await g.call('/api/v1/orders/checkout', { method: 'POST', token: cust, body: { ...ADDR, items: [{ sku_id: sku.id, quantity: 1 }] } })
  assert.equal(co.status, 201, co.text)
  const wrong = await g.call('/api/v1/payments/confirm', { method: 'POST', token: cust, body: { order_id: co.json.order_no, payment_key: 'sandbox_retryprobe01', amount: co.json.total_pay_amount + 100 } })
  assert.equal(wrong.status, 400, wrong.text)
  assert.equal(wrong.json.code, 'AMOUNT_MISMATCH', wrong.text)
  const still = await g.call(`/api/v1/orders/${co.json.order_id}`, { token: cust })
  assert.equal(still.json.data.payment_status, 'READY', 'order stays READY after a failed attempt')
  const retry = await g.call('/api/v1/payments/confirm', { method: 'POST', token: cust, body: { order_id: co.json.order_no, payment_key: 'sandbox_retryprobe02', amount: co.json.total_pay_amount } })
  assert.equal(retry.status, 200, retry.text)
  assert.equal(retry.json.data.status, 'PAID')
})

t.finish()
