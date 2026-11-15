// tests/catalog_media_notice_test.mjs
// Work order 2-1: product images, category columns, notice templates.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createGateway, createRunner, ROOT, MIGRATIONS_DIR } from './lib/harness.mjs';

const t = createRunner('Catalog media and notice (2-1)');
const HERE = path.dirname(fileURLToPath(import.meta.url));

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

await t.test('1. product_images enforces one row per product and order', async () => {
  const g = await newGateway();
  const cols = columns(g.db, 'product_images');
  for (const c of ['id', 'product_id', 'image_url', 'alt_text', 'sort_order', 'width', 'height', 'created_at']) {
    assert.ok(cols.includes(c), `product_images has ${c}`);
  }
  const prod = g.db.prepare('SELECT id FROM products LIMIT 1').get();
  assert.ok(prod, 'a product exists to attach images to');
  g.db.prepare(
    "INSERT INTO product_images (id, product_id, image_url, alt_text, sort_order) VALUES ('timg_1', ?, 'https://x/y.png', 'a', 1)"
  ).run(prod.id);
  assert.throws(() => {
    g.db.prepare(
      "INSERT INTO product_images (id, product_id, image_url, alt_text, sort_order) VALUES ('timg_2', ?, 'https://x/z.png', 'b', 1)"
    ).run(prod.id);
  }, 'duplicate sort_order per product is rejected');
  assert.throws(() => {
    g.db.prepare(
      "INSERT INTO product_images (id, product_id, image_url, alt_text, sort_order) VALUES ('timg_3', ?, 'https://x/w.png', 'c', 10)"
    ).run(prod.id);
  }, 'sort_order above 9 is rejected');
});

await t.test('2. representative thumbnails migrate to order 0', async () => {
  const g = await newGateway();
  const withThumb = g.db.prepare(
    "SELECT COUNT(*) AS n FROM products WHERE thumbnail_url IS NOT NULL AND thumbnail_url != ''"
  ).get().n;
  assert.ok(withThumb > 0, 'seed products carry thumbnails to migrate');
  const moved = g.db.prepare('SELECT COUNT(*) AS n FROM product_images WHERE sort_order = 0').get().n;
  assert.equal(moved, withThumb, 'migrated image count equals products with a thumbnail');
  const mismatch = g.db.prepare(
    `SELECT COUNT(*) AS n FROM product_images i JOIN products p ON p.id = i.product_id
     WHERE i.sort_order = 0 AND i.image_url != p.thumbnail_url`
  ).get().n;
  assert.equal(mismatch, 0, 'every migrated row matches its product thumbnail');
});

await t.test('3. categories and products carry the new columns', async () => {
  const g = await newGateway();
  for (const c of ['icon_key', 'commission_rate_bps', 'notice_template_id']) {
    assert.ok(columns(g.db, 'categories').includes(c), `categories has ${c}`);
  }
  for (const c of ['notice_template_id', 'notice_template_version']) {
    assert.ok(columns(g.db, 'products').includes(c), `products has ${c}`);
  }
});

await t.test('4. notice templates ship without seed rows', async () => {
  const g = await newGateway();
  const cols = columns(g.db, 'notice_templates');
  for (const c of ['id', 'name', 'items_json', 'version', 'is_active', 'created_at', 'updated_at']) {
    assert.ok(cols.includes(c), `notice_templates has ${c}`);
  }
  const n = g.db.prepare('SELECT COUNT(*) AS n FROM notice_templates').get().n;
  assert.equal(n, 0, 'no template seed rows; the operator enters statute text');
  g.db.prepare(
    "INSERT INTO notice_templates (id, name, items_json, version) VALUES ('nt_test', 't', '[{\"key\":\"k\"}]', 1)"
  ).run();
  const back = g.db.prepare('SELECT items_json FROM notice_templates WHERE id = ?').get('nt_test');
  assert.equal(JSON.parse(back.items_json)[0].key, 'k', 'template items round-trip');
});

await t.test('5. product detail returns images, template and input values', async () => {
  const g = await newGateway();
  g.db.prepare(
    "INSERT INTO notice_templates (id, name, items_json, version) VALUES ('nt_tv', 'tv', '[{\"key\":\"model\",\"name\":\"모델명\",\"required\":1,\"detail_ref_allowed\":0}]', 2)"
  ).run();
  g.db.prepare(
    "UPDATE products SET notice_template_id = 'nt_tv', notice_template_version = 2, notice_info_json = '{\"model\":\"X1\"}' WHERE id = 'prod_001'"
  ).run();
  const r = await g.call('/api/v1/products/prod_001');
  assert.equal(r.status, 200);
  assert.ok(Array.isArray(r.json.data.images), 'detail carries the images list');
  assert.ok(r.json.data.images.length > 0, 'migrated thumbnail is listed');
  assert.equal(r.json.data.images[0].sort_order, 0, 'representative image sorts first');
  assert.equal(r.json.data.notice_template.id, 'nt_tv', 'linked template is returned');
  assert.equal(JSON.parse(r.json.data.notice_template.items_json)[0].key, 'model', 'template items are returned');
  assert.equal(r.json.data.notice_values.model, 'X1', 'stored input values are returned');
});

await t.test('6. category template applies when the product names none', async () => {
  const g = await newGateway();
  g.db.prepare("INSERT INTO notice_templates (id, name, items_json, version) VALUES ('nt_cat', 'c', '[]', 1)").run();
  const cat = g.db.prepare('SELECT category_id FROM products WHERE id = ?').get('prod_002').category_id;
  g.db.prepare('UPDATE categories SET notice_template_id = ? WHERE id = ?').run('nt_cat', cat);
  const r = await g.call('/api/v1/products/prod_002');
  assert.equal(r.status, 200);
  assert.equal(r.json.data.notice_template.id, 'nt_cat', 'category template is the fallback');
});

await t.test('7. migration data moves are rerun-safe', async () => {
  const g = await newGateway();
  const before = g.db.prepare('SELECT COUNT(*) AS n FROM product_images').get().n;
  const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, 'd1_53_catalog_media_notice.sql'), 'utf-8');
  // SQLite ALTERs are single-apply by design (repo-wide convention; the FK
  // rehearsal covers first-apply). The rerunnable statements must be no-ops.
  const rerunnable = sql.split(';').filter((s) => /^\s*(CREATE|INSERT)/i.test(s)).join(';');
  g.db.exec(rerunnable);
  const after = g.db.prepare('SELECT COUNT(*) AS n FROM product_images').get().n;
  assert.equal(after, before, 'rerun adds no rows');
  const mig = g.db.prepare('SELECT version FROM schema_migrations WHERE version = ?')
    .get('d1_53_catalog_media_notice.sql');
  assert.ok(mig, 'schema_migrations records d1_53');
});

await t.test('8. schema version pin tracks the new migration', async () => {
  const modPath = path.join(ROOT, 'apps/cloudflare-gateway/src/services/orders.js');
  const { REQUIRED_SCHEMA_VERSION } = await import(pathToFileURL(modPath).href);
  assert.equal(REQUIRED_SCHEMA_VERSION, 'd1_65_category_banned_words.sql', 'pin names d1_65');
});

t.finish();
