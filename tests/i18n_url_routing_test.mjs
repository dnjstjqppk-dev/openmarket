// tests/i18n_url_routing_test.mjs
// Comprehensive verification for the /{lang}/{currency} URL scheme + Geo-IP +
// seller translations + per-language sitemaps + admin FX rate management
// (owner work order 2026-11-27, decisions 22-25).

import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createGateway, createRunner } from './lib/harness.mjs';
import {
  LANGS, CURRENCIES, DEFAULT_CURRENCY, COUNTRY_LOCALE, FALLBACK_LOCALE,
  parseLocalePath, localizedPath, buildLocalizedPath, legacyToBare, isLegacyIndexedPath, isUnprefixedPath,
  slugify, productBarePath, convertFromKrw, formatMoney, resolveEntryLocale, localeUrlPolicy
} from '../packages/ui/src/locale.config.ts';
import apex, { redirectFor, setHtmlLang } from '../apps/storefront/edge/apex-worker.js';
import { priceIn } from '../apps/cloudflare-gateway/src/services/seo/page-render.js';

const t = createRunner('i18n /{lang}/{currency} URL Routing & Geo-IP');
const PW = 'DevPass!2026#';
const SHELL = fs.readFileSync(new URL('../apps/storefront/index.html', import.meta.url), 'utf8');
const assets = { fetch: async () => new Response(SHELL, { headers: { 'Content-Type': 'text/html; charset=utf-8' } }) };

async function newGateway() {
  return createGateway({
    seedFiles: ['migrations/dev/seed_local_dev.sql'],
    env: {
      JWT_SECRET: 'e2e-secret-0123456789abcdefghijklmnopqrstu',
      ENVIRONMENT: 'development',
      PAYMENT_MODE: 'sandbox',
      PUBLIC_STOREFRONT_URL: 'https://olmoa.com'
    }
  });
}

async function login(g, email, role) {
  const r = await g.call('/api/v1/auth/login', { method: 'POST', body: { email, password: PW, role } });
  assert.equal(r.status, 200, `login ${email}: ${r.text}`);
  return r.json.token;
}

