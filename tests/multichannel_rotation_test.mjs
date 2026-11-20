// tests/multichannel_rotation_test.mjs
// Phase 2 multichannel distribution + rotation: channel adapters fail closed
// without keys (Zero-Mock), PCCC util validates, elite gates margin/notice,
// 30-day rotation retires idle listings, 15-min delta never fakes sync.

import assert from 'node:assert/strict';
import { createDatabase, createD1, createGateway, createRunner } from './lib/harness.mjs';
import { getChannel, listChannels } from '../apps/cloudflare-gateway/src/services/channels/channel.js';
import '../apps/cloudflare-gateway/src/services/channels/smartstore-adapter.js';
import '../apps/cloudflare-gateway/src/services/channels/coupang-adapter.js';
import { ceaHeader } from '../apps/cloudflare-gateway/src/services/channels/coupang-adapter.js';
import { normalizePccc, validatePccc } from '../apps/cloudflare-gateway/src/lib/pccc.js';
import { marginBps, selectEliteCandidates } from '../apps/cloudflare-gateway/src/services/channels/elite.js';
import { runRotation } from '../apps/cloudflare-gateway/src/services/channels/rotation.js';
import { runDeltaSync } from '../apps/cloudflare-gateway/src/services/channels/delta.js';

const t = createRunner('Multichannel Rotation');

const utc = (ms) => new Date(ms).toISOString().slice(0, 19).replace('T', ' ');
const daysAgo = (d) => utc(Date.now() - d * 86400 * 1000);
const minsAgo = (m) => utc(Date.now() - m * 60 * 1000);

function freshEnv() {
  const db = createDatabase();
  const partner = db.prepare('SELECT id FROM partners LIMIT 1').get().id;
  const category = db.prepare('SELECT id FROM categories LIMIT 1').get().id;
  return { db, env: { DB: createD1(db) }, partner, category };
}

function addOffer(db, o) {
  db.prepare(`INSERT INTO sourcing_offers (id, provider, external_id, title, cost_krw, currency, stock_qty, status, channel_quotes_json)
    VALUES (?, 'domeme', ?, ?, ?, 'KRW', ?, ?, ?)`)
    .run(o.id, o.id, o.title || 't', o.cost, o.stock || 5, o.status || 'APPROVED', o.quotes === undefined ? null : o.quotes);
}

function addProduct(db, partner, category, p) {
  db.prepare(`INSERT INTO products (id, partner_id, category_id, title, thumbnail_url, description_html,
      lowest_original_price, lowest_sale_price, total_sold_count, status, notice_template_id)
    VALUES (?, ?, ?, ?, 'https://cdn.invalid/t.jpg', 'd', 20000, 15000, ?, 'ACTIVE', ?)`)
    .run(p.id, partner, category, p.title || 'p', p.sold || 0, p.notice === undefined ? null : p.notice);
}

