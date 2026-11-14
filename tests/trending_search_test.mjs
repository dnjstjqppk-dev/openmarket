// tests/trending_search_test.mjs
// Work order 2-8: trending search, recent views, price history.
import assert from 'node:assert/strict';
import { createGateway, createRunner } from './lib/harness.mjs';

const t = createRunner('Trending and search (2-8)');

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

async function trending() {
  const { pathToFileURL } = await import('node:url');
  const { ROOT } = await import('./lib/harness.mjs');
  const { default: path } = await import('node:path');
  return import(pathToFileURL(path.join(ROOT, 'apps/cloudflare-gateway/src/services/trending.js')).href);
}

function columns(db, table) {
  return db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
}

await t.test('1. hourly, banned, history tables and the views index exist', async () => {
  const g = await newGateway();
  for (const c of ['keyword', 'hour', 'search_count']) {
    assert.ok(columns(g.db, 'search_keyword_hourly').includes(c), `search_keyword_hourly has ${c}`);
  }
  assert.ok(columns(g.db, 'trending_banned_words').includes('word'), 'trending_banned_words has word');
  for (const c of ['id', 'sku_id', 'original_price', 'sale_price', 'changed_by', 'changed_at']) {
    assert.ok(columns(g.db, 'sku_price_history').includes(c), `sku_price_history has ${c}`);
  }
  const idx = g.db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_product_views_user_time'").get();
  assert.ok(idx, 'recent-views index exists');
});

await t.test('2. search logging accumulates hourly buckets', async () => {
  const g = await newGateway();
  for (let i = 0; i < 3; i++) {
    const r = await g.call('/api/v1/search/log', { method: 'POST', body: { keyword: 'HourlyWidget' } });
    assert.equal(r.status, 200, r.text);
  }
  const row = g.db.prepare("SELECT search_count FROM search_keyword_hourly WHERE keyword = 'hourlywidget'").get();
  assert.ok(row, 'hourly bucket created');
  assert.equal(row.search_count, 3, 'bucket accumulates');
});

await t.test('3. trending ranks the last day with deltas', async () => {
  const g = await newGateway();
  const { computeTrending } = await trending();
  const ins = (kw, hoursAgo, n) => g.db.prepare(
    "INSERT INTO search_keyword_hourly (keyword, hour, search_count) VALUES (?, datetime('now', ?), ?)"
  ).run(kw, `-${hoursAgo} hours`, n);
  ins('alpha', 2, 100);
  ins('alpha', 30, 10);
  ins('beta', 3, 50);
  ins('beta', 30, 200);
  ins('oldie', 30, 5);
  const top = await computeTrending(g.env);
  assert.equal(top[0].keyword, 'alpha', 'highest last-day count ranks first');
  assert.equal(top[0].delta, 1, 'alpha climbed one rank');
  const beta = top.find((r) => r.keyword === 'beta');
  assert.equal(beta.delta, -1, 'beta fell one rank');
  assert.ok(!top.find((r) => r.keyword === 'oldie'), 'prior-window-only keywords stay out');
  assert.ok(top.length <= 10, 'top ten only');
});

await t.test('4. below-minimum and banned keywords stay out', async () => {
  const g = await newGateway();
  const { computeTrending } = await trending();
  g.db.prepare("INSERT INTO platform_policies (key, value, effective_from) VALUES ('trending.min_count', '5', date('now'))").run();
  g.db.prepare("INSERT INTO search_keyword_hourly (keyword, hour, search_count) VALUES ('tiny', datetime('now'), 3)").run();
  g.db.prepare("INSERT INTO search_keyword_hourly (keyword, hour, search_count) VALUES ('blockedword', datetime('now'), 999)").run();
  g.db.prepare('INSERT INTO trending_banned_words (word) VALUES (?)').run('blockedword');
  g.db.prepare("INSERT INTO search_keyword_hourly (keyword, hour, search_count) VALUES ('shown', datetime('now'), 50)").run();
  const top = await computeTrending(g.env);
  assert.ok(!top.find((r) => r.keyword === 'tiny'), 'below-minimum excluded');
  assert.ok(!top.find((r) => r.keyword === 'blockedword'), 'banned excluded');
  assert.ok(top.find((r) => r.keyword === 'shown'), 'eligible keyword listed');
});

await t.test('5. week-old hourly rows purge', async () => {
  const g = await newGateway();
  const { purgeOldSearchHours } = await trending();
  g.db.prepare("INSERT INTO search_keyword_hourly (keyword, hour, search_count) VALUES ('stale', datetime('now', '-8 days'), 9)").run();
  g.db.prepare("INSERT INTO search_keyword_hourly (keyword, hour, search_count) VALUES ('fresh', datetime('now'), 9)").run();
  const n = await purgeOldSearchHours(g.env);
  assert.equal(n, 1, 'one stale row purged');
  assert.equal(g.db.prepare("SELECT COUNT(*) AS n FROM search_keyword_hourly WHERE keyword = 'stale'").get().n, 0, 'stale gone');
  assert.equal(g.db.prepare("SELECT COUNT(*) AS n FROM search_keyword_hourly WHERE keyword = 'fresh'").get().n, 1, 'fresh kept');
});

await t.test('6. seller price changes record history', async () => {
  const g = await newGateway();
  const login = await g.call('/api/v1/auth/login', { method: 'POST', body: { email: 'seller@temu-supply.com', password: 'DevPass!2026#', role: 'PARTNER' } });
  assert.equal(login.status, 200, login.text);
  const tok = login.json.token;
  const s = g.db.prepare(
    `SELECT s.id, s.product_id FROM product_skus s JOIN products p ON p.id = s.product_id
     WHERE p.partner_id = (SELECT partner_id FROM users WHERE email = ?) LIMIT 1`).get('seller@temu-supply.com');
  const r = await g.call(`/api/v1/partner/products/${s.product_id}/price`, {
    method: 'PUT', token: tok, body: { sku_id: s.id, sale_price: 12345 }
  });
  assert.equal(r.status, 200, r.text);
  const h = g.db.prepare('SELECT * FROM sku_price_history WHERE sku_id = ? ORDER BY changed_at DESC LIMIT 1').get(s.id);
  assert.ok(h, 'history row recorded');
  assert.equal(h.sale_price, 12345, 'new sale price kept');
  assert.ok(h.changed_by, 'changer kept');
});

await t.test('7. recent views read through the member index', async () => {
  const g = await newGateway();
  const plan = g.db.prepare(
    'EXPLAIN QUERY PLAN SELECT product_id FROM product_views WHERE user_id = ? ORDER BY viewed_at DESC LIMIT 50'
  ).all('u_customer_001');
  assert.ok(JSON.stringify(plan).includes('idx_product_views_user_time'), 'member-time index serves the query');
});

await t.test('8. schema version pin tracks the new migration', async () => {
  const { pathToFileURL } = await import('node:url');
  const { ROOT } = await import('./lib/harness.mjs');
  const { default: path } = await import('node:path');
  const modPath = path.join(ROOT, 'apps/cloudflare-gateway/src/services/orders.js');
  const { REQUIRED_SCHEMA_VERSION } = await import(pathToFileURL(modPath).href);
  assert.equal(REQUIRED_SCHEMA_VERSION, 'd1_61_claim_pickup_photos.sql', 'pin names d1_61');
});

t.finish();
