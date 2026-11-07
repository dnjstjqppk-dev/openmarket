// tests/browser/lcp_probe.mjs — Largest Contentful Paint on key routes (CDP, no deps).
// Self-contained: builds must exist (DIST, default dist), the probe spawns the three
// `vite preview` servers itself and serves the LCP budget verdict as its exit code
// (0 within budget, 1 over). The API runs separately (scripts/local-api-server.mjs):
//   VITE_API_BASE_URL=http://127.0.0.1:8787 npm run build --workspaces  (once, per app --outDir)
//   node scripts/local-api-server.mjs 8787 &
//   API_URL=http://127.0.0.1:8787 DIST=dist-local node tests/browser/lcp_probe.mjs [out.json]
// Measures LCP at desktop 1440 and mobile 390 after full load + 5 s settle.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { launchBrowser } from './cdp.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1')), '../..');
const OUT = path.resolve(process.argv[2] || path.join(ROOT, 'reports/v4/phase3/lcp.json'));
const API = process.env.API_URL || 'https://olmoa-api.dnjstjqppk.workers.dev';
const HOST = process.env.HOST || '127.0.0.1';
const PORTS = (process.env.PORTS || '4183,4184,4185').split(',').map(Number);
const DIST = process.env.DIST || 'dist';
const SF = process.env.SF_URL || `http://${HOST}:${PORTS[0]}`;
const AD = process.env.AD_URL || `http://${HOST}:${PORTS[1]}`;
const PT = process.env.PT_URL || `http://${HOST}:${PORTS[2]}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

const APPS = [
  { app: 'storefront', base: SF }, { app: 'admin', base: AD }, { app: 'partner', base: PT }
];
// An explicit *_URL override means "already served elsewhere" — spawn only the rest.
const OVERRIDDEN = new Set([
  process.env.SF_URL ? 'storefront' : null, process.env.AD_URL ? 'admin' : null, process.env.PT_URL ? 'partner' : null
].filter(Boolean));
const servers = [];
for (const a of APPS.filter((x) => !OVERRIDDEN.has(x.app))) {
  const port = a.base.match(/:(\d+)$/)?.[1] || '4183';
  servers.push(spawn(process.platform === 'win32' ? 'npx.cmd' : 'npx',
    ['vite', 'preview', '--outDir', DIST, '--port', port, '--strictPort', '--host', HOST],
    { cwd: path.join(ROOT, 'apps', a.app), shell: true, stdio: 'ignore' }));
}
for (const a of APPS.filter((x) => !OVERRIDDEN.has(x.app))) {
  for (let i = 0; i < 60; i++) { try { if ((await fetch(`${a.base}/`)).ok) break; } catch { /* starting */ } await sleep(500); }
}

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
  for (const p of servers) { try { process.platform === 'win32' ? spawn('taskkill', ['/pid', String(p.pid), '/T', '/F']) : p.kill(); } catch { /* ignore */ } }
}
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify({ generated: new Date().toISOString(), api: API, budget_ms: 2500, rows }, null, 2));
const over = rows.flatMap((r) => ['desktop', 'mobile'].filter((vp) => r[vp] > 2500 || r[vp] < 0).map((vp) => `${r.url} ${vp}=${r[vp]}`));
console.log(over.length ? `OVER BUDGET: ${over.join(' | ')}` : 'ALL ROUTES WITHIN 2500 ms LCP BUDGET');
process.exitCode = over.length ? 1 : 0;
