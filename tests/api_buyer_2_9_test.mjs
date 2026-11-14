// tests/api_buyer_2_9_test.mjs
// Work order 2-9 buyer APIs.
import assert from 'node:assert/strict';
import { createGateway, createRunner } from './lib/harness.mjs';

const t = createRunner('Buyer APIs (2-9)');

async function newGateway() {
  return createGateway({
    seedFiles: ['migrations/dev/seed_local_dev.sql'],
    env: {
      JWT_SECRET: 'e2e-secret-0123456789abcdefghijklmnopqrstu',
      ENVIRONMENT: 'development',
      CONNECTOR_SIMULATION: 'true',
      PAYMENT_MODE: 'sandbox'
    }
  });
}

const PW = 'DevPass!2026#';
const addr = (postal) => ({
  recipient_name: '홍길동', recipient_phone: '010-1234-5678',
  shipping_address_line1: '서울특별시 강남구 테헤란로 1', shipping_postal_code: postal
});

async function login(g, email, role = 'CUSTOMER') {
  const r = await g.call('/api/v1/auth/login', { method: 'POST', body: { email, password: PW, role } });
  assert.equal(r.status, 200, `login ${email}: ${r.text}`);
  return r.json.token;
}

await t.test('B1. product list filters narrow honestly', async () => {
  const g = await newGateway();
  g.db.prepare("UPDATE products SET brand = 'AcmeTest' WHERE id = 'prod_001'").run();
  const b = await g.call('/api/v1/products?brand=AcmeTest');
  assert.equal(b.status, 200, b.text);
  assert.ok(b.json.data.length > 0, 'brand matches');
  assert.ok(b.json.data.every((p) => p.id === 'prod_001' || p.brand === 'AcmeTest'), 'only the brand matches');
  const many = await g.call('/api/v1/products?brand=a,b,c,d,e,f,h,i,j,k,l');
  assert.equal(many.status, 400, 'brand cap enforced');
  const dm = await g.call('/api/v1/products?sales_model=DIRECT');
  assert.equal(dm.status, 200, dm.text);
  const bad = await g.call('/api/v1/products?sales_model=BOGUS');
  assert.equal(bad.status, 400, 'sales model validated');
});

await t.test('B2. list carries 30-day sales and server badges', async () => {
  const g = await newGateway();
  const r = await g.call('/api/v1/products?per_page=50');
  assert.equal(r.status, 200, r.text);
  const p1 = r.json.data.find((p) => p.id === 'prod_001');
  assert.ok(p1, 'seed product listed');
  assert.equal(p1.sales_30d, null, 'quiet products blank the counter');
  assert.ok(Array.isArray(p1.badges), 'badges array present');
  assert.ok(p1.badges.includes('SALE'), 'discounted seed product badges SALE');
});

await t.test('B3. facets summarize the filtered set', async () => {
  const g = await newGateway();
  const r = await g.call('/api/v1/products/facets');
  assert.equal(r.status, 200, r.text);
  const f = r.json.data;
  assert.ok(Array.isArray(f.categories) && f.categories.length > 0, 'category counts');
  assert.ok(Array.isArray(f.brands) && f.brands.length <= 20, 'top brands capped');
  assert.ok(f.price && f.price.min <= f.price.max, 'price range sane');
  assert.ok(f.badges && typeof f.badges === 'object', 'badge counts present');
});

await t.test('B4. detail adds template, seller summary and max coupon', async () => {
  const g = await newGateway();
  const cust = await login(g, 'customer@example.com');
  const pid = g.db.prepare("SELECT partner_id FROM products WHERE id = 'prod_001'").get().partner_id;
  g.db.prepare(`INSERT INTO shipping_policies (id, partner_id, name, method, fee_type, base_fee, is_default, status)
    VALUES ('sp_t1', ?, 't', 'PARCEL', 'PAID', 3000, 1, 'ACTIVE')`).run(pid);
  g.db.prepare('INSERT INTO store_follows (id, user_id, partner_id) VALUES (?, ?, ?)')
    .run('sf_t1', 'u_customer_001', pid);
  g.db.prepare(`INSERT INTO coupons (id, code, title, discount_type, discount_value, min_order_amount, expires_at, is_active,
    issuer, scope, platform_share_bps, dup_group, issue_method, issued_count)
    VALUES ('cp_t1', 'T1MAX', 't', 'FIXED_AMOUNT', 1500, 0, '2099-01-01 00:00:00', 1, 'PLATFORM', 'ALL', 10000, 'PLATFORM', 'DOWNLOAD', 0)`).run();
  g.db.prepare("UPDATE coupons SET is_active = 0 WHERE id LIKE 'cpn_%'").run();
  const r = await g.call('/api/v1/products/prod_001', { token: cust });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.data.shipping_policy.id, 'sp_t1', 'effective template returned');
  assert.ok(r.json.data.seller, 'seller summary present');
  assert.equal(r.json.data.seller.followers, 1, 'follower count measured');
  assert.equal(r.json.data.max_coupon_discount, 1500, 'max claimable discount computed');
  assert.ok(Array.isArray(r.json.data.images), 'images still present');
});