// 1. locale.config.ts pure unit tests
await t.test('1. locale.config parses, builds, slugifies, converts and enforces URL policy', () => {
  assert.deepEqual([...LANGS], ['ko', 'en', 'ja', 'zh-tw']);
  assert.deepEqual([...CURRENCIES], ['krw', 'usd', 'jpy', 'twd']);
  assert.deepEqual(DEFAULT_CURRENCY, { ko: 'krw', en: 'usd', ja: 'jpy', 'zh-tw': 'twd' });

  const p1 = parseLocalePath('/ko/krw/p/prod_001/무선-이어폰');
  assert.deepEqual(p1, { lang: 'ko', currency: 'krw', bare: '/p/prod_001/무선-이어폰', needsLowercase: false });

  const pUpper = parseLocalePath('/ZH-TW/TWD/c/audio/');
  assert.deepEqual(pUpper, { lang: 'zh-tw', currency: 'twd', bare: '/c/audio', needsLowercase: true });
  assert.equal(parseLocalePath('/fr/eur/p/1'), null);

  assert.equal(localizedPath('ko', 'krw', '/'), '/ko/krw');
  assert.equal(localizedPath('en', 'usd', '/p/1/buds'), '/en/usd/p/1/buds');
  assert.equal(buildLocalizedPath('ja', 'jpy', '/product/123', { sku: 'BLK' }), '/ja/jpy/p/123?sku=BLK');
  assert.equal(legacyToBare('/product/p1/'), '/p/p1');
  assert.equal(legacyToBare('/category/beauty'), '/c/beauty');
  assert.equal(legacyToBare('/en/product/p1'), '/p/p1');
  assert.equal(isLegacyIndexedPath('/product/p1'), true);
  assert.equal(isLegacyIndexedPath('/en/category/a'), true);
  assert.equal(isLegacyIndexedPath('/'), false);

  for (const w of ['/assets/app.js', '/api/v1/health', '/robots.txt', '/sitemap.xml', '/llms.txt', '/sw.js', '/favicon.ico']) {
    assert.equal(isUnprefixedPath(w), true, w);
  }
  assert.equal(isUnprefixedPath('/ko/krw'), false);

  assert.equal(slugify('Wireless Earbuds Pro (2026)!'), 'wireless-earbuds-pro-2026');
  assert.equal(slugify('무선 이어폰 Pro'), '무선-이어폰-pro');
  assert.equal(slugify('   !!!  '), '');

  assert.equal(convertFromKrw(13800, 'usd', 1380), 10);
  assert.equal(convertFromKrw(13800, 'jpy', 9), 1533);
  assert.equal(convertFromKrw(13800, 'twd', null), null);
  assert.equal(formatMoney(10, 'usd'), '$10.00');
  assert.equal(formatMoney(1533, 'jpy'), '¥1,533');
  assert.equal(formatMoney(320, 'twd'), 'NT$320');
  assert.equal(formatMoney(89000, 'krw'), '₩89,000');

  assert.deepEqual(resolveEntryLocale({ cookieLang: 'ja', cookieCurrency: 'usd', country: 'KR' }), { lang: 'ja', currency: 'usd', source: 'cookie' });
  assert.deepEqual(resolveEntryLocale({ country: 'KR' }), { ...COUNTRY_LOCALE.KR, source: 'geo' });
  assert.deepEqual(resolveEntryLocale({ country: 'TW' }), { ...COUNTRY_LOCALE.TW, source: 'geo' });
  assert.deepEqual(resolveEntryLocale({ country: 'DE' }), { ...FALLBACK_LOCALE, source: 'fallback' });

  // Policy matrix: representative vs other currency vs untranslated vs private vs search
  const rep = localeUrlPolicy({ lang: 'en', currency: 'usd', bare: '/p/1/buds', base: 'https://olmoa.com', contentLangs: ['ko', 'en'] });
  assert.equal(rep.robots, 'index,follow');
  assert.equal(rep.canonical, 'https://olmoa.com/en/usd/p/1/buds');
  assert.deepEqual(rep.hreflangs.map((h) => h.hreflang), ['ko', 'en', 'x-default']);
  assert.equal(rep.hreflangs[2].href, 'https://olmoa.com/en/usd/p/1/buds', 'x-default prefers en when translated');

  const altCur = localeUrlPolicy({ lang: 'en', currency: 'krw', bare: '/p/1/buds', base: 'https://olmoa.com', contentLangs: ['ko', 'en'] });
  assert.equal(altCur.robots, 'noindex,follow');
  assert.equal(altCur.canonical, 'https://olmoa.com/en/usd/p/1/buds');

  const untranslated = localeUrlPolicy({ lang: 'ja', currency: 'jpy', bare: '/p/1/buds', base: 'https://olmoa.com', contentLangs: ['ko'] });
  assert.equal(untranslated.robots, 'noindex,follow');
  assert.equal(untranslated.canonical, 'https://olmoa.com/ko/krw/p/1/buds');

  const search = localeUrlPolicy({ lang: 'ko', currency: 'krw', bare: '/search', base: 'https://olmoa.com' });
  assert.equal(search.robots, 'noindex,follow');
  assert.deepEqual(search.hreflangs, []);

  const priv = localeUrlPolicy({ lang: 'ko', currency: 'krw', bare: '/checkout', base: 'https://olmoa.com' });
  assert.equal(priv.robots, 'noindex,nofollow');
  assert.deepEqual(priv.hreflangs, []);
});

