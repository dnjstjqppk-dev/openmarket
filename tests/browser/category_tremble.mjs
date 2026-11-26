// tests/browser/category_tremble.mjs — category-bar flutter check (CDP, no deps).
// The App shell hides the category bar on scroll down. Without a direction
// lock, every ±2px finger/trackpad wiggle (and scroll-anchor adjustments from
// the sticky header's own height change) flipped it — visible trembling on
// desktop, tablet and mobile. This drives a down-scroll with realistic
// micro-jitter on all three viewports and counts hidden<->shown flips.
// Needs a live API + built storefront (same contract as lcp_probe.mjs):
//   VITE_API_BASE_URL=http://127.0.0.1:8787 npm run build --workspace=apps/storefront
//   node scripts/local-api-server.mjs 8787 &
//   API_URL=http://127.0.0.1:8787 DIST=dist node tests/browser/category_tremble.mjs
// Verdict is the exit code (0 when every viewport stays within budget).
// NOT in `npm test`: like the other browser suites it needs a live browser
// and API (see tests/README.md).
import { spawn } from 'node:child_process';
import path from 'node:path';
import { launchBrowser } from './cdp.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1')), '../..');
const API = process.env.API_URL || 'https://olmoa-api.dnjstjqppk.workers.dev';
const HOST = process.env.HOST || '127.0.0.1';
const PORT = Number(process.env.PORT || '4191');
const DIST = process.env.DIST || 'dist';
const SF = process.env.SF_URL || `http://${HOST}:${PORT}`;
const FLIP_BUDGET = 2;

const server = spawn(process.platform === 'win32' ? 'npx.cmd' : 'npx',
  ['vite', 'preview', '--outDir', DIST, '--port', String(PORT), '--strictPort', '--host', HOST],
  { cwd: path.join(ROOT, 'apps/storefront'), shell: true, stdio: 'ignore' });
for (let i = 0; i < 60; i++) {
  try { if ((await fetch(`${SF}/`)).ok) break; } catch { /* starting */ }
  await new Promise((r) => setTimeout(r, 500));
}

const browser = await launchBrowser({ port: 9344 });
const rows = [];
try {
  for (const vp of ['desktop', 'tablet_portrait', 'mobile']) {
    const page = await browser.newPage();
    await page.viewport(vp);
    await page.goto(`${SF}/category/womens-clothing`, {});
    await page.idle(2500);
    const r = await page.eval(`(async () => {
      const bar = document.querySelector('header > div.overflow-hidden') || document.querySelector('header div.overflow-hidden');
      if (!bar) return { error: 'bar-not-found' };
      const maxY = document.documentElement.scrollHeight - window.innerHeight;
      const zone = Math.max(600, Math.min(2500, Math.floor(maxY * 0.6)));
      const hidden = () => bar.className.includes('max-h-0');
      let flips = 0, prev = hidden();
      const rec = () => { const h = hidden(); if (h !== prev) flips++; prev = h; };
      for (let y = 0; y <= zone; y += 10) { window.scrollTo(0, y); await new Promise((r) => requestAnimationFrame(r)); rec(); }
      let y = zone;
      for (let i = 0; i < 60; i++) { y += (i % 2 === 0 ? -3 : 2); window.scrollTo(0, y); await new Promise((r) => requestAnimationFrame(r)); rec(); }
      const downFlips = flips;
      // Settle: with no input at all, the bar must never flip. Any flip here
      // is the sticky-header feedback loop oscillating on its own.
      const idleStart = flips;
      for (let i = 0; i < 30; i++) { await new Promise((r) => setTimeout(r, 100)); rec(); }
      const idleFlips = flips - idleStart;
      window.scrollTo(0, Math.max(0, zone - 400));
      await new Promise((r) => setTimeout(r, 800));
      rec();
      return { maxY, zone, downFlips, idleFlips, totalFlips: flips, endShown: !hidden() };
    })()`);
    rows.push({ vp, ...r });
    console.log(`${vp}: downFlips=${r.downFlips} idleFlips=${r.idleFlips} totalFlips=${r.totalFlips} endShown=${r.endShown} (zone=${r.zone}/${r.maxY})`);
    page.close();
  }
} finally {
  await browser.close();
  try { process.platform === 'win32' ? spawn('taskkill', ['/pid', String(server.pid), '/T', '/F']) : server.kill(); } catch { /* ignore */ }
}

const bad = rows.filter((r) => r.error || r.downFlips > FLIP_BUDGET || r.idleFlips > 0 || !r.endShown);
console.log(bad.length ? `TREMBLE: ${bad.map((r) => r.vp).join(', ')}` : 'NO TREMOR ON ANY VIEWPORT');
process.exitCode = bad.length ? 1 : 0;
