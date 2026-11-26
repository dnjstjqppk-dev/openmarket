// tests/seo_head_policy_test.mjs
// Phase 6 task 6-8: Korean search details — one locale voice (ko-KR +
// x-default), query-stripped canonicals with paginated self-reference,
// noindex,follow search, entity title rules, factual descriptions,
// product-name-plus-option alts and zero broken images.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRunner } from './lib/harness.mjs';
import { canonicalOf, hreflangOf, robotsOf, routeHeadOf, pageOfQuery } from '../packages/ui/src/composables/useSeoHead.ts';
import { productHeadOf, categoryHeadOf, galleryAltOf } from '../apps/storefront/src/lib/productSeo.ts';
import { productMeta, categoryMeta } from '../apps/cloudflare-gateway/src/lib/seo-meta.js';
import { routeHead, canonicalOf as srvCanonicalOf } from '../apps/cloudflare-gateway/src/lib/seo-head.js';
import { SITE_TAGLINE } from '../apps/cloudflare-gateway/src/lib/site-entity.js';

const t = createRunner('Head policy ko (6-8)');
const BANNED = ['무료배송', '가장 합리적인 가격', '새로운 표준', '만나보세요'];

// 1. One locale voice for untranslated pages: lang, og:locale, ko + x-default under /{lang}/{currency}.
await t.test('1. shell and builder agree on ko plus x-default', async () => {
  const shell = readFileSync('apps/storefront/index.html', 'utf8');
  assert.ok(shell.includes('<html lang="ko">'), 'html lang');
  assert.ok(shell.includes('<meta property="og:locale" content="ko_KR" />'), 'og:locale');
  for (const [code, href] of [['ko', 'https://olmoa.com/ko/krw'], ['x-default', 'https://olmoa.com/ko/krw']]) {
    assert.ok(shell.includes(`<link rel="alternate" hreflang="${code}" href="${href}" />`), `shell ${code}`);
  }
  assert.ok(!/hreflang="(en|ja|zh-TW)/.test(shell), 'no untranslated alternates in the shell');
  assert.ok(!shell.includes('og:locale:alternate'), 'no alternate og locales');
  const alts = hreflangOf('https://olmoa.com', '/ko/krw/c/dress');
  assert.deepEqual(alts.map((a) => a.lang), ['ko', 'x-default']);
  assert.equal(alts[0].href, 'https://olmoa.com/ko/krw/c/dress');
  assert.equal(alts[1].href, 'https://olmoa.com/ko/krw/c/dress', 'x-default points at ko when untranslated');
  assert.deepEqual(hreflangOf('https://olmoa.com', '/en/usd/c/dress'), alts, 'untranslated en advertises ko set');
  assert.equal(canonicalOf('https://olmoa.com', '/ja/jpy/p/p1'), 'https://olmoa.com/ko/krw/p/p1', 'untranslated ja canonical is ko/krw');
  assert.equal(canonicalOf('https://olmoa.com', '/en/usd'), 'https://olmoa.com/ko/krw', 'untranslated home canonical');
});

// 2. Sort/filter queries strip; page 2+ self-canonicals; page=1 is bare.
await t.test('2. canonical keeps only ?page=N (N>=2)', async () => {
  const c = (q) => canonicalOf('https://olmoa.com', '/ko/krw/c/dress', q);
  assert.equal(c({ sort: 'price_asc', brand: 'Acme', min_price: '1000' }), 'https://olmoa.com/ko/krw/c/dress');
  assert.equal(c({ sort: 'price_asc', page: '3' }), 'https://olmoa.com/ko/krw/c/dress?page=3');
  assert.equal(c({ page: '1' }), 'https://olmoa.com/ko/krw/c/dress');
  assert.equal(c({ page: '0' }), 'https://olmoa.com/ko/krw/c/dress');
  assert.equal(c({ page: ['2', '5'] }), 'https://olmoa.com/ko/krw/c/dress?page=2');
  assert.equal(c({ page: 'abc' }), 'https://olmoa.com/ko/krw/c/dress');
  assert.equal(pageOfQuery({}), 1);
  const alts = hreflangOf('https://olmoa.com', '/ko/krw/c/dress', { page: '2' });
  assert.ok(alts.every((a) => a.href.endsWith('/ko/krw/c/dress?page=2')), 'alternates ride along');
  assert.equal(srvCanonicalOf('https://olmoa.com', '/ko/krw/c/dress', { sort: 'x', page: '4' }),
    'https://olmoa.com/ko/krw/c/dress?page=4', 'server mirror agrees');
});

// 3. Search is noindex,follow; private stays noindex,nofollow.
await t.test('3. /search keeps follow, private paths do not', async () => {
  assert.equal(robotsOf('/ko/krw/search'), 'noindex,follow');
  assert.equal(robotsOf('/en/usd/search'), 'noindex,follow', 'prefixed search');
  assert.equal(robotsOf('/ko/krw/cart'), 'noindex,nofollow');
  assert.equal(robotsOf('/ko/krw/p/p1'), 'index,follow');
  assert.equal(robotsOf('/ko/usd/p/p1'), 'noindex,follow', 'non-default currency is noindex,follow');
  assert.equal(routeHeadOf({ path: '/ko/krw/search', base: 'https://olmoa.com', title: 't' }).robots, 'noindex,follow');
  assert.equal(routeHead({ path: '/ko/krw/search', base: 'https://olmoa.com', title: 't' }).robots, 'noindex,follow', 'server mirror agrees');
});

// 4. Product titles: name | brand | OLMOA, clipped, description from the text.
await t.test('4. product titles carry the brand', async () => {
  const h = productHeadOf({ title: '무선 이어폰 Pro', brand: 'Acme', description_html: '<p>노이즈캔슬링</p>' }, '/product/p1', 'https://olmoa.com');
  assert.equal(h.title, '무선 이어폰 Pro | Acme | OLMOA');
  assert.ok(h.description.includes('노이즈캔슬링'));
  for (const b of BANNED) assert.ok(!h.title.includes(b) && !h.description.includes(b), `no ${b}`);
  const m = productMeta({ title: '무선 이어폰 Pro', description_html: '<p>노이즈캔슬링</p>' }, 'Acme');
  assert.equal(m.title, h.title, 'server mirror agrees');
});

// 5. Category titles: child - parent | OLMOA; top level without the dash.
await t.test('5. category titles follow the coupang rule', async () => {
  const h = categoryHeadOf({ name: '원피스', parentName: '여성의류', subNames: ['원피스', '블라우스', '니트'], subTotal: 6, productCount: 120 }, '/category/dress', 'https://olmoa.com');
  assert.equal(h.title, '원피스 - 여성의류 | OLMOA');
  assert.ok(h.description.includes('원피스·블라우스·니트') && h.description.includes('하위 6개') && h.description.includes('상품 120개'));
  for (const b of BANNED) assert.ok(!h.title.includes(b) && !h.description.includes(b), `no ${b}`);
  const top = categoryHeadOf({ name: '뷰티', productCount: 42 }, '/category/beauty', 'https://olmoa.com');
  assert.equal(top.title, '뷰티 | OLMOA');
  const m = categoryMeta({ name: '원피스' }, 120, '여성의류', ['원피스', '블라우스', '니트'], 6);
  assert.equal(m.title, h.title, 'server mirror agrees');
  assert.equal(m.description, h.description, 'server description agrees');
});

// 6. Shell descriptions are the site tagline, nothing ungrounded.
await t.test('6. shell descriptions equal the 6-5 tagline', async () => {
  const shell = readFileSync('apps/storefront/index.html', 'utf8');
  for (const prop of ['<meta name="description"', '<meta property="og:description"', '<meta property="twitter:description"']) {
    const line = shell.split('\n').find((l) => l.includes(prop));
    assert.ok(line && line.includes(`content="${SITE_TAGLINE}"`), `${prop} is the tagline`);
  }
  for (const b of BANNED) assert.ok(!shell.includes(b), `shell has no ${b}`);
});

// 7. Gallery alts: product name + live options + position, never blank.
await t.test('7. gallery alts combine name, options and position', async () => {
  const skus = [
    { option_combination_json: JSON.stringify({ 색상: '블랙', 용량: '128GB' }) },
    { option_combination_json: JSON.stringify({ 색상: '화이트', 용량: '128GB' }) }
  ];
  assert.equal(galleryAltOf('무선 이어폰 Pro', skus, 0, 3), '무선 이어폰 Pro 블랙·128GB·화이트 1');
  assert.equal(galleryAltOf('무선 이어폰 Pro', skus, 2, 3), '무선 이어폰 Pro 블랙·128GB·화이트 3');
  assert.equal(galleryAltOf('케이스', [], 0, 1), '케이스', 'single image, no options');
  assert.equal(galleryAltOf('  ', [{ option_combination_json: 'broken' }], 0, 2), '상품 1', 'never blank');
  const many = ['a', 'b', 'c', 'd', 'e'].map((v) => ({ option_combination_json: JSON.stringify({ 색상: v }) }));
  assert.equal(galleryAltOf('티셔츠', many, 0, 1), '티셔츠 a·b·c 외 2종');
});

// 8. Broken images render a neutral placeholder, never a broken icon.
await t.test('8. gallery swallows load failures without remote fallback', async () => {
  const g = readFileSync('packages/ui/src/components/OmImageGallery.vue', 'utf8');
  assert.ok(g.includes('@error="markFailed('), 'error handler on every img');
  assert.ok((g.match(/@error="markFailed\(/g) || []).length >= 3, 'stage, thumbs and viewer covered');
  assert.ok(g.includes('ImageOff') && g.includes('이미지 없음'), 'neutral placeholder');
  assert.ok(!/https?:\/\//.test(g), 'no remote fallback URL');
  assert.ok(g.includes('v-if="!failed.has(img.src)"'), 'dead thumbnails drop out');
});

// 9. PLP wires the category rule and page-aware canonicals.
await t.test('9. PlpLayout calls the category builder with the route query', async () => {
  const v = readFileSync('apps/storefront/src/components/plp/PlpLayout.vue', 'utf8');
  assert.ok(v.includes('categoryHeadOf('), 'category rule wired');
  assert.ok(v.includes('route.query'), 'query threaded');
  assert.ok(v.includes('canonicalOf(origin, route.path, query)'), 'page-aware canonical in JSON-LD');
  assert.ok(v.includes('watch(() => route.query.page'), 'page-only navigation moves the head');
  const d = readFileSync('apps/storefront/src/views/ProductDetailView.vue', 'utf8');
  assert.ok(d.includes('galleryAltOf('), 'detail gallery uses the alt builder');
});

t.finish();