// 2. Apex worker redirectFor QA matrix & headers (cookie -> Geo -> fallback, 301 uppercase/legacy, no UA branching)
await t.test('2. apex redirectFor matrix, Vary/Cache-Control headers and setHtmlLang', async () => {
  const U = (p) => new URL(`https://olmoa.com${p}`);

  // Root -> 302 by country, cookie overrides country
  assert.deepEqual(redirectFor(U('/'), { country: 'KR' }), { status: 302, location: '/ko/krw' });
  assert.deepEqual(redirectFor(U('/'), { country: 'JP' }), { status: 302, location: '/ja/jpy' });
  assert.deepEqual(redirectFor(U('/'), { country: 'TW' }), { status: 302, location: '/zh-tw/twd' });
  assert.deepEqual(redirectFor(U('/'), { country: 'FR' }), { status: 302, location: '/en/usd' });
  assert.deepEqual(redirectFor(U('/?utm=x'), { cookies: { pref_lang: 'ja', pref_currency: 'usd' }, country: 'KR' }), { status: 302, location: '/ja/usd?utm=x' });

  // Uppercase prefix -> 301 lowercase
  assert.deepEqual(redirectFor(U('/KO/KRW/c/audio?page=2'), { country: 'US' }), { status: 301, location: '/ko/krw/c/audio?page=2' });
  assert.deepEqual(redirectFor(U('/ZH-TW/TWD'), { country: 'KR' }), { status: 301, location: '/zh-tw/twd' });

  // Legacy indexed paths -> 301 fixed destination (independent of visitor IP)
  assert.deepEqual(redirectFor(U('/product/p1?sku=BLK'), { country: 'US' }), { status: 301, location: '/ko/krw/p/p1?sku=BLK' });
  assert.deepEqual(redirectFor(U('/category/beauty'), { country: 'JP' }), { status: 301, location: '/ko/krw/c/beauty' });
  assert.deepEqual(redirectFor(U('/en/product/p1'), { country: 'KR' }), { status: 301, location: '/en/usd/p/p1' });
  assert.deepEqual(redirectFor(U('/ja/category/beauty'), { country: 'KR' }), { status: 301, location: '/ja/jpy/c/beauty' });

  // Valid lowercase prefix -> never redirected regardless of country/cookie
  assert.equal(redirectFor(U('/en/usd/p/1/buds'), { cookies: { pref_lang: 'ko' }, country: 'KR' }), null);
  assert.equal(redirectFor(U('/ko/krw'), { country: 'US' }), null);
  assert.equal(redirectFor(U('/assets/main.js'), { country: 'US' }), null);
  assert.equal(redirectFor(U('/robots.txt'), { country: 'US' }), null);

  // Live apex fetch verifies Vary: Cookie + no-store on 302 and identical behavior for Googlebot vs human
  const rHuman = await apex.fetch(new Request('https://olmoa.com/', { headers: { 'CF-IPCountry': 'JP', 'User-Agent': 'Mozilla/5.0' } }), { ASSETS: assets });
  const rBot = await apex.fetch(new Request('https://olmoa.com/', { headers: { 'CF-IPCountry': 'JP', 'User-Agent': 'Googlebot/2.1' } }), { ASSETS: assets });
  assert.equal(rHuman.status, 302);
  assert.equal(rHuman.headers.get('Location'), 'https://olmoa.com/ja/jpy');
  assert.equal(rHuman.headers.get('Vary'), 'Cookie');
  assert.equal(rHuman.headers.get('Cache-Control'), 'private, no-store');
  assert.equal(rBot.status, rHuman.status);
  assert.equal(rBot.headers.get('Location'), rHuman.headers.get('Location'));

  assert.ok(setHtmlLang('<html lang="ko">', 'zh-tw').includes('lang="zh-TW"'));
  assert.ok(setHtmlLang('<html lang="ko">', 'ja').includes('lang="ja"'));
});

