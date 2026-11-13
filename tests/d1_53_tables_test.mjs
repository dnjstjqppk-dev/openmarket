// Work order 2-1: d1_53 fee/grade/promo tables exist with their key columns.
import assert from 'node:assert/strict'
import { createRunner, createGateway } from './lib/harness.mjs'

const t = createRunner('d1_53 tables')

const TABLES = [
  'fee_schedules', 'partner_fees', 'pg_fee_policies',
  'coupon_definitions', 'coupon_issued', 'coupon_redemptions',
  'customer_credits', 'credit_ledger',
  'earn_policies', 'point_policies',
  'seller_grades', 'seller_grade_history', 'seller_penalties',
  'price_history', 'return_labels', 'bulk_jobs'
]

async function boot() {
  return createGateway({ seedFiles: ['migrations/dev/seed_local_dev.sql'] })
}

await t.test('M01 all sixteen tables exist', async () => {
  const g = await boot()
  for (const name of TABLES) {
    const row = g.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(name)
    assert.ok(row, `table ${name} must exist`)
  }
})

await t.test('M02 key columns exist on each table', async () => {
  const g = await boot()
  const cols = (name) => g.db.prepare(`PRAGMA table_info(${name})`).all().map((c) => c.name)
  const need = {
    fee_schedules: ['id', 'category_id', 'rate_bp', 'base'],
    partner_fees: ['id', 'partner_id', 'rate_bp'],
    pg_fee_policies: ['id', 'method', 'rate_bp', 'pass_to_seller'],
    coupon_definitions: ['id', 'owner_type', 'discount_type', 'discount_value'],
    coupon_issued: ['id', 'definition_id', 'user_id', 'status'],
    coupon_redemptions: ['id', 'definition_id', 'user_id', 'order_id', 'discount_applied'],
    customer_credits: ['id', 'user_id', 'balance'],
    credit_ledger: ['id', 'user_id', 'amount_delta', 'balance_after'],
    earn_policies: ['id', 'rate_bp', 'source'],
    point_policies: ['id', 'min_order_amount', 'max_use_ratio_bp', 'expiry_days'],
    seller_grades: ['id', 'partner_id', 'grade'],
    seller_grade_history: ['id', 'partner_id', 'grade'],
    seller_penalties: ['id', 'partner_id', 'rule_code', 'status'],
    price_history: ['id', 'sku_id', 'old_price', 'new_price'],
    return_labels: ['id', 'carrier', 'tracking_number', 'status'],
    bulk_jobs: ['id', 'partner_id', 'job_type', 'status']
  }
  for (const [name, keys] of Object.entries(need)) {
    const have = cols(name)
    for (const k of keys) assert.ok(have.includes(k), `${name}.${k} must exist`)
  }
})

await t.test('M03 foreign keys point at real parents', async () => {
  const g = await boot()
  const fks = (name) => g.db.prepare(`PRAGMA foreign_key_list(${name})`).all().map((f) => f.table)
  assert.ok(fks('partner_fees').includes('partners'), 'partner_fees -> partners')
  assert.ok(fks('coupon_issued').includes('coupon_definitions'), 'coupon_issued -> definitions')
  assert.ok(fks('coupon_redemptions').includes('orders'), 'coupon_redemptions -> orders')
  assert.ok(fks('customer_credits').includes('users'), 'customer_credits -> users')
  assert.ok(fks('seller_penalties').includes('partners'), 'seller_penalties -> partners')
})

t.finish()