function addListing(db, l) {
  db.prepare(`INSERT INTO sourcing_channel_listings (id, offer_id, product_id, channel, external_listing_id, status, margin_bps, last_sale_at, synced_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(l.id, l.offer, l.product || null, l.channel || 'smartstore', l.ext === undefined ? null : l.ext,
      l.status || 'LIVE', l.bps === undefined ? null : l.bps, l.sold_at === undefined ? null : l.sold_at,
      l.synced === undefined ? null : l.synced, l.created || utc(Date.now()));
}

await t.test('registry exposes the smartstore and coupang adapters', () => {
  assert.deepEqual([...listChannels()].sort(), ['coupang', 'smartstore']);
});

await t.test('adapters fail closed without credentials (Zero-Mock)', async () => {
  for (const name of listChannels()) {
    const a = getChannel(name);
    assert.equal(a.keyStatus({}).configured, false);
    await assert.rejects(() => a.publish({}, { title: 'x' }), /CHANNEL_NOT_CONFIGURED/);
    await assert.rejects(() => a.updateStock({}, 'EXT-1', 3), /CHANNEL_NOT_CONFIGURED/);
    await assert.rejects(() => a.retire({}, 'EXT-1'), /CHANNEL_NOT_CONFIGURED/);
  }
  const header = await ceaHeader('secret', 'KEY1', 'POST', '/p', '');
  assert.ok(header.startsWith('CEA algorithm=HmacSHA256, access-key=KEY1, signed-date='));
});

await t.test('pccc util normalizes and validates the P+12 format', () => {
  assert.equal(normalizePccc(' p1234-56789012 '), 'P123456789012');
  assert.equal(validatePccc('P123456789012').ok, true);
  assert.equal(validatePccc('').code, 'MISSING_PCCC');
  assert.equal(validatePccc('P123').code, 'INVALID_PCCC_FORMAT');
  assert.equal(validatePccc('X123456789012').code, 'INVALID_PCCC_FORMAT');
});

await t.test('elite gates margin 15% and orders best-first', async () => {
  const { db, env, partner, category } = freshEnv();
  addOffer(db, { id: 'o_e1', cost: 10000, quotes: JSON.stringify({ smartstore: 12000 }) });
  addOffer(db, { id: 'o_e2', cost: 10000, quotes: JSON.stringify({ smartstore: 11500 }) });
  addOffer(db, { id: 'o_thin', cost: 10000, quotes: JSON.stringify({ smartstore: 11000 }) });
  addOffer(db, { id: 'o_noq', cost: 10000 });
  addOffer(db, { id: 'o_pend', cost: 10000, status: 'PENDING', quotes: JSON.stringify({ smartstore: 13000 }) });
  addProduct(db, partner, category, { id: 'p_best', sold: 99, notice: 'nt1' });
  addListing(db, { id: 'cl_link', offer: 'o_e1', product: 'p_best', status: 'LIVE', sold_at: daysAgo(2) });
  assert.equal(marginBps(10000, 11500), 1500);
  assert.equal(marginBps(0, 11500), null);
  const cands = await selectEliteCandidates(env, 'smartstore', {});
  assert.deepEqual(cands.map((c) => c.offer_id), ['o_e1', 'o_e2']);
  assert.equal(cands[0].notice_ok, true);
  assert.equal(cands[1].notice_ok, null);
});

await t.test('rotation retires 30-day idle listings only', async () => {
  const { db, env } = freshEnv();
  for (const id of ['o_r1', 'o_r2', 'o_r3', 'o_r4']) addOffer(db, { id, cost: 1000 });
  addListing(db, { id: 'cl_idle', offer: 'o_r1', sold_at: daysAgo(31) });
  addListing(db, { id: 'cl_fresh', offer: 'o_r2', sold_at: daysAgo(5) });
  addListing(db, { id: 'cl_new', offer: 'o_r3' });
  addListing(db, { id: 'cl_paused', offer: 'o_r4', status: 'PAUSED', sold_at: daysAgo(60) });
  const dry = await runRotation(env, { dryRun: true });
  assert.deepEqual(dry.ids, ['cl_idle']);
  assert.equal(dry.rotated, 0);
  assert.equal(db.prepare("SELECT status FROM sourcing_channel_listings WHERE id = 'cl_idle'").get().status, 'LIVE');
  const live = await runRotation(env, {});
  assert.equal(live.rotated, 1);
  assert.equal(db.prepare("SELECT status FROM sourcing_channel_listings WHERE id = 'cl_idle'").get().status, 'ROTATED_OUT');
  assert.equal(db.prepare("SELECT status FROM sourcing_channel_listings WHERE id = 'cl_fresh'").get().status, 'LIVE');
});

await t.test('delta sync reports degraded without keys, never fakes synced_at', async () => {
  const { db, env } = freshEnv();
  for (const id of ['o_d1', 'o_d2', 'o_d3', 'o_d4']) addOffer(db, { id, cost: 1000 });
  const staleAt = minsAgo(20);
  addListing(db, { id: 'cl_stale', offer: 'o_d1', ext: 'EXT-1', synced: staleAt, sold_at: daysAgo(1) });
  addListing(db, { id: 'cl_never', offer: 'o_d2', ext: 'EXT-2', sold_at: daysAgo(1) });
  addListing(db, { id: 'cl_noext', offer: 'o_d3', sold_at: daysAgo(1) });
  addListing(db, { id: 'cl_synced', offer: 'o_d4', ext: 'EXT-4', synced: minsAgo(2), sold_at: daysAgo(1) });
  const r = await runDeltaSync(env, {});
  assert.equal(r.window_min, 15);
  assert.equal(r.checked, 3);
  assert.equal(r.synced, 0);
  assert.deepEqual(r.failed.map((f) => f.code).sort(), ['CHANNEL_NOT_CONFIGURED', 'CHANNEL_NOT_CONFIGURED', 'LISTING_NOT_PUBLISHED']);
  assert.equal(db.prepare("SELECT synced_at FROM sourcing_channel_listings WHERE id = 'cl_stale'").get().synced_at, staleAt);
});

await t.test('catalog/full paginates with an advancing cursor', async () => {
  const g = await createGateway();
  const first = await g.call('/api/v1/catalog/full?per_page=2');
  assert.equal(first.status, 200, first.text);
  assert.ok(Array.isArray(first.json.data) && first.json.data.length <= 2);
  assert.equal(typeof first.json.pagination.total, 'number');
  if (first.json.pagination.has_more) {
    const cursor = encodeURIComponent(first.json.pagination.next_cursor);
    const second = await g.call(`/api/v1/catalog/full?per_page=2&cursor=${cursor}`);
    assert.equal(second.status, 200, second.text);
    const ids1 = new Set(first.json.data.map((r) => r.id));
    for (const row of second.json.data) assert.ok(!ids1.has(row.id), 'cursor page must not repeat rows');
  }
  const badCursor = await g.call('/api/v1/catalog/full?cursor=nope');
  assert.equal(badCursor.status, 400);
});

await t.test('admin channel endpoints exist behind the admin guard', async () => {
  const g = await createGateway();
  for (const [path, method] of [
    ['/api/v1/admin/channels/elite?channel=smartstore', 'GET'],
    ['/api/v1/admin/channels/publish', 'POST'],
    ['/api/v1/admin/channels/rotation/run', 'POST'],
    ['/api/v1/admin/channels/delta/run', 'POST'],
    ['/api/v1/admin/channels', 'GET']
  ]) {
    const r = await g.call(path, { method, body: method === 'POST' ? {} : undefined });
    assert.equal(r.status, 401, `${method} ${path}: ${r.text}`);
  }
});

t.finish();
