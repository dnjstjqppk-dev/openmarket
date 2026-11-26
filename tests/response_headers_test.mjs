// tests/response_headers_test.mjs
// P1: every gateway response carries the security baseline, seller file
// downloads are sandboxed on all backends, and no SPA shell ships an inline
// script that its Content-Security-Policy would block.
// Run: node tests/response_headers_test.mjs (requires: node scripts/gen-dev-seed.mjs once)
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGateway, createRunner } from './lib/harness.mjs';

const t = createRunner('Response security headers (P1)');
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const SEED = ['migrations/dev/seed_local_dev.sql'];
const PW = 'DevPass!2026#';
const SECRET = 'test-jwt-secret-0123456789abcdefghijklmnop';
const BASE_ENV = { JWT_SECRET: SECRET, ENVIRONMENT: 'test', PAYMENT_MODE: 'sandbox' };
const PNG_1PX = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

async function boot(env = {}) {
  const g = await createGateway({ seedFiles: SEED, env: { ...BASE_ENV, ...env } });
  const login = async (email, role = 'CUSTOMER') => {
    const r = await g.call('/api/v1/auth/login', { method: 'POST', body: { email, password: PW, role } });
    assert.equal(r.status, 200, `login ${email}: ${r.text}`);
    return r.json.token;
  };
  return { ...g, login };
}

await t.test('S01 JSON responses carry the security baseline', async () => {
  const g = await boot();
  const h = await g.call('/health');
  assert.equal(h.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(h.headers.get('x-frame-options'), 'DENY');
  assert.ok(String(h.headers.get('content-security-policy')).includes("default-src 'none'"), 'API CSP present');
  const nf = await g.call('/api/v1/no-such-route-xyz');
  assert.equal(nf.status, 404);
  assert.ok(String(nf.headers.get('content-security-policy')).includes("frame-ancestors 'deny'"), 'error path keeps CSP');
});

await t.test('S02 D1 public downloads are nosniff + sandboxed', async () => {
  const g = await boot();
  const tok = await g.login('customer@example.com');
  const up = await g.call('/api/v1/storage/upload', {
    method: 'POST', token: tok, body: { file_data: PNG_1PX, content_type: 'image/png', folder: 'products' },
  });
  assert.equal(up.status, 201, up.text);
  const dl = await g.call(`/api/v1/storage/file/${up.json.data.file_id}`);
  assert.equal(dl.status, 200, dl.text.slice(0, 120));
  assert.equal(dl.headers.get('x-content-type-options'), 'nosniff');
  assert.ok(String(dl.headers.get('content-security-policy')).includes('sandbox'), 'download is sandboxed');
});

await t.test('S03 R2 public downloads match the D1 sandbox headers', async () => {
  const g = await boot({
    STORAGE_BUCKET: {
      get: async () => ({
        body: 'fake-bytes', httpEtag: '"fake"',
        writeHttpMetadata(h) { h.set('Content-Type', 'image/png'); },
      }),
    },
  });
  const dl = await g.call('/api/v1/storage/file/products/r2-probe.png');
  assert.equal(dl.status, 200, dl.text.slice(0, 120));
  assert.equal(dl.headers.get('x-content-type-options'), 'nosniff');
  assert.ok(String(dl.headers.get('content-security-policy')).includes('sandbox'), 'R2 path is sandboxed');
});

await t.test('S04 SPA shells ship a CSP and no inline scripts', async () => {
  for (const app of ['storefront', 'admin', 'partner']) {
    const headers = read(`apps/${app}/public/_headers`);
    assert.ok(headers.includes('Content-Security-Policy:'), `${app} _headers sets CSP`);
    assert.ok(headers.includes('X-Frame-Options: DENY'), `${app} _headers denies framing`);
    const html = read(`apps/${app}/index.html`);
    const inline = html.match(/<script(?![^>]*\ssrc=)[^>]*>/g) || [];
    assert.deepEqual(inline, [], `${app} index.html has no inline script (CSP script-src would block it)`);
  }
  assert.ok(read('apps/storefront/public/theme-init.js').includes('olmoa_theme'), 'theme init lives in an external file');
});

t.finish();
