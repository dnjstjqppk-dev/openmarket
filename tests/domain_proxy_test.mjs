// tests/domain_proxy_test.mjs
// Domain account layout after the 2026-11-25 account move: every app worker owns its
// olmoa.com Custom Domain in the same account; olmoa-edge only redirects www → apex.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRunner } from './lib/harness.mjs';
import edge from '../infra/domain-proxy/worker.js';

const t = createRunner('Domain Layout (olmoa-edge + app workers)');
const strip = (f) => JSON.parse(fs.readFileSync(new URL(f, import.meta.url), 'utf8').replace(/^\s*\/\/.*$/gm, ''));
const realFetch = globalThis.fetch;
let fetched = 0;
globalThis.fetch = async () => { fetched += 1; return new Response('unexpected'); };

await t.test('D01 www redirects 301 to the https apex, keeping path and query, with HSTS (no preload)', async () => {
  for (const u of ['https://www.olmoa.com/p/1?a=b', 'http://www.olmoa.com/p/1?a=b']) {
    const r = await edge.fetch(new Request(u));
    assert.equal(r.status, 301, u);
    assert.equal(r.headers.get('Location'), 'https://olmoa.com/p/1?a=b', u);
    assert.equal(r.headers.get('Strict-Transport-Security'), 'max-age=31536000; includeSubDomains');
  }
});

await t.test('D02 olmoa-edge proxies nothing (no path back to the retired workers)', async () => {
  for (const h of ['olmoa.com', 'admin.olmoa.com', 'partner.olmoa.com', 'api.olmoa.com', 'evil.example']) {
    const r = await edge.fetch(new Request(`https://${h}/`));
    assert.equal(r.status, 404, h);
  }
  assert.equal(fetched, 0);
  const src = fs.readFileSync(new URL('../infra/domain-proxy/worker.js', import.meta.url), 'utf8');
  assert.doesNotMatch(src.replace(/^\s*\/\/.*$/gm, ''), /workers\.dev|await fetch\(|return fetch\(/);
});

await t.test('D03 every app worker targets the domain account and owns exactly its host', () => {
  const edgeCfg = strip('../infra/domain-proxy/wrangler.jsonc');
  assert.equal(edgeCfg.account_id, 'f5c363135efe9b22ca66eb39f2f8e1da');
  assert.deepEqual(edgeCfg.routes.map((r) => r.pattern), ['www.olmoa.com']);
  for (const [f, host] of [['../apps/cloudflare-gateway/wrangler.jsonc', 'api.olmoa.com'],
    ['../apps/admin/wrangler.jsonc', 'admin.olmoa.com'], ['../apps/partner/wrangler.jsonc', 'partner.olmoa.com']]) {
    const c = strip(f);
    assert.equal(c.account_id, edgeCfg.account_id, f);
    assert.equal(c.workers_dev, false, f);
    assert.deepEqual(c.routes.map((r) => r.pattern), [host], f);
    assert.ok(c.routes.every((r) => r.custom_domain === true && r.zone_name === 'olmoa.com'), f);
  }
  const toml = fs.readFileSync(new URL('../wrangler.toml', import.meta.url), 'utf8');
  assert.match(toml, new RegExp(`^account_id = "${edgeCfg.account_id}"`, 'm'));
  assert.match(toml, /^workers_dev = false$/m);
  assert.match(toml, /pattern = "olmoa\.com", custom_domain = true, zone_name = "olmoa\.com"/);
});

await t.test('D04 the API binds the moved D1 and keeps rate limits + cron', () => {
  const c = strip('../apps/cloudflare-gateway/wrangler.jsonc');
  assert.equal(c.d1_databases[0].database_id, '6e23f7cd-7999-4419-ac6e-63481edc5454');
  assert.deepEqual(c.ratelimits.map((r) => r.name), ['RL_AUTH', 'RL_LOGIN', 'RL_WRITE', 'RL_API']);
  assert.deepEqual(c.triggers.crons, ['*/5 * * * *']);
});

await t.test('D05 frontends and apps point at the custom domains, consoles send HSTS', () => {
  const deploy = fs.readFileSync(new URL('../.github/workflows/deploy.yml', import.meta.url), 'utf8');
  for (const v of ['VITE_API_BASE_URL: https://api.olmoa.com', 'VITE_STOREFRONT_URL: https://olmoa.com',
    'VITE_PARTNER_URL: https://partner.olmoa.com', 'VITE_ADMIN_URL: https://admin.olmoa.com']) assert.ok(deploy.includes(v), v);
  assert.doesNotMatch(deploy, /dnjstjqppk\.workers\.dev|Dedicated Storefront/);
  for (const f of ['../mobile/customer_app/lib/services/api_service.dart', '../mobile/partner_app/lib/services/partner_api_service.dart']) {
    assert.match(fs.readFileSync(new URL(f, import.meta.url), 'utf8'), /defaultValue: 'https:\/\/api\.olmoa\.com'/, f);
  }
  for (const app of ['storefront', 'admin', 'partner']) {
    const h = fs.readFileSync(new URL(`../apps/${app}/public/_headers`, import.meta.url), 'utf8');
    assert.match(h, /\/\*\r?\n {2}Strict-Transport-Security: max-age=31536000; includeSubDomains\r?\n/, app);
  }
});

globalThis.fetch = realFetch;
t.finish();
