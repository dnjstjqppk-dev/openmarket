// tests/openapi_reconciliation_test.mjs
// Guards docs/openapi against implementation drift: every documented path must
// resolve to a live gateway route, and the six retired stale paths must stay
// out of the docs (and keep answering 404). Doc-driven: the path/method table
// is parsed from docs/openapi/openapi.yaml + docs/openapi/paths/*.yaml, then
// probed against a real gateway harness. See P1 OpenAPI reconcilation (2026-11-07).
//
// Auth discriminator: guarded routes run requireAuth AFTER the prefix match, so an
// unauthenticated probe answers 401 when the prefix is served at all. That proves
// documented routes exist (test 1), but dead sub-paths under /partner and /admin
// need an authenticated probe to reach the 404 fall-through (test 2).

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGateway, createRunner } from './lib/harness.mjs';

const t = createRunner('OpenAPI Reconciliation');
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

// The documented contract surface. Any docs edit that adds/removes a path must
// update this allowlist in the same commit.
const EXPECTED = [
  // [path-template, method, unauthenticated expectation]
  ['/api/v1/products', 'GET', 200],
  ['/api/v1/products/{id}', 'GET', 200],
  ['/api/v1/orders/checkout', 'POST', 401],
  ['/api/v1/campaigns/lightning', 'GET', 200],
  ['/api/v1/search/autocomplete', 'GET', 200],
  ['/api/v1/search/log', 'POST', 200],
  ['/api/v1/partner/products', 'POST', 401],
  ['/api/v1/partner/products/bulk', 'POST', 401],
  ['/api/v1/partner/orders/{id}/shipment', 'PUT', 401],
  ['/api/v1/partner/orders/bulk-shipment', 'POST', 401],
  ['/api/v1/partner/settlements', 'GET', 401],
  ['/api/v1/storage/upload', 'POST', 401],
  ['/api/v1/admin/partners/{id}/verify', 'PUT', 401],
  ['/api/v1/admin/users/{id}/reset-password', 'POST', 401],
  ['/api/v1/admin/finance/payouts', 'GET', 401],
  ['/api/v1/admin/finance/payouts', 'POST', 401]
];

// Retired 2026-11-07: documented paths with no gateway route behind them.
// [path-template, method, token role for the 404 probe (null = unauthenticated)]
const STALE = [
  ['/api/v1/home/sdui', 'GET', null],
  ['/api/v1/flash-sales/stream', 'GET', null],
  ['/api/v1/partner/media/presigned-url', 'POST', 'PARTNER'],
  ['/api/v1/partner/sub-orders/{id}/shipment', 'PATCH', 'PARTNER'],
  ['/api/v1/admin/sdui/layouts', 'PUT', 'ADMIN'],
  ['/api/v1/admin/settlements/execute', 'POST', 'ADMIN']
];

// Minimal parser for this repo's OpenAPI file layout:
// openapi.yaml holds `  /path:` keys each followed by a $ref to a paths/*.yaml
// file; each target file holds `  /path:` anchors with `    method:` operations.
function parseDocumented() {
  const index = read('docs/openapi/openapi.yaml');
  const found = [];
  const lines = index.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const key = lines[i].match(/^  (\/api\/\S+):$/);
    if (!key) continue;
    const ref = (lines[i + 1] || '').match(/\$ref: '\.\/paths\/(\S+\.yaml)#\/paths\/(\S+)'/);
    assert.ok(ref, `openapi.yaml ${key[1]} must $ref a paths/*.yaml file`);
    const target = read(`docs/openapi/paths/${ref[1]}`);
    const anchor = ref[2].replaceAll('~1', '/');
    assert.equal(anchor, key[1], `$ref anchor must equal the path key ${key[1]}`);
    const block = target.split(`\n  ${anchor}:`)[1];
    assert.ok(block, `${ref[1]} must define ${anchor}`);
    const scoped = block.split(/\n  \//)[0];
    const methods = [...scoped.matchAll(/^    (get|post|put|patch|delete):/gm)].map((m) => m[1].toUpperCase());
    assert.ok(methods.length, `${anchor} must declare at least one operation`);
    for (const m of methods) found.push([anchor, m]);
  }
  return found;
}

