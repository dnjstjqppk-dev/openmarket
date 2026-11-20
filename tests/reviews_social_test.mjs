// tests/reviews_social_test.mjs
// Work order 2-5: review votes/replies/reports, stored ratings, follows, restock.
import assert from 'node:assert/strict';
import { createGateway, createRunner } from './lib/harness.mjs';

const t = createRunner('Reviews and social (2-5)');

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

function columns(db, table) {
  return db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
}

function mkReview(g, productId, rating, userId = 'u_customer_001') {
  const id = `rv_${Math.random().toString(36).slice(2, 10)}`;
  g.db.prepare(`INSERT INTO product_reviews (id, product_id, user_id, reviewer_name, rating, content)
    VALUES (?, ?, ?, 't', ?, 'x')`).run(id, productId, userId, rating);
  return id;
}

await t.test('1. review engagement and social tables exist', async () => {
  const g = await newGateway();
  for (const c of ['id', 'review_id', 'user_id', 'created_at']) {
    assert.ok(columns(g.db, 'review_helpful_votes').includes(c), `review_helpful_votes has ${c}`);
  }
  for (const c of ['id', 'review_id', 'partner_id', 'body', 'created_at', 'updated_at']) {
    assert.ok(columns(g.db, 'review_replies').includes(c), `review_replies has ${c}`);
  }
  for (const c of ['id', 'review_id', 'reporter_user_id', 'reason', 'created_at']) {
    assert.ok(columns(g.db, 'review_reports').includes(c), `review_reports has ${c}`);
  }
  for (const c of ['visibility', 'blind_reason']) {
    assert.ok(columns(g.db, 'product_reviews').includes(c), `product_reviews has ${c}`);
  }
  for (const c of ['avg_rating_x10', 'review_count']) {
    assert.ok(columns(g.db, 'products').includes(c), `products has ${c}`);
  }
  for (const c of ['id', 'user_id', 'partner_id', 'created_at']) {
    assert.ok(columns(g.db, 'store_follows').includes(c), `store_follows has ${c}`);
  }
  for (const c of ['partner_id', 'logo_url', 'banner_url', 'intro', 'notice', 'featured_product_ids_json']) {
    assert.ok(columns(g.db, 'partner_store_profiles').includes(c), `partner_store_profiles has ${c}`);
  }
  for (const c of ['id', 'user_id', 'sku_id', 'notified_at', 'created_at']) {
    assert.ok(columns(g.db, 'restock_subscriptions').includes(c), `restock_subscriptions has ${c}`);
  }
});

await t.test('2. votes, replies and reports enforce their rules', async () => {
  const g = await newGateway();
  const prod = g.db.prepare("SELECT id FROM products WHERE status = 'ACTIVE' LIMIT 1").get().id;
  const rev = { id: mkReview(g, prod, 5) };
  g.db.prepare('INSERT INTO review_helpful_votes (id, review_id, user_id) VALUES (?, ?, ?)')
    .run('vh_1', rev.id, 'u_customer_001');
  assert.throws(() => {
    g.db.prepare('INSERT INTO review_helpful_votes (id, review_id, user_id) VALUES (?, ?, ?)')
      .run('vh_2', rev.id, 'u_customer_001');
  }, 'duplicate helpful vote is rejected');
  const pid = g.db.prepare("SELECT id FROM partners WHERE status = 'APPROVED' LIMIT 1").get().id;
  g.db.prepare('INSERT INTO review_replies (id, review_id, partner_id, body) VALUES (?, ?, ?, ?)')
    .run('vr_1', rev.id, pid, '감사합니다.');
  assert.throws(() => {
    g.db.prepare('INSERT INTO review_replies (id, review_id, partner_id, body) VALUES (?, ?, ?, ?)')
      .run('vr_2', rev.id, pid, '두 번째 답글');
  }, 'second seller reply is rejected');
  assert.throws(() => {
    g.db.prepare('INSERT INTO review_reports (id, review_id, reporter_user_id, reason) VALUES (?, ?, ?, ?)')
      .run('vrp_1', rev.id, 'u_customer_001', 'SPAM');
  }, 'unknown report reason is rejected');
  g.db.prepare('INSERT INTO review_reports (id, review_id, reporter_user_id, reason) VALUES (?, ?, ?, ?)')
    .run('vrp_1', rev.id, 'u_customer_001', 'AD');
  assert.throws(() => {
    g.db.prepare('INSERT INTO review_reports (id, review_id, reporter_user_id, reason) VALUES (?, ?, ?, ?)')
      .run('vrp_2', rev.id, 'u_customer_001', 'AD');
  }, 'duplicate report by the same reporter is rejected');
});

await t.test('3. reply bodies stay within 2000 characters', async () => {
  const g = await newGateway();
  const prod = g.db.prepare("SELECT id FROM products WHERE status = 'ACTIVE' LIMIT 1").get().id;
  const rev = { id: mkReview(g, prod, 4) };
  const pid = g.db.prepare("SELECT id FROM partners WHERE status = 'APPROVED' LIMIT 1").get().id;
  assert.throws(() => {
    g.db.prepare('INSERT INTO review_replies (id, review_id, partner_id, body) VALUES (?, ?, ?, ?)')
      .run('vr_long', rev.id, pid, 'x'.repeat(2001));
  }, 'overlong reply is rejected');
});

