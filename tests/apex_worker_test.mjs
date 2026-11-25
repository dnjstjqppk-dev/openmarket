// tests/apex_worker_test.mjs
// Domain cutover: the apex storefront worker (root wrangler.toml, `openmarket`) must
// serve the API-generated crawl surface, not the SPA shell, and deployable frontend
// builds must fail without their VITE_* endpoints (Workers Builds hazard, G07).

import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createGateway, createRunner } from './lib/harness.mjs';
import apex, { CRAWL_PATHS, isCrawlPath } from '../apps/storefront/edge/apex-worker.js';
import { requireBuildEnv } from '../scripts/vite-require-env.mjs';

const t = createRunner('Apex Worker / Domain Cutover');
const SHELL = '<!DOCTYPE html><html><body>spa</body></html>';
const assets = { fetch: async () => new Response(SHELL, { headers: { 'Content-Type': 'text/html' } }) };

await t.test('A01 run_worker_first in wrangler.toml matches CRAWL_PATHS exactly', () => {
  const toml = fs.readFileSync(new URL('../wrangler.toml', import.meta.url), 'utf8');
  const m = toml.match(/^run_worker_first\s*=\s*(\[.*\])\s*$/m);
  assert.ok(m, 'run_worker_first missing from root wrangler.toml');
  assert.deepEqual(JSON.parse(m[1]), CRAWL_PATHS);
  assert.match(toml, /^main\s*=\s*"apps\/storefront\/edge\/apex-worker\.js"/m);
  assert.match(toml, /\[\[services\]\]\s*\nbinding\s*=\s*"API"\s*\nservice\s*=\s*"olmoa-api"/);
});

await t.test('A02 crawl paths are matched, app routes are not', () => {
  for (const p of ['/robots.txt', '/sitemap.xml', '/sitemap-index.xml', '/sitemaps/products-1.xml', '/llms.txt', '/llms-full.txt']) {
    assert.equal(isCrawlPath(p), true, p);
  }
  for (const p of ['/', '/category/food', '/sitemaps', '/robots.txt.bak', '/llms.txt/x', '/product/1']) {
    assert.equal(isCrawlPath(p), false, p);
  }
});

await t.test('A03 apex serves real sitemap/robots/llms from the API, SPA for the rest', async () => {
  const g = await createGateway({
    seedFiles: ['migrations/dev/seed_local_dev.sql'],
    env: { JWT_SECRET: 'e2e-secret-0123456789abcdefghijklmnopqrstu', ENVIRONMENT: 'development', PUBLIC_STOREFRONT_URL: 'https://olmoa.com' }
  });
  const env = { ASSETS: assets, API: { fetch: (req) => g.worker.fetch(req, g.env, g.ctx) } };
  const get = (p) => apex.fetch(new Request(`https://olmoa.com${p}`), env);

  const idx = await get('/sitemap-index.xml');
  assert.equal(idx.status, 200);
  assert.match(idx.headers.get('Content-Type'), /application\/xml/);
  const locs = [...(await idx.text()).matchAll(/<loc>([^<]+)<\/loc>/g)].map((x) => x[1]);
  assert.ok(locs.length >= 2, 'sitemap index has entries');
  for (const loc of locs) {
    const u = new URL(loc);
    assert.equal(u.host, 'olmoa.com');
    const child = await get(u.pathname); // every index entry must resolve to XML on the apex
    assert.equal(child.status, 200, loc);
    assert.match(child.headers.get('Content-Type'), /application\/xml/, loc);
  }

  const robots = await get('/robots.txt');
  assert.match(robots.headers.get('Content-Type'), /text\/plain/);
  const rt = await robots.text();
  assert.match(rt, /^Sitemap: https:\/\/olmoa\.com\/sitemap-index\.xml$/m);
  assert.doesNotMatch(rt, /workers\.dev|pages\.dev/);

  for (const p of ['/llms.txt', '/llms-full.txt']) {
    const r = await get(p);
    assert.equal(r.status, 200, p);
    assert.match(r.headers.get('Content-Type'), /text\/plain/, p);
    assert.doesNotMatch(await r.text(), /<!DOCTYPE html>/i, p);
  }

  const home = await get('/category/food');
  assert.equal(await home.text(), SHELL);
});

await t.test('A04 missing API binding fails visibly (503), never the SPA shell', async () => {
  const r = await apex.fetch(new Request('https://olmoa.com/sitemap-index.xml'), { ASSETS: assets });
  assert.equal(r.status, 503);
  assert.doesNotMatch(await r.text(), /DOCTYPE/);
});

await t.test('A05 static storefront files carry no stale host', () => {
  const pub = new URL('../apps/storefront/public/', import.meta.url);
  assert.equal(fs.existsSync(new URL('sitemap.xml', pub)), false, 'static sitemap.xml shadows the generated one');
  assert.doesNotMatch(fs.readFileSync(new URL('robots.txt', pub), 'utf8'), /workers\.dev|pages\.dev|^Sitemap:/m);
});

await t.test('A06 deployable builds fail without VITE_* endpoints; other builds are untouched', () => {
  const plugin = requireBuildEnv(['VITE_API_BASE_URL', 'VITE_ADMIN_URL']);
  const saved = { WORKERS_CI: process.env.WORKERS_CI, OLMOA_REQUIRE_BUILD_ENV: process.env.OLMOA_REQUIRE_BUILD_ENV,
    VITE_API_BASE_URL: process.env.VITE_API_BASE_URL, VITE_ADMIN_URL: process.env.VITE_ADMIN_URL };
  const set = (k, v) => { if (v === undefined) delete process.env[k]; else process.env[k] = v; };
  try {
    for (const k of Object.keys(saved)) set(k, undefined);
    plugin.configResolved({ env: {} }); // plain/local build: no enforcement

    set('WORKERS_CI', '1'); // Cloudflare Workers Builds
    assert.throws(() => plugin.configResolved({ env: {} }), /VITE_API_BASE_URL, VITE_ADMIN_URL/);
    assert.throws(() => plugin.configResolved({ env: { VITE_API_BASE_URL: 'https://api.olmoa.com', VITE_ADMIN_URL: ' ' } }), /VITE_ADMIN_URL/);
    plugin.configResolved({ env: { VITE_API_BASE_URL: 'https://api.olmoa.com', VITE_ADMIN_URL: 'https://admin.olmoa.com' } });

    set('WORKERS_CI', undefined);
    set('OLMOA_REQUIRE_BUILD_ENV', '1'); // deploy.yml
    assert.throws(() => plugin.configResolved({ env: {} }), /missing/);
  } finally {
    for (const [k, v] of Object.entries(saved)) set(k, v);
  }
  const deploy = fs.readFileSync(new URL('../.github/workflows/deploy.yml', import.meta.url), 'utf8');
  assert.match(deploy, /OLMOA_REQUIRE_BUILD_ENV: '1'/);
  for (const app of ['storefront', 'admin', 'partner']) {
    const cfg = fs.readFileSync(new URL(`../apps/${app}/vite.config.ts`, import.meta.url), 'utf8');
    assert.match(cfg, /requireBuildEnv\(\[/, app);
  }
});

t.finish();