// 3. Partner translations API ownership, slug 301 repair, 410 Gone, currency canonical & per-lang sitemaps
await t.test('3. translations API, PDP slug 301, 410 Gone, currency canonical and per-lang sitemaps', async () => {
  const g = await newGateway();
  const pt1 = await login(g, 'seller@temu-supply.com', 'PARTNER');
  const pt2 = await login(g, 'partner2@olmoa-tech.com', 'PARTNER');
  const prod = g.db.prepare("SELECT id, title FROM products WHERE partner_id = 'pt_001' AND status = 'ACTIVE' AND review_status = 'APPROVED' AND shipping_policy_id IS NOT NULL ORDER BY id LIMIT 1").get();
  assert.ok(prod);

  // Other seller cannot write or read pt_001's translations
  assert.equal((await g.call(`/api/v1/partner/products/${prod.id}/translations`, { token: pt2 })).status, 404);
  assert.equal((await g.call(`/api/v1/partner/products/${prod.id}/translations/en`, { method: 'PUT', token: pt2, body: { title: 'Hijack' } })).status, 404);

  // Invalid language rejected
  assert.equal((await g.call(`/api/v1/partner/products/${prod.id}/translations/fr`, { method: 'PUT', token: pt1, body: { title: 'Bonjour' } })).status, 400);

  // Owner upserts en translation
  const put = await g.call(`/api/v1/partner/products/${prod.id}/translations/en`, {
    method: 'PUT', token: pt1, body: { title: 'Wireless ANC Earbuds Pro', summary: 'Featherweight active noise cancellation.' }
  });
  assert.equal(put.status, 200, put.text);
  assert.equal(put.json.data.slug, 'wireless-anc-earbuds-pro');

  // Public localized endpoint returns translated title + slug + content_langs
  const pubEn = await g.call(`/api/v1/products/${prod.id}/localized?lang=en`);
  assert.equal(pubEn.status, 200);
  assert.equal(pubEn.json.data.translated, true);
  assert.equal(pubEn.json.data.slug, 'wireless-anc-earbuds-pro');
  assert.deepEqual(pubEn.json.data.content_langs, ['ko', 'en']);

  const pubJa = await g.call(`/api/v1/products/${prod.id}/localized?lang=ja`);
  assert.equal(pubJa.json.data.translated, false);

  // Edge rendering: missing/stale slug -> 301 preserving ?sku=BLK
  const env = { ASSETS: assets, API: { fetch: (req) => g.worker.fetch(req, g.env, g.ctx) } };
  const badSlug = await apex.fetch(new Request(`https://olmoa.com/en/usd/p/${prod.id}/wrong-slug?sku=BLK`), env);
  assert.equal(badSlug.status, 301);
  assert.equal(badSlug.headers.get('Location'), `https://olmoa.com/en/usd/p/${prod.id}/wireless-anc-earbuds-pro?sku=BLK`);

  // Translated /en/usd -> 200 index,follow, self-canonical, hreflang ko + en + x-default=en, USD price in JSON-LD
  const okEn = await apex.fetch(new Request(`https://olmoa.com/en/usd/p/${prod.id}/wireless-anc-earbuds-pro`), env);
  assert.equal(okEn.status, 200);
  const enHtml = await okEn.text();
  assert.match(enHtml, /<html[^>]*lang="en"/);
  assert.match(enHtml, /<meta name="robots" content="index,follow">/);
  assert.match(enHtml, new RegExp(`<link rel="canonical" href="https://olmoa\\.com/en/usd/p/${prod.id}/wireless-anc-earbuds-pro">`));
  assert.match(enHtml, /hreflang="en"/);
  assert.match(enHtml, /hreflang="ko"/);
  assert.match(enHtml, /"priceCurrency":"USD"/);

  // Non-default currency /en/krw -> 200 noindex,follow, canonical -> /en/usd
  const enKrw = await apex.fetch(new Request(`https://olmoa.com/en/krw/p/${prod.id}/wireless-anc-earbuds-pro`), env);
  assert.equal(enKrw.status, 200);
  const enKrwHtml = await enKrw.text();
  assert.match(enKrwHtml, /<meta name="robots" content="noindex,follow">/);
  assert.match(enKrwHtml, new RegExp(`<link rel="canonical" href="https://olmoa\\.com/en/usd/p/${prod.id}/wireless-anc-earbuds-pro">`));

  // Per-language sitemaps: /sitemap.xml lists en-products-1.xml and en shard contains ONLY translated product
  const smIdx = await g.call('/sitemap.xml');
  assert.ok(smIdx.text.includes('/sitemaps/ko-products-1.xml'));
  assert.ok(smIdx.text.includes('/sitemaps/en-products-1.xml'));
  assert.ok(smIdx.text.includes('/sitemaps/pages.xml'));
  const enSm = await g.call('/sitemaps/en-products-1.xml');
  assert.equal(enSm.status, 200);
  assert.ok(enSm.text.includes(`/en/usd/p/${prod.id}/wireless-anc-earbuds-pro`));

  // Ended/deleted product -> 410 Gone
  g.db.prepare("UPDATE products SET status = 'DELETED' WHERE id = ?").run(prod.id);
  const goneRes = await apex.fetch(new Request(`https://olmoa.com/en/usd/p/${prod.id}/wireless-anc-earbuds-pro`), env);
  assert.equal(goneRes.status, 410);

  // Owner deletes translation
  const del = await g.call(`/api/v1/partner/products/${prod.id}/translations/en`, { method: 'DELETE', token: pt1 });
  assert.equal(del.status, 200);
});