await t.test('B5. product coupons list with claimed flags', async () => {
  const g = await newGateway();
  const cust = await login(g, 'customer@example.com');
  const anon = await g.call('/api/v1/products/prod_001/coupons');
  assert.equal(anon.status, 200, anon.text);
  assert.ok(Array.isArray(anon.json.data), 'anonymous list works');
  assert.ok(anon.json.data.every((c) => c.claimed === false), 'anonymous claimed flags false');
  const authed = await g.call('/api/v1/products/prod_001/coupons', { token: cust });
  const held = authed.json.data.find((c) => c.code === 'WELCOME10');
  assert.ok(held && held.claimed === true, 'held seed coupon flagged');
});

await t.test('B6. reviews page, sort, filter and summarize', async () => {
  const g = await newGateway();
  const pid = g.db.prepare("SELECT partner_id FROM products WHERE id = 'prod_001'").get().partner_id;
  g.db.prepare(`INSERT INTO product_reviews (id, product_id, user_id, reviewer_name, rating, content, images_json, helpful_count)
    VALUES ('rv_b6a', 'prod_001', 'u_customer_001', 'a', 5, 'x', '["https://x/y.png"]', 3)`).run();
  g.db.prepare(`INSERT INTO product_reviews (id, product_id, user_id, reviewer_name, rating, content, sku_option_summary)
    VALUES ('rv_b6b', 'prod_001', 'u_customer_001', 'b', 2, 'y', 'Black')`).run();
  g.db.prepare(`INSERT INTO product_reviews (id, product_id, user_id, reviewer_name, rating, content, visibility, blind_reason)
    VALUES ('rv_b6c', 'prod_001', 'u_customer_001', 'c', 1, 'z', 'BLIND', 'spam')`).run();
  g.db.prepare('INSERT INTO review_replies (id, review_id, partner_id, body) VALUES (?, ?, ?, ?)')
    .run('vr_b6', 'rv_b6a', pid, 'thanks');
  const p1 = await g.call('/api/v1/products/prod_001/reviews?per_page=1');
  assert.equal(p1.status, 200, p1.text);
  assert.equal(p1.json.data.reviews.length, 1, 'pagination applies');
  assert.equal(p1.json.data.pagination.total, 2, 'blind excluded from total');
  const helpful = await g.call('/api/v1/products/prod_001/reviews?sort=helpful');
  assert.equal(helpful.json.data.reviews[0].id, 'rv_b6a', 'helpful sorts first');
  const photos = await g.call('/api/v1/products/prod_001/reviews?photos_only=true');
  assert.ok(photos.json.data.reviews.length === 1 && photos.json.data.reviews[0].id === 'rv_b6a', 'photo filter works');
  const opt = await g.call('/api/v1/products/prod_001/reviews?option=Black');
  assert.ok(opt.json.data.reviews.length === 1 && opt.json.data.reviews[0].id === 'rv_b6b', 'option filter works');
  const sum = p1.json.data.summary;
  assert.equal(sum.distribution['5'], 1, 'distribution counts');
  assert.equal(sum.photo_count, 1, 'photo count measured');
  assert.ok(sum.fit && typeof sum.fit === 'object', 'fit summary present');
  assert.equal(p1.json.data.reviews[0].reply.body, 'thanks', 'seller reply included');
  const stars = await g.call('/api/v1/products/prod_001/reviews?rating=5');
  assert.ok(stars.json.data.reviews.length === 1 && stars.json.data.reviews[0].id === 'rv_b6a', 'rating filter works');
});

