// tests/browser/screenshot_diff.mjs — compares two route_smoke screenshot folders pixel by pixel (in headless Chrome's
// canvas, no image libraries) and lists screens by share of changed pixels. Use it to show what a CSS/build change
// did to every screen: run route_smoke on the old and the new build against the same API, then
//   node tests/browser/screenshot_diff.mjs <baseDir> <newDir> [out.json]
// A pixel counts as changed when any RGB channel differs by more than 24 (ignores antialiasing noise).
import fs from 'node:fs';
import path from 'node:path';
import { launchBrowser } from './cdp.mjs';

const [baseDir, newDir, outFile] = process.argv.slice(2);
if (!baseDir || !newDir) { console.error('usage: screenshot_diff.mjs <baseDir> <newDir> [out.json]'); process.exit(2); }

const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(path.join(d, e.name)) : e.name.endsWith('.png') ? [path.join(d, e.name)] : []);
const rel = walk(baseDir).map((f) => path.relative(baseDir, f).replace(/\\/g, '/')).sort();

const browser = await launchBrowser({ port: 9342 });
const page = await browser.newPage();
await page.goto('about:blank');
const rows = [];
try {
  for (const r of rel) {
    const nf = path.join(newDir, r);
    if (!fs.existsSync(nf)) { rows.push({ screen: r, missing_in_new: true }); continue; }
    const a = fs.readFileSync(path.join(baseDir, r)).toString('base64');
    const b = fs.readFileSync(nf).toString('base64');
    const res = await page.eval(`(async () => {
      const load = (s) => new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = no; i.src = 'data:image/png;base64,' + s; });
      const [x, y] = await Promise.all([load(${JSON.stringify(a)}), load(${JSON.stringify(b)})]);
      const w = Math.min(x.width, y.width), h = Math.min(x.height, y.height);
      const px = (img) => { const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d'); g.drawImage(img, 0, 0); return g.getImageData(0, 0, w, h).data; };
      const p = px(x), q = px(y);
      let diff = 0, top = h, bottom = -1;
      for (let i = 0; i < p.length; i += 4) {
        if (Math.abs(p[i] - q[i]) > 24 || Math.abs(p[i + 1] - q[i + 1]) > 24 || Math.abs(p[i + 2] - q[i + 2]) > 24) {
          diff++; const row = Math.floor(i / 4 / w); if (row < top) top = row; if (row > bottom) bottom = row;
        }
      }
      return { w, h, size_changed: x.width !== y.width || x.height !== y.height, changed_pct: +(100 * diff / (w * h)).toFixed(2), changed_rows: bottom < 0 ? null : [top, bottom] };
    })()`);
    rows.push({ screen: r, ...res });
  }
} finally {
  await browser.close();
}
rows.sort((m, n) => (n.changed_pct ?? 101) - (m.changed_pct ?? 101));
for (const r of rows) console.log(`${String(r.changed_pct ?? 'MISSING').padStart(7)}%  ${r.screen}${r.changed_rows ? `  rows ${r.changed_rows[0]}-${r.changed_rows[1]}` : ''}`);
if (outFile) fs.writeFileSync(outFile, JSON.stringify({ baseDir, newDir, generated: new Date().toISOString(), rows }, null, 2));