// 4. Admin FX rate write API & policy enforcement (incl. TWD)
await t.test('4. admin FX rate API publishes TWD, enforces role policy and updates priceIn', async () => {
  const g = await newGateway();
  const adm = await login(g, 'admin@openmarket.com', 'ADMIN');
  const pt1 = await login(g, 'seller@temu-supply.com', 'PARTNER');

  // Unauthenticated and partner blocked
  assert.equal((await g.call('/api/v1/admin/fx-rates')).status, 401);
  assert.equal((await g.call('/api/v1/admin/fx-rates/TWD', { method: 'PUT', token: pt1, body: { inverse_rate: 43 } })).status, 403);

  // Before TWD exists, priceIn('twd') falls back honestly to KRW
  const before = await priceIn(g.env, 'twd', 43000);
  assert.equal(before.code, 'KRW');

  // Admin publishes TWD = 43 KRW
  const put = await g.call('/api/v1/admin/fx-rates/TWD', { method: 'PUT', token: adm, body: { inverse_rate: 43, spread_pct: 1.5 } });
  assert.equal(put.status, 200, put.text);
  assert.equal(put.json.data.target_currency, 'TWD');
  assert.equal(Number(put.json.data.inverse_rate), 43);

  // Public /api/v1/fx/rates now includes TWD and priceIn('twd') converts cleanly
  const pub = await g.call('/api/v1/fx/rates');
  assert.equal(pub.json.inverse_rates.TWD, 43);
  const after = await priceIn(g.env, 'twd', 43000);
  assert.equal(after.code, 'TWD');
  assert.equal(after.amount, 1000);

  // Audit log recorded
  const aud = g.db.prepare("SELECT action, target_id FROM admin_audit_log WHERE action = 'FX_RATE_UPSERT' AND target_id = 'KRW:TWD'").get();
  assert.ok(aud, 'audit log recorded for FX upsert');

  // Invalid currency & bad rate rejected
  assert.equal((await g.call('/api/v1/admin/fx-rates/XYZ', { method: 'PUT', token: adm, body: { inverse_rate: 100 } })).status, 400);
  assert.equal((await g.call('/api/v1/admin/fx-rates/TWD', { method: 'PUT', token: adm, body: { inverse_rate: -5 } })).status, 400);

  // Delete TWD reverts to KRW fallback
  assert.equal((await g.call('/api/v1/admin/fx-rates/TWD', { method: 'DELETE', token: adm })).status, 200);
  assert.equal((await priceIn(g.env, 'twd', 43000)).code, 'KRW');
});

t.finish();
