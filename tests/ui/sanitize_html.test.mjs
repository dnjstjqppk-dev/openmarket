// tests/ui/sanitize_html.test.mjs
// P0-1: storefront product descriptions must use the allowlist sanitizer.
// The old regex stripper in ProductDetailView.vue let slash-separated handlers
// (`<img/src=x/onerror=...>`) through to v-html (stored XSS when server output
// is bypassed). Run: node tests/ui/sanitize_html.test.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRunner } from '../lib/harness.mjs';
import { stripToSafeHtml } from '../../apps/storefront/src/utils/stripHtml.ts';

const t = createRunner('Storefront HTML sanitizer (P0-1)');
const read = (p) => readFileSync(p, 'utf8');

await t.test('S01 slash-separated and quoted handlers are killed', async () => {
  assert.ok(!/onerror/i.test(stripToSafeHtml('<img/src=x/onerror=alert(document.cookie)>')));
  assert.ok(!/onload/i.test(stripToSafeHtml('<img src="https://c.example/i.png" onload="alert(1)">')));
  assert.ok(!/on\w+\s*=/i.test(stripToSafeHtml('<div onclick=alert(1)>x</div>')));
});

await t.test('S02 dangerous URLs and subtrees are dropped', async () => {
  assert.ok(!/javascript:/i.test(stripToSafeHtml('<a href="javascript:alert(1)">x</a>')));
  assert.ok(!/script:/i.test(stripToSafeHtml('<a href="java\tscript:alert(1)">x</a>')));
  assert.ok(!/<script/i.test(stripToSafeHtml('<p>t</p><script>alert(1)</script>')));
  assert.ok(!/<iframe/i.test(stripToSafeHtml('<iframe src="https://evil.example"></iframe>')));
  assert.ok(!/evil\.example/.test(stripToSafeHtml('<a href="//evil.example/x">e</a>')));
});

await t.test('S03 legitimate descriptions survive', async () => {
  const clean = stripToSafeHtml('<p>안전 설명</p><img src="https://c.example/i.jpg" alt="a">');
  assert.ok(clean.includes('안전 설명') && clean.includes('https://c.example/i.jpg'));
  assert.ok(stripToSafeHtml('<div><b>b</b><unknown-tag>x</unknown-tag></div>').includes('<b>b</b>'));
  assert.ok(stripToSafeHtml('plain <3 text').includes('plain <3 text'));
  assert.equal(stripToSafeHtml(''), '');
  assert.equal(stripToSafeHtml(null), '');
});

await t.test('S04 detail view renders the sanitized value', async () => {
  const v = read('apps/storefront/src/views/ProductDetailView.vue');
  assert.ok(v.includes("from '../utils/stripHtml'"), 'view imports the allowlist sanitizer');
  assert.ok(v.includes('stripToSafeHtml(product.value?.description_html)'), 'descriptionHtml uses it');
  assert.ok(v.includes('v-html="descriptionHtml"'), 'template renders the sanitized value');
  assert.ok(!v.includes('son\\w+'), 'old on* regex is gone');
  assert.ok(!v.includes('<script\\b[^<]*'), 'old script regex is gone');
  assert.ok(!v.includes('v-html="product.description_html"'), 'raw seller HTML is never rendered');
});

await t.test('S05 vulnerable helper is gone from storefront config', async () => {
  const c = read('apps/storefront/src/config.ts');
  assert.ok(!c.includes('sanitizeHtml'), 'unused regex sanitizeHtml removed');
});

t.finish();
