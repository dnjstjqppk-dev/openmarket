// tests/seo_robots_6_6_test.mjs
// Phase 6 task 6-6: policy-table robots.txt. Three crawler families plus a
// fallback, all allowing public paths (decision-18), identical private-path
// disallows, a Content-Signal line and base-driven sitemap lines.

import assert from 'node:assert/strict';
import { createGateway, createRunner } from './lib/harness.mjs';
import { ROBOT_GROUPS, PRIVATE_DISALLOWS, CONTENT_SIGNAL } from '../apps/cloudflare-gateway/src/services/seo/crawl-text.js';

const t = createRunner('Robots policy (6-6)');

async function newGateway(publicUrl) {
  return createGateway({
    seedFiles: ['migrations/dev/seed_local_dev.sql'],
    env: {
      JWT_SECRET: 'e2e-secret-0123456789abcdefghijklmnopqrstu',
      ENVIRONMENT: 'development',
      CONNECTOR_SIMULATION: 'true',
      PAYMENT_MODE: 'sandbox',
      PUBLIC_STOREFRONT_URL: publicUrl || 'https://olmoa.com'
    }
  });
}

/** Split robots.txt into `# <GROUP>` sections; returns { id, agents, disallows, allows }. */
function parseGroups(text) {
  const groups = [];
  let cur = null;
  for (const raw of String(text).split('\n')) {
    const line = raw.trim();
    const head = line.match(/^#\s+(SEARCH|AI_ANSWER|AI_TRAIN|FALLBACK)$/);
    if (head) {
      cur = { id: head[1], agents: [], disallows: [], allows: [] };
      groups.push(cur);
      continue;
    }
    if (!cur) continue;
    const ua = line.match(/^User-agent:\s*(\S+)/i);
    if (ua) cur.agents.push(ua[1]);
    const dis = line.match(/^Disallow:\s*(\S*)/i);
    if (dis) cur.disallows.push(dis[1]);
    const allow = line.match(/^Allow:\s*(\S*)/i);
    if (allow) cur.allows.push(allow[1]);
  }
  return groups;
}

// 1. The four training UAs sit in AI_TRAIN and public paths stay allowed.
await t.test('1. GPTBot, ClaudeBot, Google-Extended, CCBot are allowed', async () => {
  const g = await newGateway();
  const r = await g.call('/robots.txt');
  assert.equal(r.status, 200);
  const groups = parseGroups(r.text);
  const train = groups.find((x) => x.id === 'AI_TRAIN');
  assert.ok(train, 'AI_TRAIN group present');
  for (const ua of ['GPTBot', 'ClaudeBot', 'Google-Extended', 'CCBot']) {
    assert.ok(train.agents.includes(ua), `${ua} in AI_TRAIN`);
  }
  assert.ok(!train.disallows.includes('/') && !train.disallows.includes(''), 'no blanket disallow');
  assert.ok(train.allows.includes('/'), 'public paths explicitly allowed');
});

// 2. Every group carries the identical private-path list.
await t.test('2. all groups disallow the same private paths', async () => {
  const g = await newGateway();
  const r = await g.call('/robots.txt');
  const groups = parseGroups(r.text);
  assert.deepEqual(groups.map((x) => x.id), ROBOT_GROUPS.map((x) => x.id), 'group order follows the table');
  for (const grp of groups) {
    const table = ROBOT_GROUPS.find((x) => x.id === grp.id);
    assert.deepEqual(grp.agents, table.agents, `${grp.id} agents follow the table`);
    for (const p of PRIVATE_DISALLOWS) {
      assert.ok(grp.disallows.includes(p), `${grp.id} disallows ${p}`);
    }
    assert.equal(grp.disallows.length, PRIVATE_DISALLOWS.length, `${grp.id} has no extra disallow`);
  }
});

// 3. Content-Signal line, byte-exact.
await t.test('3. Content-Signal line exists', async () => {
  const g = await newGateway();
  const r = await g.call('/robots.txt');
  assert.ok(r.text.split('\n').some((l) => l.trim() === CONTENT_SIGNAL), 'signal line present');
  assert.equal(CONTENT_SIGNAL, 'Content-Signal: search=yes, ai-input=yes, ai-train=yes');
});

// 4. Sitemap line follows PUBLIC_STOREFRONT_URL (/sitemap.xml is the sitemap index).
await t.test('4. sitemap lines follow the public base', async () => {
  const custom = await newGateway('https://shop.example.com/');
  const r = await custom.call('/robots.txt');
  assert.ok(r.text.includes('Sitemap: https://shop.example.com/sitemap.xml'), 'custom sitemap index');
  assert.ok(!r.text.includes('shop.example.com//sitemap'), 'no double slash');
  const live = await newGateway();
  const d = await live.call('/robots.txt');
  assert.ok(d.text.includes('Sitemap: https://olmoa.com/sitemap.xml'), 'default sitemap index');
});

// 5. Search family and the * fallback.
await t.test('5. search crawlers listed, * fallback retained', async () => {
  const g = await newGateway();
  const r = await g.call('/robots.txt');
  const groups = parseGroups(r.text);
  const search = groups.find((x) => x.id === 'SEARCH');
  for (const ua of ['Googlebot', 'Bingbot', 'Yeti', 'Daum']) {
    assert.ok(search.agents.includes(ua), `${ua} in SEARCH`);
  }
  const fallback = groups.find((x) => x.id === 'FALLBACK');
  assert.ok(fallback && fallback.agents.includes('*'), 'User-agent: * retained');
  assert.ok(fallback.allows.includes('/'), 'fallback allows public paths');
});

t.finish();