await t.test('B7. trending endpoint serves ranks and deltas', async () => {
  const g = await newGateway();
  g.db.prepare("INSERT INTO search_keyword_hourly (keyword, hour, search_count) VALUES ('trendx', datetime('now'), 40)").run();
  const r = await g.call('/api/v1/search/trending');
  assert.equal(r.status, 200, r.text);
  assert.ok(r.json.data.trending.find((x) => x.keyword === 'trendx'), 'fresh keyword trends');
});

await t.test('B8. exhibitions list active shows with products', async () => {
  const g = await newGateway();
  g.db.prepare(`INSERT INTO exhibitions (id, title, starts_at, ends_at, status, sort_order)
    VALUES ('ex_live', 't', datetime('now', '-1 hour'), datetime('now', '+1 hour'), 'ACTIVE', 0)`).run();
  g.db.prepare(`INSERT INTO exhibitions (id, title, starts_at, ends_at, status, sort_order)
    VALUES ('ex_old', 't', '2001-01-01 00:00:00', '2001-01-02 00:00:00', 'ENDED', 0)`).run();
  g.db.prepare('INSERT INTO exhibition_products (exhibition_id, product_id, sort_order) VALUES (?, ?, 0)').run('ex_live', 'prod_001');
  const list = await g.call('/api/v1/exhibitions');
  assert.equal(list.status, 200, list.text);
  assert.ok(list.json.data.find((e) => e.id === 'ex_live'), 'active listed');
  assert.ok(!list.json.data.find((e) => e.id === 'ex_old'), 'ended hidden');
  const one = await g.call('/api/v1/exhibitions/ex_live');
  assert.equal(one.json.data.products.length, 1, 'products attached');
  const gone = await g.call('/api/v1/exhibitions/ex_old');
  assert.equal(gone.status, 404, 'ended detail hidden');
});

await t.test('B9. store adds profile, followers, grade and shipping', async () => {
  const g = await newGateway();
  const pid = g.db.prepare("SELECT partner_id FROM products WHERE id = 'prod_001'").get().partner_id;
  g.db.prepare('INSERT INTO partner_store_profiles (partner_id, intro) VALUES (?, ?)').run(pid, 'hello');
  g.db.prepare('INSERT INTO store_follows (id, user_id, partner_id) VALUES (?, ?, ?)').run('sf_b9', 'u_customer_001', pid);
  g.db.prepare('INSERT INTO partner_grades (partner_id, month, grade_code, metrics_json) VALUES (?, ?, ?, ?)').run(pid, '2026-10', 'GOLD', '{}');
  const r = await g.call(`/api/v1/partners/${pid}/store`);
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.data.profile.intro, 'hello', 'profile attached');
  assert.equal(r.json.data.stats.followers, 1, 'followers counted');
  assert.equal(r.json.data.stats.grade, 'GOLD', 'latest grade shown');
  assert.ok(r.json.data.shipping_policy, 'shipping summary present');
});

await t.test('B10. follow toggles and lists', async () => {
  const g = await newGateway();
  const cust = await login(g, 'customer@example.com');
  const pid = g.db.prepare("SELECT partner_id FROM products WHERE id = 'prod_001'").get().partner_id;
  const on = await g.call(`/api/v1/stores/${pid}/follow`, { method: 'POST', token: cust });
  assert.equal(on.status, 200, on.text);
  assert.equal(on.json.data.following, true, 'followed');
  const list = await g.call('/api/v1/me/followed-stores', { token: cust });
  assert.ok(list.json.data.find((s) => s.partner_id === pid), 'listed');
  const off = await g.call(`/api/v1/stores/${pid}/follow`, { method: 'DELETE', token: cust });
  assert.equal(off.json.data.following, false, 'unfollowed');
  const bad = await g.call('/api/v1/stores/pt_missing/follow', { method: 'POST', token: cust });
  assert.equal(bad.status, 404, 'unknown sellers cannot be followed');
});

