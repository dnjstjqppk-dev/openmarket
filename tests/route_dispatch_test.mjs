// tests/route_dispatch_test.mjs
// CPU: first-segment router dispatch (apps/cloudflare-gateway/src/route-table.js)
// must answer exactly like the old "call every router in order" scan, while
// invoking only the routers whose prefixes can match.
// Run: node tests/route_dispatch_test.mjs (requires: node scripts/gen-dev-seed.mjs once)
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createGateway, createRunner, ROOT } from './lib/harness.mjs';
import { ROUTE_TABLE, routersFor, API_PREFIX } from '../apps/cloudflare-gateway/src/route-table.js';
import { buildCorsHeaders, errorResponse } from '../apps/cloudflare-gateway/src/lib/http.js';

const t = createRunner('Router dispatch (CPU)');
const ROUTES_DIR = join(ROOT, 'apps/cloudflare-gateway/src/routes');
const src = (file) => readFileSync(join(ROUTES_DIR, `${file}.js`), 'utf8');
const BS = String.fromCharCode(92);
const unescape = (s) => s.split(`${BS}/`).join('/');
const SEG_RE = /(?:\/|\\\/)api(?:\/|\\\/)v1(?:\/|\\\/)([A-Za-z0-9_.-]+)/g;
const PRE_TABLE = new Set(['seo']); // served by handleSeoRoutes before the table

await t.test('D01 every router file is in the table exactly once, with its exported handler', async () => {
  const files = readdirSync(ROUTES_DIR).filter((f) => f.endsWith('.js')).map((f) => f.slice(0, -3)).filter((f) => !PRE_TABLE.has(f));
  const inTable = ROUTE_TABLE.map((r) => r.file);
  assert.deepEqual([...inTable].sort(), [...files].sort(), 'table files = route files');
  assert.equal(new Set(inTable).size, inTable.length, 'no duplicates');
  for (const r of ROUTE_TABLE) {
    const mod = await import(`../apps/cloudflare-gateway/src/routes/${r.file}.js`);
    assert.ok(Object.values(mod).includes(r.handler), `${r.file}: handler is exported by its file`);
  }
});

await t.test('D02 every /api/v1/<seg> literal in a router file is covered by its prefixes', () => {
  for (const r of ROUTE_TABLE) {
    const segments = new Set([...src(r.file).matchAll(SEG_RE)].map((m) => m[1]));
    assert.ok(segments.size > 0, `${r.file}: has path literals`);
    for (const seg of segments) {
      assert.ok(r.prefixes.some((p) => seg.startsWith(p)), `${r.file}: '/api/v1/${seg}' not covered by [${r.prefixes}]`);
    }
  }
});

