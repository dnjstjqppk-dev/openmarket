// tests/browser/route_smoke.mjs — opens EVERY route of the three built apps (dist, `vite preview`) in headless
// Chrome at desktop 1440 and mobile 390, records: rendered (non-empty #app), final URL (login redirect),
// console errors, failed HTTP requests, horizontal overflow; saves screenshots.
// Uses whatever API the build points at with GET requests only (no login, no writes).
//   node tests/browser/route_smoke.mjs [outDir]
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { launchBrowser } from './cdp.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1')), '../..');
const OUT = path.resolve(process.argv[2] || path.join(ROOT, 'reports/v4/phase2/smoke'));
const API = process.env.API_URL || 'https://olmoa-api.dnjstjqppk.workers.dev';
// Local gateway (.dev.vars) only allows http://localhost:5173-5175, so a local run must use those origins:
//   API_URL=http://127.0.0.1:8787 HOST=localhost PORTS=5173,5174,5175 DIST=dist-local node tests/browser/route_smoke.mjs
// (dist-local = `VITE_API_BASE_URL=http://127.0.0.1:8787 vite build --outDir dist-local`, API from scripts/local-api-server.mjs)
const HOST = process.env.HOST || '127.0.0.1';
const PORTS = (process.env.PORTS || '4183,4184,4185').split(',').map(Number);
const DIST = process.env.DIST || 'dist';
const APPS = [{ app: 'storefront', port: PORTS[0] }, { app: 'admin', port: PORTS[1] }, { app: 'partner', port: PORTS[2] }];
const inv = JSON.parse(fs.readFileSync(path.join(ROOT, 'reports/v4/phase1/inventory.json'), 'utf8'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// real identifiers for dynamic routes (read-only)
const j = async (p) => { try { return await (await fetch(API + p)).json(); } catch { return {}; } };
const prod = ((await j('/api/v1/products?limit=1')).data || [])[0] || {};
const cats = (await j('/api/v1/categories')).data || [];
const params = { slug: prod.slug || prod.id || 'none', id: prod.partner_id || 'none', type: 'shipping' };
const catSlug = (cats[0] && (cats[0].slug || cats[0].id)) || 'none';
const fill = (url, app) => url.replace(':slug', url.startsWith('/category') ? catSlug : params.slug).replace(':id', app === 'storefront' && url.startsWith('/orders') ? 'unknown-order' : params.id).replace(':type', params.type);

const servers = [];
for (const a of APPS) {
  const p = spawn(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['vite', 'preview', '--outDir', DIST, '--port', String(a.port), '--strictPort', '--host', HOST], { cwd: path.join(ROOT, 'apps', a.app), shell: true, stdio: 'ignore' });
  servers.push(p);
}
for (const a of APPS) {
  for (let i = 0; i < 60; i++) { try { if ((await fetch(`http://${HOST}:${a.port}/`)).ok) break; } catch { /* starting */ } await sleep(500); }
}

const browser = await launchBrowser({ port: 9341 });
const page = await browser.newPage();
const results = [];
try {
  for (const a of APPS) {
    for (const s of inv[a.app].screens) {
      if (s.redirect || !s.view) continue;
      const url = `http://${HOST}:${a.port}${fill(s.url, a.app)}`;
      const row = { app: a.app, route: s.url, view: s.view, url };
      for (const vp of ['desktop', 'mobile']) {
        await page.viewport(vp);
        page.console = []; page.network = [];
        await page.goto(url);
        await page.idle(900);
        const info = await page.eval(`({ path: location.pathname, len: (document.querySelector('#app')?.innerText || '').trim().length, title: document.title })`);
        const overflow = await page.hasHorizontalOverflow();
        const file = path.join(OUT, a.app, `${s.view}_${vp}.png`);
        await page.screenshot(file);
        row[vp] = {
          final_path: info.path,
          rendered: info.len > 20,
          redirected_to_login: info.path.endsWith('/login') && !s.url.endsWith('/login'),
          horizontal_overflow: vp === 'mobile' ? overflow : false,
          console_errors: page.console.map((c) => String(c.text).slice(0, 160)),
          http_errors: page.network.filter((n) => !String(n.url).includes('/favicon')).map((n) => `${n.status} ${String(n.url).replace(API, 'API').slice(0, 120)}`),
          screenshot: path.relative(ROOT, file).replace(/\\/g, '/')
        };
      }
      const d = row.desktop; const m = row.mobile;
      row.verdict = !d.rendered || !m.rendered ? 'FAIL_BLANK' : d.console_errors.length || m.console_errors.length ? 'WARN_CONSOLE' : m.horizontal_overflow ? 'WARN_OVERFLOW' : 'PASS';
      results.push(row);
      console.log(`${row.verdict.padEnd(13)} ${a.app.padEnd(10)} ${s.url.padEnd(26)} → ${d.final_path}${d.console_errors.length ? ` console:${d.console_errors.length}` : ''}${m.horizontal_overflow ? ' overflow@390' : ''}`);
    }
  }
} finally {
  await browser.close();
  for (const p of servers) { try { process.platform === 'win32' ? spawn('taskkill', ['/pid', String(p.pid), '/T', '/F']) : p.kill(); } catch { /* ignore */ } }
}
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify({ api: API, generated: new Date().toISOString(), results }, null, 2));
const count = (v) => results.filter((r) => r.verdict === v).length;
console.log(JSON.stringify({ routes: results.length, PASS: count('PASS'), WARN_CONSOLE: count('WARN_CONSOLE'), WARN_OVERFLOW: count('WARN_OVERFLOW'), FAIL_BLANK: count('FAIL_BLANK') }));