await t.test('B11. recently viewed records, merges and deletes', async () => {
  const g = await newGateway();
  const cust = await login(g, 'customer@example.com');
  await g.call('/api/v1/products/prod_001', { token: cust });
  await g.call('/api/v1/products/prod_002', { token: cust });
  const list = await g.call('/api/v1/me/recently-viewed', { token: cust });
  assert.equal(list.status, 200, list.text);
  assert.deepEqual(list.json.data.map((p) => p.id).slice(0, 2), ['prod_002', 'prod_001'], 'newest first');
  const merge = await g.call('/api/v1/me/recently-viewed/merge', { method: 'POST', token: cust, body: { product_ids: ['prod_003', 'prod_001'] } });
  assert.equal(merge.status, 200, merge.text);
  const after = await g.call('/api/v1/me/recently-viewed', { token: cust });
  assert.equal(after.json.data[0].id, 'prod_001', 'merged ids refresh recency');
  const over = await g.call('/api/v1/me/recently-viewed/merge', { method: 'POST', token: cust, body: { product_ids: Array.from({ length: 51 }, (_, i) => `p${i}`) } });
  assert.equal(over.status, 400, 'merge capped at fifty');
  const del = await g.call('/api/v1/me/recently-viewed/prod_001', { method: 'DELETE', token: cust });
  assert.equal(del.status, 200, del.text);
  const gone = await g.call('/api/v1/me/recently-viewed', { token: cust });
  assert.ok(!gone.json.data.find((p) => p.id === 'prod_001'), 'entry removed');
});

await t.test('B12. helpful toggles, rejects self-votes', async () => {
  const g = await newGateway();
  const cust = await login(g, 'customer@example.com');
  g.db.prepare("INSERT INTO users (id, email, password_hash, full_name, phone, role) VALUES ('u_b12', 'b12@example.com', 'x', 'B', '010', 'ROLE_CUSTOMER')").run();
  g.db.prepare(`INSERT INTO product_reviews (id, product_id, user_id, reviewer_name, rating, content)
    VALUES ('rv_b12a', 'prod_001', 'u_b12', 't', 5, 'x')`).run();
  g.db.prepare(`INSERT INTO product_reviews (id, product_id, user_id, reviewer_name, rating, content)
    VALUES ('rv_b12b', 'prod_001', 'u_customer_001', 't', 5, 'x')`).run();
  const self = await g.call('/api/v1/reviews/rv_b12b/helpful', { method: 'POST', token: cust });
  assert.equal(self.status, 403, 'own review rejected');
  const t1 = await g.call('/api/v1/reviews/rv_b12a/helpful', { method: 'POST', token: cust });
  assert.equal(t1.status, 200, t1.text);
  assert.equal(t1.json.data.helpful, true, 'vote recorded');
  assert.equal(t1.json.data.count, 1, 'count maintained');
  const t2 = await g.call('/api/v1/reviews/rv_b12a/helpful', { method: 'POST', token: cust });
  assert.equal(t2.json.data.helpful, false, 'second call untoggles');
});

await t.test('B13. reports validate and deduplicate', async () => {
  const g = await newGateway();
  const cust = await login(g, 'customer@example.com');
  g.db.prepare(`INSERT INTO product_reviews (id, product_id, user_id, reviewer_name, rating, content)
    VALUES ('rv_b13', 'prod_001', 'u_customer_001', 't', 5, 'x')`).run();
  const bad = await g.call('/api/v1/reviews/rv_b13/report', { method: 'POST', token: cust, body: { reason: 'NOPE' } });
  assert.equal(bad.status, 400, 'reason validated');
  const first = await g.call('/api/v1/reviews/rv_b13/report', { method: 'POST', token: cust, body: { reason: 'AD' } });
  assert.equal(first.status, 201, first.text);
  const dup = await g.call('/api/v1/reviews/rv_b13/report', { method: 'POST', token: cust, body: { reason: 'AD' } });
  assert.equal(dup.status, 409, 'duplicate report rejected');
});

await t.test('B14. coupon wallet groups holdings honestly', async () => {
  const g = await newGateway();
  const cust = await login(g, 'customer@example.com');
  const r = await g.call('/api/v1/coupons', { token: cust });
  assert.equal(r.status, 200, r.text);
  assert.ok(Array.isArray(r.json.data.usable), 'usable group present');
  assert.ok(Array.isArray(r.json.data.claimable), 'claimable group present');
  assert.ok(Array.isArray(r.json.data.used_expired), 'used/expired group present');
  const held = r.json.data.usable.find((c) => c.code === 'WELCOME10');
  assert.ok(held, 'seed holding listed as usable');
  assert.equal(held.issuer, 'PLATFORM', 'issuer shown');
  assert.equal(held.scope, 'ALL', 'scope shown');
});