await t.test('D03 path tests are anchored at /api/v1 (no includes/endsWith/unanchored regex on api paths)', () => {
  for (const r of ROUTE_TABLE) {
    const text = src(r.file);
    for (const m of text.matchAll(/\/(\^?)\\\/api\\\/v1/g)) {
      assert.equal(m[1], '^', `${r.file}: unanchored /api/v1 regex at offset ${m.index}`);
    }
    assert.ok(!/\.(includes|endsWith|indexOf)\(\s*['"`]\/api\/v1/.test(text), `${r.file}: substring match on an /api/v1 path`);
  }
});

// Path corpus: every literal/regex path in the routers + the OpenAPI paths + junk.
function corpus() {
  const paths = new Set(['/api/v1', '/api/v1/', '/api/v1/admin-x', '/api/v1/partners2', '/api/v1/partner-applications',
    '/api/v1/unknown/a', '/api/v2/products', '/wp-login.php', '/', '/api/v1/products/x1/reviews', '/api/v1/addresses/x1/default']);
  const fill = (p) => p
    .replace(/\(\?:[^)]*\)/g, 'x1')
    .replace(/\([^)]*\)/g, 'x1')
    .replace(/\[[^\]]*\][+*]?/g, 'x1')
    .replace(/\$\{[^}]*\}/g, 'x1')
    .replace(/[$^?]/g, '')
    .replace(/\\d\+?/g, '1');
  for (const r of ROUTE_TABLE) {
    const text = src(r.file);
    for (const m of text.matchAll(/['"`](\/api\/v1\/[^'"`\s]*)['"`]/g)) paths.add(fill(m[1]));
    for (const m of text.matchAll(/\/\^(\\\/api\\\/v1[^\s]*?)\$?\/[gimsuy]*[.)\s,;]/g)) paths.add(fill(unescape(m[1])));
  }
  const oa = join(ROOT, 'docs/openapi/paths');
  for (const f of readdirSync(oa)) {
    for (const m of readFileSync(join(oa, f), 'utf8').matchAll(/^\s{0,2}['"]?(\/api\/v1\/[^:'"\s]*)['"]?:\s*$/gm)) {
      paths.add(m[1].replace(/\{[^}]+\}/g, 'x1'));
    }
  }
  return [...paths].filter((p) => p.length < 300);
}

await t.test('D04 dispatched routing == full ordered scan for the whole path corpus', async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('network disabled in dispatch test'); };
  try {
    const g = await createGateway({
      seedFiles: ['migrations/dev/seed_local_dev.sql'],
      env: { JWT_SECRET: 'test-jwt-secret-0123456789abcdefghijklmnop', ENVIRONMENT: 'test', PAYMENT_MODE: 'sandbox' }
    });
    const login = async (email, role) => {
      const r = await g.call('/api/v1/auth/login', { method: 'POST', body: { email, password: 'DevPass!2026#', role } });
      assert.equal(r.status, 200, `login ${email}`);
      return r.json.token;
    };
    const tokens = [null, await login('customer@example.com', 'CUSTOMER'), await login('seller@temu-supply.com', 'PARTNER'), await login('admin@openmarket.com', 'ADMIN')];
    const ctx = { waitUntil() {}, passThroughOnException() {} };

    // Returns [index of the answering router (-1 = none), status, code].
    const run = async (handlers, path, method, token) => {
      const headers = { 'Content-Type': 'application/json' };
      if (token) headers.Authorization = `Bearer ${token}`;
      const req = new Request(`https://api.test.local${path}`, { method, headers, body: method === 'GET' || method === 'DELETE' ? undefined : '{}' });
      const url = new URL(req.url);
      const cors = buildCorsHeaders(req, g.env);
      let idx = -1;
      try {
        for (const h of handlers) {
          idx = ROUTE_TABLE.findIndex((r) => r.handler === h);
          const res = await h(req, url, g.env, cors, ctx);
          if (res) return [idx, res.status, ''];
        }
        return [-1, 404, ''];
      } catch (err) {
        const res = errorResponse(cors, err, g.env, { request: req, ctx });
        return [idx, res.status, JSON.parse(await res.text()).code || ''];
      }
    };
    const all = ROUTE_TABLE.map((r) => r.handler);
    const paths = corpus();
    if (process.env.DISPATCH_DEBUG) console.log(paths.join('\n'));
    assert.ok(paths.length > 300, `corpus is broad (${paths.length})`);
    let checks = 0;
    let skipped = 0;
    const mismatches = [];
    for (const path of paths) {
      const plans = [['GET', 0], ['GET', 1], ['GET', 2], ['GET', 3], ['POST', 0], ['PUT', 0], ['PATCH', 0], ['DELETE', 0]];
      for (const [method, ti] of plans) {
        const full = await run(all, path, method, tokens[ti]);
        const routed = await run(routersFor(path), path, method, tokens[ti]);
        checks++;
        const same = full[0] === routed[0] && full[1] === routed[1] && full[2] === routed[2];
        if (!same) {
          mismatches.push(`${method} ${path} tok${ti}: full=${full} routed=${routed}`);
        }
        if (full[0] === -1) skipped++;
      }
    }
    assert.deepEqual(mismatches.slice(0, 20), [], `${mismatches.length} mismatches`);
    console.log(`       ${checks} request checks over ${paths.length} paths (${skipped} unrouted in both)`);
  } finally {
    globalThis.fetch = realFetch;
  }
});

await t.test('D05 dispatch skips unrelated routers (the CPU point)', () => {
  const n = (p) => routersFor(p).length;
  assert.equal(n('/wp-login.php'), 0);
  assert.equal(n('/api/v1/nope'), 0);
  assert.ok(n('/api/v1/products') <= 5, `products: ${n('/api/v1/products')}`);
  assert.ok(n('/api/v1/categories') <= 2);
  assert.ok(n('/api/v1/admin/dashboard') < ROUTE_TABLE.length);
  assert.ok(routersFor('/api/v1/admin/dashboard').includes(ROUTE_TABLE.find((r) => r.file === 'admin').handler));
  assert.ok(API_PREFIX === '/api/v1/');
});

await t.test('D06 the gateway 404s unknown and non-API paths without running routers', async () => {
  const g = await createGateway({ env: { JWT_SECRET: 'test-jwt-secret-0123456789abcdefghijklmnop', ENVIRONMENT: 'test' } });
  for (const p of ['/api/v1/nope', '/wp-login.php', '/api/v2/x']) {
    const r = await g.call(p);
    assert.equal(r.status, 404, p);
    assert.equal(r.json.code, 'ROUTE_NOT_FOUND', p);
  }
});

t.finish();