await t.test('4. stored ratings match the visible reviews', async () => {
  const g = await newGateway();
  const rows = g.db.prepare('SELECT id, avg_rating_x10, review_count FROM products').all();
  assert.ok(rows.length > 0, 'products exist');
  for (const p of rows) {
    const agg = g.db.prepare(
      `SELECT COUNT(*) AS n, CASE WHEN COUNT(*) = 0 THEN NULL ELSE CAST(ROUND(AVG(rating) * 10) AS INTEGER) END AS a
       FROM product_reviews WHERE product_id = ? AND visibility = 'VISIBLE'`
    ).get(p.id);
    assert.equal(p.review_count, agg.n, `${p.id} review count matches`);
    assert.equal(p.avg_rating_x10, agg.a, `${p.id} average matches`);
  }
});

await t.test('5. writing and blinding a review refresh the aggregates', async () => {
  const g = await newGateway();
  const before = g.db.prepare('SELECT avg_rating_x10, review_count FROM products WHERE id = ?').get('prod_001');
  g.db.prepare(`INSERT INTO product_reviews (id, product_id, user_id, reviewer_name, rating, content)
    VALUES ('rv_new', 'prod_001', 'u_customer_001', 't', 5, 'x')`).run();
  const afterWrite = g.db.prepare('SELECT avg_rating_x10, review_count FROM products WHERE id = ?').get('prod_001');
  assert.equal(afterWrite.review_count, (before.review_count || 0) + 1, 'count grows on write');
  g.db.prepare("UPDATE product_reviews SET visibility = 'BLIND', blind_reason = 't' WHERE id = 'rv_new'").run();
  const afterBlind = g.db.prepare('SELECT avg_rating_x10, review_count FROM products WHERE id = ?').get('prod_001');
  assert.equal(afterBlind.review_count, before.review_count || 0, 'blind removes the review from aggregates');
  assert.equal(afterBlind.avg_rating_x10, before.avg_rating_x10, 'average restores after blind');
});

await t.test('6. product list sorts by rating and review count', async () => {
  const g = await newGateway();
  const prods = g.db.prepare("SELECT id FROM products WHERE status = 'ACTIVE' LIMIT 3").all().map((r) => r.id);
  mkReview(g, prods[0], 5);
  mkReview(g, prods[0], 5);
  mkReview(g, prods[1], 3);
  const byRating = await g.call('/api/v1/products?sort=rating&per_page=50');
  assert.equal(byRating.status, 200, byRating.text);
  const ratings = byRating.json.data.map((p) => p.avg_rating);
  const vals = ratings.filter((r) => r != null);
  assert.ok(vals.length > 0, 'rated products exist');
  for (let i = 1; i < ratings.length; i++) {
    if (ratings[i] != null && ratings[i - 1] != null) assert.ok(ratings[i - 1] >= ratings[i], 'rating sorts descending');
  }
  const byReviews = await g.call('/api/v1/products?sort=reviews&per_page=50');
  assert.equal(byReviews.status, 200, byReviews.text);
  const counts = byReviews.json.data.map((p) => p.review_count);
  for (let i = 1; i < counts.length; i++) assert.ok(counts[i - 1] >= counts[i], 'review count sorts descending');
});

await t.test('7. follows and restock subscriptions deduplicate', async () => {
  const g = await newGateway();
  const pid = g.db.prepare("SELECT id FROM partners WHERE status = 'APPROVED' LIMIT 1").get().id;
  g.db.prepare('INSERT INTO store_follows (id, user_id, partner_id) VALUES (?, ?, ?)').run('sf_1', 'u_customer_001', pid);
  assert.throws(() => {
    g.db.prepare('INSERT INTO store_follows (id, user_id, partner_id) VALUES (?, ?, ?)').run('sf_2', 'u_customer_001', pid);
  }, 'duplicate follow is rejected');
  const sku = g.db.prepare('SELECT s.id FROM product_skus s JOIN products p ON p.id = s.product_id WHERE p.status = ? LIMIT 1').get('ACTIVE').id;
  g.db.prepare('INSERT INTO restock_subscriptions (id, user_id, sku_id) VALUES (?, ?, ?)').run('rs_1', 'u_customer_001', sku);
  assert.throws(() => {
    g.db.prepare('INSERT INTO restock_subscriptions (id, user_id, sku_id) VALUES (?, ?, ?)').run('rs_2', 'u_customer_001', sku);
  }, 'duplicate restock subscription is rejected');
  g.db.prepare('INSERT INTO partner_store_profiles (partner_id, intro, notice) VALUES (?, ?, ?)').run(pid, 'i', 'n');
  assert.throws(() => {
    g.db.prepare('INSERT INTO partner_store_profiles (partner_id, intro) VALUES (?, ?)').run(pid, 'x'.repeat(1001));
  }, 'overlong intro is rejected');
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