function probePath(template) {
  // The dev seed used by the harness carries prod_001; anything else gets a dummy id.
  if (template === '/api/v1/products/{id}') return '/api/v1/products/prod_001';
  return template.replace('{id}', 'probe-id');
}

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

await t.test('1. every documented path resolves and hits a live route', async () => {
  const documented = parseDocumented();
  assert.deepEqual(
    [...documented].sort(),
    [...EXPECTED].map(([p, m]) => [p, m]).sort(),
    'docs/openapi surface must equal the maintained allowlist'
  );
  const g = await newGateway();
  for (const [path, method, want] of EXPECTED) {
    const r = await g.call(probePath(path), { method });
    assert.equal(r.status, want, `${method} ${path} -> ${want}, got ${r.status}`);
  }
});

await t.test('2. retired stale paths stay out of the docs and answer 404', async () => {
  // Only live path keys count — historical "Retired ..." comments may name them.
  const docs = [
    'docs/openapi/openapi.yaml',
    'docs/openapi/paths/storefront.yaml',
    'docs/openapi/paths/search.yaml',
    'docs/openapi/paths/partner.yaml',
    'docs/openapi/paths/storage.yaml',
    'docs/openapi/paths/admin.yaml'
  ].map((p) => {
    try { return read(p); } catch { return ''; }
  }).join('\n');
  const liveKeys = new Set([...docs.matchAll(/^  (\/api\/\S+):$/gm)].map((m) => m[1]));
  const g = await newGateway();
  const tokens = {};
  for (const [path, method] of STALE) {
    assert.ok(!liveKeys.has(path), `docs must not document retired ${path} as a live path`);
  }
  async function tokenFor(role) {
    if (!tokens[role]) {
      const email = role === 'ADMIN' ? 'admin@openmarket.com' : 'seller@temu-supply.com';
      const login = await g.call('/api/v1/auth/login', { method: 'POST', body: { email, password: 'DevPass!2026#', role } });
      assert.equal(login.status, 200, `dev seed login for ${role} must succeed`);
      tokens[role] = login.json.token;
    }
    return tokens[role];
  }
  for (const [path, method, role] of STALE) {
    const opts = { method };
    if (role) opts.token = await tokenFor(role);
    const r = await g.call(probePath(path), opts);
    assert.equal(r.status, 404, `${method} ${path} must 404, got ${r.status}`);
  }
});

await t.test('3. documented response shapes match the implementation', async () => {
  const g = await newGateway();
  // Offset pagination (page/per_page), not cursor — see products_pagination_test for depth.
  const list = await g.call('/api/v1/products?per_page=2&page=1');
  assert.equal(list.status, 200);
  assert.equal(list.json.pagination.page, 1);
  assert.equal(list.json.pagination.per_page, 2);
  assert.ok(Number.isInteger(list.json.pagination.total));
  assert.ok(Number.isInteger(list.json.pagination.total_pages));
  // Product detail envelope.
  const detail = await g.call('/api/v1/products/prod_001');
  assert.equal(detail.status, 200);
  assert.ok(Array.isArray(detail.json.data.skus));
  assert.ok(Array.isArray(detail.json.data.attributes));
  assert.ok(Array.isArray(detail.json.data.volume_discounts));
  // Lightning campaign feed (the honest replacement for the retired SSE stream doc).
  const deals = await g.call('/api/v1/campaigns/lightning');
  assert.equal(deals.status, 200);
  assert.ok(Array.isArray(deals.json.items));
  assert.ok(deals.json.data && Array.isArray(deals.json.data.deals));
  // Checkout alias documented alongside /orders/checkout.
  const alias = await g.call('/api/v1/orders', { method: 'POST' });
  assert.equal(alias.status, 401);
});

t.finish();
