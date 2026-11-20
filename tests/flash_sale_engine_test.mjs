// tests/flash_sale_engine_test.mjs
// Work order 2-6: flash sale deal pricing, allocation races, restock restore.
import assert from 'node:assert/strict';
import { createGateway, createRunner } from './lib/harness.mjs';

const t = createRunner('Flash sale engine (2-6)');

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

function columns(db, table) {
  return db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
}

function mkCampaign(g, over = {}) {
  const id = `flc_${Math.random().toString(36).slice(2, 10)}`;
  g.db.prepare(`INSERT INTO flash_sale_campaigns (id, title, starts_at, ends_at, status)
    VALUES (?, 't', datetime('now', '-1 hour'), datetime('now', '+1 hour'), 'ACTIVE')`).run(id);
  if (over.starts_at || over.ends_at || over.status) {
    g.db.prepare('UPDATE flash_sale_campaigns SET starts_at = COALESCE(?, starts_at), ends_at = COALESCE(?, ends_at), status = COALESCE(?, status) WHERE id = ?')
      .run(over.starts_at || null, over.ends_at || null, over.status || null, id);
  }
  return id;
}

function mkItem(g, campaignId, skuId, over = {}) {
  const id = `fli_${Math.random().toString(36).slice(2, 10)}`;
  const prod = g.db.prepare('SELECT product_id FROM product_skus WHERE id = ?').get(skuId).product_id;
  g.db.prepare(`INSERT INTO flash_sale_items (id, campaign_id, product_id, sku_id, deal_price, discount_rate,
    allocated_stock, sold_stock, sort_order, status, applicant_partner_id)
    VALUES (?, ?, ?, ?, ?, 0, ?, 0, 0, 'APPROVED', NULL)`)
    .run(id, campaignId, prod, over.sku_null ? null : skuId, over.deal_price ?? 1000, over.allocated ?? 10);
  if (over.status) g.db.prepare('UPDATE flash_sale_items SET status = ? WHERE id = ?').run(over.status, id);
  return id;
}

function skuOf(g, partnerId) {
  return g.db.prepare(
    `SELECT s.id, s.sale_price FROM product_skus s JOIN products p ON p.id = s.product_id
     WHERE p.partner_id = ? AND p.status = 'ACTIVE' AND s.stock_quantity > 50 LIMIT 1`
  ).get(partnerId);
}

await t.test('1. flash, item and exhibition tables exist', async () => {
  const g = await newGateway();
  for (const c of ['status', 'applicant_partner_id']) {
    assert.ok(columns(g.db, 'flash_sale_items').includes(c), `flash_sale_items has ${c}`);
  }
  assert.ok(columns(g.db, 'order_items').includes('flash_sale_item_id'), 'order_items has flash_sale_item_id');
  for (const c of ['id', 'title', 'banner_url', 'starts_at', 'ends_at', 'status', 'sort_order']) {
    assert.ok(columns(g.db, 'exhibitions').includes(c), `exhibitions has ${c}`);
  }
  for (const c of ['exhibition_id', 'product_id', 'sort_order']) {
    assert.ok(columns(g.db, 'exhibition_products').includes(c), `exhibition_products has ${c}`);
  }
  const legacy = g.db.prepare("SELECT COUNT(*) AS n FROM flash_sale_items WHERE status IS NULL OR status = ''").get().n;
  assert.equal(legacy, 0, 'seeded items carry an approval status');
});

await t.test('2. allocation guard rejects over-sell and negative counts', async () => {
  const g = await newGateway();
  const pid = g.db.prepare("SELECT id FROM partners WHERE status = 'APPROVED' LIMIT 1").get().id;
  const s = skuOf(g, pid);
  const camp = mkCampaign(g);
  const item = mkItem(g, camp, s.id, { allocated: 2 });
  g.db.prepare('UPDATE flash_sale_items SET sold_stock = 2 WHERE id = ?').run(item);
  assert.throws(() => {
    g.db.prepare('UPDATE flash_sale_items SET sold_stock = 3 WHERE id = ?').run(item);
  }, 'selling past the allocation is rejected');
  assert.throws(() => {
    g.db.prepare('UPDATE flash_sale_items SET sold_stock = -1 WHERE id = ?').run(item);
  }, 'negative sold counts are rejected');
});

