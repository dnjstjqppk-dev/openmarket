// Static + live contract tests for the admin operations console (Lane D):
// claims decide wiring, manual full-refund wiring, payout-account verification
// wiring, and the order-items payload the refund action depends on.
// Behavior proof is the admin typecheck + production build plus these checks.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRunner, createGateway } from '../lib/harness.mjs'

const t = createRunner('Admin ops console')
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const read = (p) => readFileSync(join(ROOT, p), 'utf8')

await t.test('A01 claims table binds the real claim_type and offers approve+reject', async () => {
  const v = read('apps/admin/src/views/claims/ClaimListView.vue')
  assert.ok(v.includes('row.claim_type'), 'type column binds claim_type (API has no `type` field)')
  assert.ok(!v.includes('row.type'), 'stale row.type binding is gone')
  assert.ok(v.includes('openReject(row)'), 'reject button wired')
  assert.ok(v.includes("row.claim_type === 'RETURN'"), 'split gated to RETURN (EXCHANGE is seller-approved)')
  assert.ok(v.includes('EXCHANGE') && v.includes('판매자'), 'exchange claims explain the seller path')
  assert.ok(v.includes('!rejectNote.trim()'), 'empty notes never fire a reject')
})

await t.test('A02 orders table wires manual full-refund with reason and idempotency', async () => {
  const v = read('apps/admin/src/views/orders/OrderDetailView.vue')
  assert.ok(v.includes('/api/v1/admin/orders/${order.value.id}/refund'), 'refund endpoint called per order')
  assert.ok(v.includes('X-Idempotency-Key'), 'refund carries an idempotency key')
  assert.ok(v.includes('refunded_quantity'), 'already-refunded quantities are excluded')
  assert.ok(v.includes('전액 환불'), 'refund action labeled')
  assert.ok(v.includes('PARTIAL_REFUNDED'), 'partially refunded orders stay actionable')
})

await t.test('A03 partner desk wires payout-account verify and change approve/reject', async () => {
  const v = read('apps/admin/src/views/partners/PartnerDetailView.vue')
  assert.ok(v.includes('/payout-account'), 'payout-account endpoint called')
  assert.ok(v.includes('VERIFY_CURRENT'), 'current-account verification wired')
  assert.ok(v.includes("'APPROVE'") && v.includes("'REJECT'"), 'change approve/reject wired')
  assert.ok(v.includes('verification_evidence'), 'evidence is collected for verify/approve')
  assert.ok(v.includes('maskAcct(p.bank_account_number)'), 'account numbers render masked')
  assert.ok(!v.includes('{{ p.bank_account_number }}'), 'full account number never rendered')
  assert.ok(v.includes('payout_account_verified'), 'verification badge bound')
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

await t.test('A04 GET /api/v1/admin/orders attaches sub_orders[].items for the refund action', async () => {
  const g = await createGateway({
    seedFiles: ['migrations/dev/seed_local_dev.sql'],
    env: {
      JWT_SECRET: 'e2e-secret-0123456789abcdefghijklmnopqrstu',
      ENVIRONMENT: 'development',
      CONNECTOR_SIMULATION: 'true',
      PAYMENT_MODE: 'sandbox'
    }
  })
  const login = await g.call('/api/v1/auth/login', { method: 'POST', body: { email: 'admin@openmarket.com', password: 'DevPass!2026#', role: 'ADMIN' } })
  assert.equal(login.status, 200)
  const uid = g.db.prepare("SELECT id FROM users WHERE role = 'ROLE_CUSTOMER' LIMIT 1").get().id
  const sku = g.db.prepare('SELECT id FROM product_skus LIMIT 1').get()
  assert.ok(sku, 'base seed must provide a sku for fixtures')
  insertRow(g, 'orders', { id: 'o_admops', order_no: 'ADMOPS-1', customer_id: uid })
  insertRow(g, 'sub_orders', { id: 'so_admops', parent_order_id: 'o_admops', sub_order_no: 'ADMOPS-1-1', partner_id: 'pt_001' })
  insertRow(g, 'order_items', { id: 'oi_admops', sub_order_id: 'so_admops', sku_id: sku.id, quantity: 2 })

  const r = await g.call('/api/v1/admin/orders', { method: 'GET', token: login.json.token })
  assert.equal(r.status, 200)
  const ord = (r.json.data || []).find((o) => o.id === 'o_admops')
  assert.ok(ord, 'fixture order listed')
  assert.ok(Array.isArray(ord.sub_orders) && ord.sub_orders.length === 1, 'sub_orders attached')
  assert.ok(Array.isArray(ord.sub_orders[0].items) && ord.sub_orders[0].items.length === 1, 'items attached per sub_order')
  assert.equal(ord.sub_orders[0].items[0].id, 'oi_admops')
})

await t.test('A05 dashboard carries no money-moving arbitration (tribunal is 4-16)', async () => {
  const v = read('apps/admin/src/views/DashboardView.vue')
  assert.ok(!v.includes('arbitrateDispute'), 'tribunal removed from the dashboard')
  assert.ok(!v.includes('FULL_REFUND_TO_BUYER'), 'no ruling lives on the dashboard')
  assert.ok(!/\b(?:window\.)?(?:alert|confirm|prompt)\s*\(/.test(v), 'no native dialogs on the dashboard')
  // The ruling behavior (with its confirmation) moves to views/claims in 4-16,
  // where it is built on useConfirm from the start (see Q-4-12).
})

await t.test('A06 broadcast push confirms target before sending', async () => {
  const v = read('apps/admin/src/views/marketing/NotificationSendView.vue')
  assert.ok(v.includes('askConfirm'), 'broadcast confirms via useConfirm')
  assert.ok(v.includes('notifTarget.value'), 'confirm names the target audience')
  assert.ok(v.includes('발송에 실패'), 'broadcast failure is reported')
})

await t.test('A07 dispute ruling confirms with amount before moving money', async () => {
  const v = read('apps/admin/src/views/claims/ClaimListView.vue')
  assert.ok(v.includes('askConfirm'), 'ruling confirms via useConfirm')
  assert.ok(v.includes('실제 환불이 실행됩니다'), 'confirm warns money moves')
  assert.ok(v.includes('amounts:'), 'confirm carries the bold amount')
  assert.ok(v.includes('구매자 환불') && v.includes('분담') && v.includes('판매자 부담'), 'three-way ruling offered')
  assert.ok(v.includes("decision: 'APPROVE'") && v.includes("decision: 'REJECT'"), 'approve and reject wired')
})

t.finish()