await t.test('B15. best-coupon search maximizes cart savings', async () => {
  const g = await newGateway();
  const cust = await login(g, 'customer@example.com');
  const me = 'u_customer_001';
  const pid = g.db.prepare("SELECT partner_id FROM products WHERE id = 'prod_001'").get().partner_id;
  const s = g.db.prepare(
    `SELECT s.id FROM product_skus s JOIN products p ON p.id = s.product_id
     WHERE p.id = 'prod_001' AND s.stock_quantity > 0 LIMIT 1`).get();
  await g.call('/api/v1/cart', { method: 'PUT', token: cust, body: { items: [{ sku_id: s.id, quantity: 1 }] } });
  g.db.prepare(`INSERT INTO coupons (id, code, title, discount_type, discount_value, min_order_amount, expires_at, is_active,
    issuer, scope, platform_share_bps, dup_group, issue_method, issued_count)
    VALUES ('cp_b15a', 'B15A', 't', 'FIXED_AMOUNT', 5000, 0, '2099-01-01 00:00:00', 1, 'PLATFORM', 'ALL', 10000, 'PLATFORM', 'DOWNLOAD', 0)`).run();
  g.db.prepare(`INSERT INTO coupons (id, code, title, discount_type, discount_value, min_order_amount, expires_at, is_active,
    issuer, seller_id, scope, platform_share_bps, dup_group, issue_method, issued_count)
    VALUES ('cp_b15b', 'B15B', 't', 'FIXED_AMOUNT', 900, 0, '2099-01-01 00:00:00', 1, 'SELLER', ?, 'SELLER', 0, 'STORE', 'DOWNLOAD', 0)`).run(pid);
  g.db.prepare("INSERT INTO user_coupons (id, user_id, coupon_id, is_used) VALUES ('uc_b15a', ?, 'cp_b15a', 0)").run(me);
  g.db.prepare("INSERT INTO user_coupons (id, user_id, coupon_id, is_used) VALUES ('uc_b15b', ?, 'cp_b15b', 0)").run(me);
  const r = await g.call('/api/v1/coupons/best', { method: 'POST', token: cust, body: {} });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.data.platform.user_coupon_id, 'uc_b15a', 'best platform picked');
  assert.equal(r.json.data.store[0].user_coupon_id, 'uc_b15b', 'best store picked');
  assert.equal(r.json.data.total_discount, 5900, 'savings summed');
});

await t.test('B16. quotes itemize coupons, shipping and credit', async () => {
  const g = await newGateway();
  const cust = await login(g, 'customer@example.com');
  const pid = g.db.prepare("SELECT partner_id FROM products WHERE id = 'prod_001'").get().partner_id;
  const s = g.db.prepare(
    `SELECT s.id FROM product_skus s JOIN products p ON p.id = s.product_id
     WHERE p.id = 'prod_001' AND s.stock_quantity > 0 LIMIT 1`).get();
  const plain = await g.call('/api/v1/orders/quote', {
    method: 'POST', token: cust, body: { ...addr('06236'), items: [{ sku_id: s.id, quantity: 1 }] }
  });
  assert.equal(plain.status, 200, plain.text);
  assert.equal(plain.json.data.platform_discount_amount, 0, 'platform total present');
  assert.ok(!('projected_credit_amount' in plain.json.data), 'no projection without policy');
  const st = `cp_${Math.random().toString(36).slice(2, 10)}`;
  g.db.prepare(`INSERT INTO coupons (id, code, title, discount_type, discount_value, min_order_amount, expires_at, is_active,
    issuer, seller_id, scope, platform_share_bps, dup_group, issue_method, issued_count)
    VALUES (?, ?, 't', 'FIXED_AMOUNT', 700, 0, '2099-01-01 00:00:00', 1, 'SELLER', ?, 'SELLER', 0, 'STORE', 'DOWNLOAD', 0)`)
    .run(st, `C_${st}`, pid);
  const su = `uc_${Math.random().toString(36).slice(2, 10)}`;
  g.db.prepare('INSERT INTO user_coupons (id, user_id, coupon_id, is_used) VALUES (?, ?, ?, 0)').run(su, 'u_customer_001', st);
  g.db.prepare("INSERT INTO platform_policies (key, value, effective_from) VALUES ('credit.earn_bps', '100', date('now'))").run();
  const q = await g.call('/api/v1/orders/quote', {
    method: 'POST', token: cust,
    body: { ...addr('06236'), items: [{ sku_id: s.id, quantity: 1 }], user_coupon_id: 'uc_002', store_coupon_ids: [su] }
  });
  assert.equal(q.status, 200, q.text);
  assert.equal(q.json.data.sub_orders[0].store_discount_amount, 700, 'per-seller store total shown');
  assert.ok(Array.isArray(q.json.data.sub_orders[0].shipping_groups), 'shipping breakdown shown');
  assert.equal(q.json.data.platform_discount_amount, 3000, 'platform total shown');
  assert.ok(q.json.data.projected_credit_amount > 0, 'projection shown with policy');
});