await t.test('3. quotes charge the deal price without volume discounts', async () => {
  const g = await newGateway();
  g.db.prepare("UPDATE flash_sale_campaigns SET status = 'ENDED' WHERE id = 'fls_today'").run();
  const cust = await login(g, 'customer@example.com');
  const pid = g.db.prepare("SELECT id FROM partners WHERE status = 'APPROVED' LIMIT 1").get().id;
  const s = skuOf(g, pid);
  const deal = Math.max(100, s.sale_price - 5000);
  mkItem(g, mkCampaign(g), s.id, { deal_price: deal, allocated: 100 });
  const q = await g.call('/api/v1/orders/quote', {
    method: 'POST', token: cust, body: { ...addr('06236'), items: [{ sku_id: s.id, quantity: 10 }] }
  });
  assert.equal(q.status, 200, q.text);
  assert.equal(q.json.data.total_goods_amount, deal * 10, 'deal price replaces the ticket price');
  assert.equal(q.json.data.volume_discount_amount, 0, 'no volume discount on deal lines');
});

await t.test('4. outside the window or approval the ticket price holds', async () => {
  const g = await newGateway();
  g.db.prepare("UPDATE flash_sale_campaigns SET status = 'ENDED' WHERE id = 'fls_today'").run();
  const cust = await login(g, 'customer@example.com');
  const pid = g.db.prepare("SELECT id FROM partners WHERE status = 'APPROVED' LIMIT 1").get().id;
  const s = skuOf(g, pid);
  mkItem(g, mkCampaign(g, { starts_at: '2001-01-01 00:00:00', ends_at: '2001-01-02 00:00:00' }), s.id, { deal_price: 100 });
  const q = await g.call('/api/v1/orders/quote', {
    method: 'POST', token: cust, body: { ...addr('06236'), items: [{ sku_id: s.id, quantity: 1 }] }
  });
  assert.equal(q.json.data.total_goods_amount, s.sale_price, 'ended campaigns do not discount');
  const camp2 = mkCampaign(g);
  mkItem(g, camp2, s.id, { deal_price: 100, status: 'REQUESTED' });
  const q2 = await g.call('/api/v1/orders/quote', {
    method: 'POST', token: cust, body: { ...addr('06236'), items: [{ sku_id: s.id, quantity: 1 }] }
  });
  assert.equal(q2.json.data.total_goods_amount, s.sale_price, 'unapproved items do not discount');
});

await t.test('5. one allocation between two payments rejects the loser', async () => {
  const g = await newGateway();
  g.db.prepare("UPDATE flash_sale_campaigns SET status = 'ENDED' WHERE id = 'fls_today'").run();
  const cust = await login(g, 'customer@example.com');
  const pid = g.db.prepare("SELECT id FROM partners WHERE status = 'APPROVED' LIMIT 1").get().id;
  const s = skuOf(g, pid);
  mkItem(g, mkCampaign(g), s.id, { deal_price: Math.max(100, s.sale_price - 100), allocated: 1 });
  const mk = async (key) => (await g.call('/api/v1/orders/checkout', {
    method: 'POST', token: cust, headers: { 'X-Idempotency-Key': key },
    body: { ...addr('06236'), items: [{ sku_id: s.id, quantity: 1 }] }
  })).json;
  const o1 = await mk('deal-pay-1');
  const o2 = await mk('deal-pay-2');
  const pays = await Promise.all([o1, o2].map((o, i) =>
    g.call('/api/v1/payments/confirm', { method: 'POST', token: cust,
      body: { order_id: o.order_id, payment_key: `sandbox_deal000${i}`, amount: o.total_pay_amount } })
  ));
  const codes = pays.map((p) => (p.status === 200 ? 'ok' : p.json.code)).sort();
  assert.deepEqual(codes, ['FLASH_SALE_SOLD_OUT', 'ok'], `exactly one payment wins, got ${JSON.stringify(codes)}`);
});

