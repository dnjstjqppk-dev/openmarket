// tests/p2_wave_k_test.mjs
// Wave K: audit-residual sweep (REMAINING/FULL_AUDIT leftovers).
//   K-1  P2-R1 leg: checkout/quote refuse with 503 SCHEMA_MISMATCH when D1
//        lags the code's schema level (fail-closed, like OPERATOR_NOT_CONFIGURED).
//   K-4  OPS-N02: UNIPASS_API_KEY documented in .env.example + wrangler.jsonc.
//   K-5  OPS-06 leg: dispatch-only remote-migrate workflow exists.
//   K-6  OPS-N05: DNS cutover rebuild checklist in DOMAIN_CONFIGURATION.md.
// K-2 (P1-D04 review/order integrity pair) extends tests/migration_fk_rehearsal.mjs;
// K-3 (OPS-10 console PWA) is covered by tests/ui/console_shell.test.mjs.
// Each behavior ships its failing test first; the suite joins `test:p1`.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createGateway, createRunner, listMigrations, ROOT } from './lib/harness.mjs';

const t = createRunner('P2 Wave K (schema guard, ops docs pins)');

async function newGateway(env = {}) {
  return createGateway({
    seedFiles: ['migrations/dev/seed_local_dev.sql'],
    env: {
      JWT_SECRET: 'e2e-secret-0123456789abcdefghijklmnopqrstu',
      ENVIRONMENT: 'development',
      CONNECTOR_SIMULATION: 'true',
      PAYMENT_MODE: 'sandbox',
      PAYMENT_WEBHOOK_SECRET: 'wh-secret-0123456789abcdef',
      ...env
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

function pickSku(g) {
  const row = g.db.prepare(
    `SELECT s.id FROM product_skus s JOIN products p ON p.id = s.product_id
     WHERE p.status = 'ACTIVE' AND s.stock_quantity > 0 LIMIT 1`
  ).get();
  assert.ok(row, 'seed has a buyable sku');
  return row.id;
}

function lagSchema(g) {
  // Simulate an operator that deployed new code without applying d1_60.
  const info = g.db.prepare("DELETE FROM schema_migrations WHERE version = 'd1_60_search_trending_recent.sql'").run();
  assert.equal(info.changes, 1, 'seeded schema ledger carries d1_60');
}

// ---------- K-1: checkout schema guard (P2-R1) ----------

await t.test('K-1.1 checkout succeeds on the current schema level (guard is pass-through)', async () => {
  const g = await newGateway();
  const cust = await login(g, 'customer@example.com');
  const o = await g.call('/api/v1/orders/checkout', {
    method: 'POST', token: cust, body: { ...addr('06236'), items: [{ sku_id: pickSku(g), quantity: 1 }] }
  });
  assert.equal(o.status, 201, o.text);
  assert.ok(o.json.order_id, 'order created');
});

await t.test('K-1.2 checkout refuses with 503 SCHEMA_MISMATCH when D1 lags the code', async () => {
  const g = await newGateway();
  lagSchema(g);
  const cust = await login(g, 'customer@example.com');
  const o = await g.call('/api/v1/orders/checkout', {
    method: 'POST', token: cust, body: { ...addr('06236'), items: [{ sku_id: pickSku(g), quantity: 1 }] }
  });
  assert.equal(o.status, 503, o.text);
  assert.equal(o.json.code, 'SCHEMA_MISMATCH');
});

await t.test('K-1.3 quote refuses the same way (dry-run shares the guard)', async () => {
  const g = await newGateway();
  lagSchema(g);
  const cust = await login(g, 'customer@example.com');
  const q = await g.call('/api/v1/orders/quote', {
    method: 'POST', token: cust, body: { ...addr('06236'), items: [{ sku_id: pickSku(g), quantity: 1 }] }
  });
  assert.equal(q.status, 503, q.text);
  assert.equal(q.json.code, 'SCHEMA_MISMATCH');
});

await t.test('K-1.4 the required version pins the newest migration file', async () => {
  const modPath = path.join(ROOT, 'apps/cloudflare-gateway/src/services/orders.js').replace(/\\/g, '/').replace(/^([A-Za-z]):/, 'file:///$1:');
  const { REQUIRED_SCHEMA_VERSION } = await import(modPath);
  assert.equal(typeof REQUIRED_SCHEMA_VERSION, 'string', 'guard version exported');
  assert.equal(REQUIRED_SCHEMA_VERSION, listMigrations().at(-1), 'pin tracks migrations/');
});

// ---------- K-4 / K-5 / K-6: ops docs pins ----------

await t.test('K-4.1 UNIPASS_API_KEY is documented for operators (OPS-N02)', async () => {
  const envExample = fs.readFileSync(path.join(ROOT, '.env.example'), 'utf8');
  assert.ok(envExample.includes('UNIPASS_API_KEY'), '.env.example documents the key');
  const wrangler = fs.readFileSync(path.join(ROOT, 'apps/cloudflare-gateway/wrangler.jsonc'), 'utf8');
  assert.ok(wrangler.includes('UNIPASS_API_KEY'), 'wrangler.jsonc comments the key');
});

await t.test('K-5.1 a dispatch-only remote-migrate workflow exists (OPS-06)', async () => {
  const wfPath = path.join(ROOT, '.github/workflows/migrate-d1-remote.yml');
  assert.ok(fs.existsSync(wfPath), 'workflow file present');
  const wf = fs.readFileSync(wfPath, 'utf8');
  assert.ok(wf.includes('workflow_dispatch'), 'manual trigger only');
  assert.ok(!/^\s*push\s*:/m.test(wf), 'never runs on push');
  assert.ok(wf.includes('d1 execute') && wf.includes('--remote'), 'applies migrations remotely');
});

await t.test('K-6.1 the DNS cutover checklist records the frontend rebuild (OPS-N05)', async () => {
  const doc = fs.readFileSync(path.join(ROOT, 'docs/DOMAIN_CONFIGURATION.md'), 'utf8');
  assert.ok(doc.includes('VITE_API_BASE_URL'), 'cutover lists the baked-in endpoints');
  assert.ok(/rebuild/i.test(doc), 'cutover requires a rebuild');
});

t.finish();