await t.test('B17. claims take pickup, photos and preview the fee', async () => {
  const g = await newGateway();
  const cust = await login(g, 'customer@example.com');
  const s = g.db.prepare(
    `SELECT s.id FROM product_skus s JOIN products p ON p.id = s.product_id
     WHERE p.status = 'ACTIVE' AND s.stock_quantity > 0 LIMIT 1`).get();
  const o = (await g.call('/api/v1/orders/checkout', {
    method: 'POST', token: cust, body: { ...addr('06236'), items: [{ sku_id: s.id, quantity: 1 }] }
  })).json;
  const pay = await g.call('/api/v1/payments/confirm', { method: 'POST', token: cust, body: { order_id: o.order_id, payment_key: `sandbox_${o.order_id.slice(-8)}xx`, amount: o.total_pay_amount } });
  assert.equal(pay.status, 200, pay.text);
  const sub = g.db.prepare('SELECT * FROM sub_orders WHERE parent_order_id = ?').get(o.order_id);
  g.db.prepare("UPDATE sub_orders SET status = 'DELIVERED', delivered_at = CURRENT_TIMESTAMP WHERE id = ?").run(sub.id);
  const c = await g.call(`/api/v1/orders/${o.order_id}/claims`, { method: 'POST', token: cust,
    body: { sub_order_id: sub.id, reason_code: 'CHANGE_OF_MIND', pickup_address: '서울시 어딘가', photos: ['https://x/y.png'] } });
  assert.equal(c.status, 201, c.text);
  assert.ok(Number.isInteger(c.json.data.estimated_return_fee), 'fee preview returned');
  const row = g.db.prepare('SELECT pickup_address, photo_urls_json FROM returns WHERE id = ?').get(c.json.data.claim_id);
  assert.equal(row.pickup_address, '서울시 어딘가', 'pickup stored');
  assert.deepEqual(JSON.parse(row.photo_urls_json), ['https://x/y.png'], 'photos stored');
});

await t.test('B18. restock subscriptions need a real stockout', async () => {
  const g = await newGateway();
  const cust = await login(g, 'customer@example.com');
  const inStock = g.db.prepare('SELECT id FROM product_skus WHERE stock_quantity > 0 LIMIT 1').get().id;
  const no = await g.call('/api/v1/restock-subscriptions', { method: 'POST', token: cust, body: { sku_id: inStock } });
  assert.equal(no.status, 409, 'in-stock SKUs rejected');
  const sku = g.db.prepare('SELECT id FROM product_skus WHERE stock_quantity > 0 LIMIT 1 OFFSET 1').get().id;
  g.db.prepare("UPDATE product_skus SET stock_quantity = 0, status = 'OUT_OF_STOCK' WHERE id = ?").run(sku);
  const yes = await g.call('/api/v1/restock-subscriptions', { method: 'POST', token: cust, body: { sku_id: sku } });
  assert.equal(yes.status, 201, yes.text);
  const dup = await g.call('/api/v1/restock-subscriptions', { method: 'POST', token: cust, body: { sku_id: sku } });
  assert.equal(dup.status, 200, 'duplicate replayed idempotently');
  const del = await g.call('/api/v1/restock-subscriptions', { method: 'DELETE', token: cust, body: { sku_id: sku } });
  assert.equal(del.status, 200, del.text);
  assert.equal(g.db.prepare('SELECT COUNT(*) AS n FROM restock_subscriptions WHERE sku_id = ?').get(sku).n, 0, 'removed');
});

t.finish();
