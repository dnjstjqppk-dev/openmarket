// tests/browser/route_smoke.mjs — opens EVERY route of the three built apps (dist, `vite preview`) in headless
// Chrome at desktop 1440 and mobile 390, records: rendered (non-empty #app), final URL (login redirect),
// console errors, failed HTTP requests, horizontal overflow; saves screenshots.
// Uses whatever API the build points at with GET requests only (no login, no writes) — unless LOGIN=1, which signs in
// through each app's real login form with the dev-seed accounts first. LOGIN=1 is refused unless API_URL is local.
//   node tests/browser/route_smoke.mjs [outDir]
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { launchBrowser, VIEWPORTS } from './cdp.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1')), '../..');
const OUT = path.resolve(process.argv[2] || path.join(ROOT, 'reports/v4/phase2/smoke'));
// VPS selects the viewport matrix, e.g. VPS=desktop,desktop1280,tablet_landscape,tablet_portrait,mobile,mobile360.
// WIDTH_SUFFIX=1 names files [View]_[viewport]_[width].png per the commercialization spec.
const VPS = (process.env.VPS || 'desktop,mobile').split(',').map((s) => s.trim()).filter((s) => VIEWPORTS[s]);
if (!VPS.length) { console.error('no valid viewports in VPS (known: ' + Object.keys(VIEWPORTS).join(',') + ')'); process.exit(2); }
const WIDTH_SUFFIX = process.env.WIDTH_SUFFIX === '1';
const API = process.env.API_URL || 'https://olmoa-api.dnjstjqppk.workers.dev';
// Local gateway (.dev.vars) only allows http://localhost:5173-5175, so a local run must use those origins:
//   API_URL=http://127.0.0.1:8787 HOST=localhost PORTS=5173,5174,5175 DIST=dist-local node tests/browser/route_smoke.mjs
// (dist-local = `VITE_API_BASE_URL=http://127.0.0.1:8787 vite build --outDir dist-local`, API from scripts/local-api-server.mjs)
const HOST = process.env.HOST || '127.0.0.1';
const PORTS = (process.env.PORTS || '4183,4184,4185').split(',').map(Number);
const DIST = process.env.DIST || 'dist';
// ONLY=<regex> limits the run to matching "app:/route" keys, e.g. ONLY='^storefront:/(cart)?$'
const ONLY = process.env.ONLY ? new RegExp(process.env.ONLY) : null;
// REMOTE=<storefront>,<admin>,<partner> opens already deployed sites instead of local vite previews (GET only).
const REMOTE = process.env.REMOTE ? process.env.REMOTE.split(',') : null;
if (REMOTE && process.env.LOGIN === '1') { console.error('LOGIN=1 is not allowed with REMOTE'); process.exit(2); }
const APPS = [{ app: 'storefront', port: PORTS[0] }, { app: 'admin', port: PORTS[1] }, { app: 'partner', port: PORTS[2] }]
  .map((a, i) => ({ ...a, base: REMOTE ? REMOTE[i].replace(/\/$/, '') : `http://${HOST}:${a.port}` }));
