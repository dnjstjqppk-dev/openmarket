// tests/migration_fk_rehearsal.mjs
// D1 always enforces foreign keys and runs each migration file as one transaction. The regular test harness builds
// its schema with FKs off, which hid a d1_20 failure that only appears when legacy orders (with children) exist.
// This rehearsal applies d1_01..d1_19, inserts synthetic legacy data, then applies every later migration exactly
// the way D1 does (FKs on, one transaction per file) and checks nothing was lost. No production data is used.
// Run: node tests/migration_fk_rehearsal.mjs

import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { listMigrations, MIGRATIONS_DIR } from './lib/harness.mjs';

const db = new DatabaseSync(':memory:');
db.exec('PRAGMA foreign_keys = ON;');
const files = listMigrations();
const split = files.findIndex((f) => f.startsWith('d1_20_'));
const apply = (f) => {
  db.exec('BEGIN');
  try {
    db.exec(fs.readFileSync(path.join(MIGRATIONS_DIR, f), 'utf8'));
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw new Error(`${f}: ${e.message}`);
  }
};
for (const f of files.slice(0, split)) apply(f);

// Synthetic legacy data shaped like a pre-V3 production database (orders with sub-orders, items, settlements).
const one = (sql) => db.prepare(sql).get();
const user = one("SELECT id FROM users WHERE role = 'ROLE_CUSTOMER' LIMIT 1") || (() => {
  db.prepare("INSERT INTO users (id, email, password_hash, full_name, phone, role) VALUES ('u_legacy', 'legacy@example.invalid', 'x', 'L', '010', 'ROLE_CUSTOMER')").run();
  return { id: 'u_legacy' };
})();
const partner = one('SELECT id FROM partners LIMIT 1');
const sku = one('SELECT id, product_id FROM product_skus LIMIT 1');
assert.ok(partner && sku, 'seeded partners/products expected from earlier migrations');
const orderCols = new Set(db.prepare('PRAGMA table_info(orders)').all().map((c) => c.name));
for (let i = 0; i < 5; i++) {
  const extra = orderCols.has('shipping_address_line2') ? ", shipping_address_line2" : '';
  const extraV = orderCols.has('shipping_address_line2') ? ", ''" : '';
  db.prepare(`INSERT INTO orders (id, order_no, customer_id, total_goods_amount, total_shipping_amount, total_discount_amount, total_pay_amount, payment_status,
              recipient_name, recipient_phone, shipping_address_line1, shipping_postal_code${extra})
              VALUES (?, ?, ?, 10000, 0, 0, 10000, 'PAID', 'n', '010', 'addr', '00000'${extraV})`).run(`ord_l${i}`, `L-${i}`, user.id);
  db.prepare(`INSERT INTO sub_orders (id, parent_order_id, sub_order_no, partner_id, shipping_fee, goods_amount, discount_amount, total_amount, status)
              VALUES (?, ?, ?, ?, 0, 10000, 0, 10000, 'DELIVERED')`).run(`sub_l${i}`, `ord_l${i}`, `LS-${i}`, partner.id);
  db.prepare(`INSERT INTO order_items (id, sub_order_id, sku_id, product_title, option_summary, quantity, unit_price, total_price)
              VALUES (?, ?, ?, 't', 'o', 1, 10000, 10000)`).run(`itm_l${i}`, `sub_l${i}`, sku.id);
  db.prepare(`INSERT INTO settlements (id, sub_order_id, partner_id, gross_amount, shipping_fee, commission_rate, commission_amount, net_payout_amount, status)
              VALUES (?, ?, ?, 10000, 0, 10, 1000, 9000, 'PENDING')`).run(`stl_l${i}`, `sub_l${i}`, partner.id);
}
const count = (t) => one(`SELECT COUNT(*) c FROM ${t}`).c;
const before = Object.fromEntries(['orders', 'sub_orders', 'order_items', 'settlements'].map((t) => [t, count(t)]));

for (const f of files.slice(split)) apply(f);

const after = Object.fromEntries(Object.keys(before).map((t) => [t, count(t)]));
assert.deepEqual(after, before, 'no row lost by the table rebuilds');
assert.equal(db.prepare('PRAGMA foreign_key_check').all().length, 0, 'no dangling references');
assert.equal(one("SELECT COUNT(*) c FROM orders WHERE legacy_record = 1").c, before.orders, 'pre-V3 orders kept as legacy');
assert.equal(one("SELECT COUNT(*) c FROM sqlite_master WHERE name LIKE '_v20_%'").c, 0, 'temporary stash tables removed');
console.log(`[PASS] migrations ${files[split]}..${files.at(-1)} apply with foreign keys ON over legacy data: ${JSON.stringify(after)}`);
