// tests/browser/lcp_probe.mjs — Largest Contentful Paint on key routes (CDP, no deps).
// Previews must already run (the matrix owns 5173-5175 while it runs; use 4183-4185):
//   npx vite preview --outDir dist-local --port 4183   (per app, HOST=127.0.0.1)
//   API_URL=http://127.0.0.1:8787 node tests/browser/lcp_probe.mjs [out.json]
// Measures LCP at desktop 1440 and mobile 390 after full load + 5 s settle.
import fs from 'node:fs';
import path from 'node:path';
import { launchBrowser } from './cdp.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1')), '../..');
const OUT = path.resolve(process.argv[2] || path.join(ROOT, 'reports/v4/phase3/lcp.json'));
const API = process.env.API_URL || 'https://olmoa-api.dnjstjqppk.workers.dev';
const SF = process.env.SF_URL || 'http://127.0.0.1:4183';
const AD = process.env.AD_URL || 'http://127.0.0.1:4184';
const PT = process.env.PT_URL || 'http://127.0.0.1:4185';

const j = async (p) => { try { return await (await fetch(API + p)).json(); } catch { return {}; } };
const prod = ((await j('/api/v1/products?limit=1')).data || [])[0] || {};
const cats = (await j('/api/v1/categories')).data || [];
const prodSlug = prod.slug || prod.id || 'none';
const catSlug = (cats[0] && (cats[0].slug || cats[0].id)) || 'none';

const ROUTES = [
  ['storefront', `${SF}/`],
  ['storefront', `${SF}/categories`],
  ['storefront', `${SF}/category/${catSlug}`],
  ['storefront', `${SF}/product/${prodSlug}`],
  ['storefront', `${SF}/search?q=${encodeURIComponent('가방')}`],
  ['storefront', `${SF}/cart`],
  ['admin', `${AD}/login`],
  ['partner', `${PT}/login`]
];

const browser = await launchBrowser({ port: 9343 });
const page = await browser.newPage();
const rows = [];
try {
  for (const [app, url] of ROUTES) {
    const row = { app, url };
    for (const vp of ['desktop', 'mobile']) {
      await page.viewport(vp);
      await page.goto(url);
      await page.idle(1000);
      const lcp = await page.eval(`new Promise((res) => {
        let v = 0;
        try {
          const po = new PerformanceObserver((list) => { for (const e of list.getEntries()) v = e.renderTime || e.loadTime || e.startTime; });
          po.observe({ type: 'largest-contentful-paint', buffered: true });
          setTimeout(() => { po.disconnect(); res(Math.round(v)); }, 5000);
        } catch { res(-1); }
      })`);
      row[vp] = lcp;
      console.log(`${String(lcp).padStart(5)} ms  ${vp.padEnd(8)} ${url}`);
    }
    rows.push(row);
  }
} finally {
  await browser.close();
}
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify({ generated: new Date().toISOString(), api: API, budget_ms: 2500, rows }, null, 2));
const over = rows.flatMap((r) => ['desktop', 'mobile'].filter((vp) => r[vp] > 2500).map((vp) => `${r.url} ${vp}=${r[vp]}`));
console.log(over.length ? `OVER BUDGET: ${over.join(' | ')}` : 'ALL ROUTES WITHIN 2500 ms LCP BUDGET');