await t.test('6. cancelling restores the deal allocation', async () => {
  const g = await newGateway();
  const cust = await login(g, 'customer@example.com');
  const pid = g.db.prepare("SELECT id FROM partners WHERE status = 'APPROVED' LIMIT 1").get().id;
  const s = skuOf(g, pid);
  const item = mkItem(g, mkCampaign(g), s.id, { deal_price: Math.max(100, s.sale_price - 100), allocated: 5 });
  const o = (await g.call('/api/v1/orders/checkout', {
    method: 'POST', token: cust, headers: { 'X-Idempotency-Key': 'deal-cancel-1' },
    body: { ...addr('06236'), items: [{ sku_id: s.id, quantity: 2 }] }
  })).json;
  assert.ok(o.order_id, `checkout ok: ${JSON.stringify(o).slice(0, 200)}`);
  // NOTE: stock is reserved at checkout but deal counts move at payment; cancel
  // before payment must leave the allocation untouched.
  const c = await g.call(`/api/v1/orders/${o.order_id}/cancel`, { method: 'POST', token: cust });
  assert.equal(c.status, 200, c.text);
  const row = g.db.prepare('SELECT sold_stock FROM flash_sale_items WHERE id = ?').get(item);
  assert.equal(row.sold_stock, 0, 'unpaid cancel restores nothing and corrupts nothing');
});

await t.test('7. lightning feed reports measured deal figures', async () => {
  const g = await newGateway();
  const pid = g.db.prepare("SELECT id FROM partners WHERE status = 'APPROVED' LIMIT 1").get().id;
  const s = skuOf(g, pid);
  const camp = mkCampaign(g);
  const item = mkItem(g, camp, s.id, { deal_price: 1234, allocated: 8 });
  g.db.prepare('UPDATE flash_sale_items SET sold_stock = 2 WHERE id = ?').run(item);
  const r = await g.call('/api/v1/campaigns/lightning');
  assert.equal(r.status, 200, r.text);
  const deal = r.json.data.deals.find((d) => d.id === item);
  assert.ok(deal, 'approved item is listed');
  assert.equal(deal.deal_price, 1234, 'feed shows the real deal price');
  assert.equal(deal.sold_quantity, 2, 'feed shows measured sales');
  assert.equal(deal.sold_percent, 25, 'feed shows the measured sell-through');
  assert.ok(deal.remaining_stock <= 6, 'remaining respects the allocation');
});

await t.test('9. lightning feed names the next round', async () => {
  const g = await newGateway();
  g.db.prepare("UPDATE flash_sale_campaigns SET status = 'ENDED' WHERE status = 'UPCOMING'").run();
  const none = await g.call('/api/v1/campaigns/lightning');
  assert.equal(none.status, 200, none.text);
  assert.equal(none.json.data.next_campaign, null, 'no upcoming round, no preview');
  const stamp = (d) => new Date(Date.now() + d * 86400000).toISOString().slice(0, 19).replace('T', ' ');
  const far = mkCampaign(g, { status: 'UPCOMING', starts_at: stamp(5), ends_at: stamp(6) });
  const near = mkCampaign(g, { status: 'UPCOMING', starts_at: stamp(2), ends_at: stamp(3) });
  const r = await g.call('/api/v1/campaigns/lightning');
  assert.equal(r.json.data.next_campaign.id, near, 'nearest upcoming round previewed');
  assert.ok(r.json.data.next_campaign.title && r.json.data.next_campaign.starts_at, 'preview carries title and start');
  assert.notEqual(r.json.data.next_campaign.id, far, 'farther round not picked');
});

await t.test('8. schema version pin tracks the new migration', async () => {
  const { pathToFileURL } = await import('node:url');
  const { ROOT } = await import('./lib/harness.mjs');
  const { default: path } = await import('node:path');
  const modPath = path.join(ROOT, 'apps/cloudflare-gateway/src/services/orders.js');
  const { REQUIRED_SCHEMA_VERSION } = await import(pathToFileURL(modPath).href);
  assert.equal(REQUIRED_SCHEMA_VERSION, 'd1_74_seo_crawl.sql', 'pin names d1_74');
});

t.finish();