const inv = JSON.parse(fs.readFileSync(path.join(ROOT, 'reports/v4/phase1/inventory.json'), 'utf8'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const LOGIN = process.env.LOGIN === '1';
if (LOGIN && !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(API)) {
  console.error(`LOGIN=1 only runs against a local API (got ${API})`);
  process.exit(2);
}
const DEV_PASSWORD = process.env.SMOKE_PASSWORD || 'DevPass!2026#'; // migrations/dev/seed_local_dev.sql
const LOGINS = {
  storefront: { email: 'customer@example.com', fields: ['#login-email', '#login-password'] },
  admin: { email: 'admin@openmarket.com', fields: ['#adm-email', '#adm-pw'] },
  partner: { email: 'seller@temu-supply.com', fields: ['#pt-email', '#pt-pw'] }
};
async function signIn(page, base, app) {
  const { email, fields } = LOGINS[app];
  await page.goto(`${base}/login`);
  await page.waitFor(`document.querySelector('${fields[0]}')`);
  await page.eval(`(() => {
    const set = (sel, v) => { const el = document.querySelector(sel); el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); };
    set('${fields[0]}', ${JSON.stringify(email)}); set('${fields[1]}', ${JSON.stringify(DEV_PASSWORD)});
    document.querySelector('${fields[0]}').closest('form').requestSubmit();
  })()`);
  await page.waitFor("!location.pathname.endsWith('/login')", 15000);
  return page.eval('location.pathname');
}

// real identifiers for dynamic routes (read-only)
const j = async (p) => { try { return await (await fetch(API + p)).json(); } catch { return {}; } };
const prod = ((await j('/api/v1/products?limit=1')).data || [])[0] || {};
const cats = (await j('/api/v1/categories')).data || [];
const params = { slug: prod.slug || prod.id || 'none', id: prod.partner_id || 'none', type: 'shipping' };
const catSlug = (cats[0] && (cats[0].slug || cats[0].id)) || 'none';
const fill = (url, app) => url.replace(':slug', url.startsWith('/category') ? catSlug : params.slug).replace(':id', app === 'storefront' && url.startsWith('/orders') ? 'unknown-order' : params.id).replace(':type', params.type);

const servers = [];
for (const a of REMOTE ? [] : APPS) {
  const p = spawn(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['vite', 'preview', '--outDir', DIST, '--port', String(a.port), '--strictPort', '--host', HOST], { cwd: path.join(ROOT, 'apps', a.app), shell: true, stdio: 'ignore' });
  servers.push(p);
}
for (const a of APPS) {
  for (let i = 0; i < 60; i++) { try { if ((await fetch(`${a.base}/`)).ok) break; } catch { /* starting */ } await sleep(500); }
}

const browser = await launchBrowser({ port: 9341 });
const page = await browser.newPage();
const results = [];
try {
  for (const a of APPS) {
    if (LOGIN) console.log(`signed in to ${a.app} as ${LOGINS[a.app].email} → ${await signIn(page, a.base, a.app)}`);
    for (const s of inv[a.app].screens) {
      if (s.redirect || !s.view) continue;
      if (ONLY && !ONLY.test(`${a.app}:${s.url}`)) continue;
      const url = `${a.base}${fill(s.url, a.app)}`;
      const row = { app: a.app, route: s.url, view: s.view, url };
      for (const vp of VPS) {
        await page.viewport(vp);
        page.console = []; page.network = [];
        await page.goto(url);
        await page.idle(900);
        const info = await page.eval(`({ path: location.pathname, len: (document.querySelector('#app')?.innerText || '').trim().length, title: document.title })`);
        const overflow = await page.hasHorizontalOverflow();
        const base = WIDTH_SUFFIX ? `${s.view}_${vp}_${VIEWPORTS[vp].width}` : `${s.view}_${vp}`;
        const file = path.join(OUT, a.app, `${base}.png`);
        await page.screenshot(file);
        row[vp] = {
          final_path: info.path,
          rendered: info.len > 20,
          redirected_to_login: info.path.endsWith('/login') && !s.url.endsWith('/login'),
          width: VIEWPORTS[vp].width,
          horizontal_overflow: overflow,
          console_errors: page.console.map((c) => String(c.text).slice(0, 160)),
          http_errors: page.network.filter((n) => !String(n.url).includes('/favicon')).map((n) => `${n.status} ${String(n.url).replace(API, 'API').slice(0, 120)}`),
          screenshot: path.relative(ROOT, file).replace(/\\/g, '/')
        };
      }
      const cells = VPS.map((vp) => row[vp]);
      const primary = cells[0];
      const overflows = VPS.filter((vp) => row[vp].horizontal_overflow).map((vp) => `${vp}@${row[vp].width}`);
      const consoles = cells.reduce((n, c) => n + c.console_errors.length, 0);
      row.verdict = cells.some((c) => !c.rendered) ? 'FAIL_BLANK' : LOGIN && cells.some((c) => c.redirected_to_login) ? 'FAIL_AUTH' : consoles ? 'WARN_CONSOLE' : overflows.length ? 'WARN_OVERFLOW' : 'PASS';
      results.push(row);
      console.log(`${row.verdict.padEnd(13)} ${a.app.padEnd(10)} ${s.url.padEnd(26)} → ${primary.final_path}${consoles ? ` console:${consoles}` : ''}${overflows.length ? ' overflow:' + overflows.join(',') : ''}`);
    }
  }
} finally {
  await browser.close();
  for (const p of servers) { try { process.platform === 'win32' ? spawn('taskkill', ['/pid', String(p.pid), '/T', '/F']) : p.kill(); } catch { /* ignore */ } }
}
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify({ api: API, logged_in: LOGIN, generated: new Date().toISOString(), results }, null, 2));
const count = (v) => results.filter((r) => r.verdict === v).length;
console.log(JSON.stringify({ routes: results.length, PASS: count('PASS'), WARN_CONSOLE: count('WARN_CONSOLE'), WARN_OVERFLOW: count('WARN_OVERFLOW'), FAIL_BLANK: count('FAIL_BLANK'), FAIL_AUTH: count('FAIL_AUTH') }));
