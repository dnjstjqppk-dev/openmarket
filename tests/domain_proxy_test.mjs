// tests/domain_proxy_test.mjs
// olmoa-edge (infra/domain-proxy): the domain-account worker that maps the olmoa.com
// custom domains onto the workers-account workers.dev hosts.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRunner } from './lib/harness.mjs';
import edge, { UPSTREAMS, API_UPSTREAM, isCrawlPath } from '../infra/domain-proxy/worker.js';
import { CRAWL_PATHS, isCrawlPath as apexIsCrawl } from '../apps/storefront/edge/apex-worker.js';

const t = createRunner('Domain Proxy (olmoa-edge)');
const calls = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init = {}) => {
  calls.push({ url, init });
  if (url.endsWith('/bounce')) return new Response(null, { status: 302, headers: { Location: 'https://openmarket.dnjstjqppk.workers.dev/login?x=1' } });
  return new Response(`upstream:${url}`, { status: 200, headers: { 'Content-Type': 'text/plain', 'X-Up': '1' } });
};
const hit = (u, init) => { calls.length = 0; return edge.fetch(new Request(u, init)); };

await t.test('D01 each custom host forwards to its workers.dev upstream with path + query', async () => {
  for (const [host, up] of Object.entries(UPSTREAMS)) {
    const r = await hit(`https://${host}/a/b?q=1`);
    assert.equal(r.status, 200);
    assert.equal(calls[0].url, `${up}/a/b?q=1`);
    assert.equal(r.headers.get('X-Up'), '1');
    assert.match(r.headers.get('Strict-Transport-Security'), /max-age=31536000; includeSubDomains/);
    assert.doesNotMatch(r.headers.get('Strict-Transport-Security'), /preload/);
  }
});

await t.test('D02 apex crawl paths go to the API; same set as the apex worker', async () => {
  for (const p of ['/robots.txt', '/sitemap.xml', '/sitemap-index.xml', '/sitemaps/products-1.xml', '/llms.txt', '/llms-full.txt']) {
    await hit(`https://olmoa.com${p}`);
    assert.equal(calls[0].url, `${API_UPSTREAM}${p}`, p);
    assert.equal(isCrawlPath(p), apexIsCrawl(p), p);
  }
  await hit('https://admin.olmoa.com/robots.txt'); // consoles keep their own static robots
  assert.equal(calls[0].url, `${UPSTREAMS['admin.olmoa.com']}/robots.txt`);
  for (const p of ['/', '/category/x', '/sitemaps', '/llms.txt/x']) assert.equal(isCrawlPath(p), apexIsCrawl(p), p);
  assert.equal(CRAWL_PATHS.length, 6);
});

await t.test('D03 www and http redirect 301 to https apex, keeping path and query', async () => {
  let r = await hit('https://www.olmoa.com/p/1?a=b');
  assert.equal(r.status, 301);
  assert.equal(r.headers.get('Location'), 'https://olmoa.com/p/1?a=b');
  r = await hit('http://admin.olmoa.com/x');
  assert.equal(r.status, 301);
  assert.equal(r.headers.get('Location'), 'https://admin.olmoa.com/x');
  assert.equal(calls.length, 0);
});

await t.test('D04 unknown hosts (incl. api.olmoa.com) are not proxied', async () => {
  for (const h of ['api.olmoa.com', 'evil.example', 'x.olmoa.com']) {
    const r = await hit(`https://${h}/`);
    assert.equal(r.status, 404, h);
  }
  assert.equal(calls.length, 0);
});

await t.test('D05 upstream redirects stay on the custom host; spoofable edge headers dropped', async () => {
  const r = await hit('https://olmoa.com/bounce', { headers: { 'CF-Connecting-IP': '6.6.6.6', 'X-Real-IP': '6.6.6.6', Accept: 'text/html' } });
  assert.equal(r.status, 302);
  assert.equal(r.headers.get('Location'), 'https://olmoa.com/login?x=1');
  const h = calls[0].init.headers;
  assert.equal(h.get('cf-connecting-ip'), null);
  assert.equal(h.get('x-real-ip'), null);
  assert.equal(h.get('accept'), 'text/html');
  assert.equal(calls[0].init.redirect, 'manual');
});

await t.test('D06 config: domain account, four custom domains, no workers.dev, no api host', () => {
  const raw = fs.readFileSync(new URL('../infra/domain-proxy/wrangler.jsonc', import.meta.url), 'utf8');
  const cfg = JSON.parse(raw.replace(/^\s*\/\/.*$/gm, ''));
  assert.equal(cfg.account_id, 'f5c363135efe9b22ca66eb39f2f8e1da');
  assert.equal(cfg.workers_dev, false);
  assert.deepEqual(cfg.routes.map((r) => r.pattern).sort(), ['admin.olmoa.com', 'olmoa.com', 'partner.olmoa.com', 'www.olmoa.com']);
  assert.ok(cfg.routes.every((r) => r.custom_domain === true && r.zone_name === 'olmoa.com'));
});

globalThis.fetch = realFetch;
t.finish();
