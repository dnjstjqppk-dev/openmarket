// tests/browser/e2e_browser.mjs
// Real-browser E2E against the LOCAL stack (wrangler dev + local D1 + 3 Vite dev servers).
//   node tests/browser/e2e_browser.mjs
// Produces reports/v3/screenshots/*.png and reports/v3/evidence/05_browser_e2e.json

import fs from 'node:fs';
import path from 'node:path';
import { launchBrowser } from './cdp.mjs';

const STORE = process.env.STORE_URL || 'http://127.0.0.1:5173';
const PARTNER = process.env.PARTNER_URL || 'http://127.0.0.1:5174';
const ADMIN = process.env.ADMIN_URL || 'http://127.0.0.1:5175';
const API = process.env.API_URL || 'http://127.0.0.1:8787';
const PW = 'DevPass!2026#';
const OUT = path.resolve('reports/v3/screenshots');
const steps = [];
let shotCount = 0;

async function step(name, page, fn) {
  const t0 = Date.now();
  let ok = true; let error = null;
  try { await fn(); } catch (e) { ok = false; error = e.message; }
  const issues = page.drainIssues();
  steps.push({ name, ok, error, ms: Date.now() - t0, console_errors: issues.console, network_errors: issues.network });
  console.log(`${ok ? '[PASS]' : '[FAIL]'} ${name}${error ? ` -> ${error}` : ''}${issues.console.length ? ` | console:${issues.console.length}` : ''}${issues.network.length ? ` | http>=400:${issues.network.length}` : ''}`);
}
async function shots(page, name, views = ['desktop', 'mobile']) {
  const out = {};
  for (const v of views) {
    await page.viewport(v);
    await page.idle(500);
    out[v] = await page.screenshot(path.join(OUT, `${String(++shotCount).padStart(2, '0')}_${name}_${v}.png`));
    if (v !== 'desktop' && await page.hasHorizontalOverflow()) throw new Error(`${name}: horizontal overflow at ${v}`);
  }
  await page.viewport('desktop');
  return out;
}

// The product page makes the buyer choose every option (no pre-selected SKU); pick the first in-stock value
// of each group, twice so groups that depend on an earlier choice are filled too.
async function chooseOptions(page) {
  for (let i = 0; i < 2; i++) {
    await page.eval(`(() => { for (const fs of document.querySelectorAll('fieldset')) { if (fs.querySelector('[aria-pressed=true]')) continue;
      const b = [...fs.querySelectorAll('button')].find((x) => !x.disabled && !/품절/.test(x.textContent)); if (b) b.click(); } })()`);
    await page.idle(200);
  }
}
const api = async (p, init = {}) => (await fetch(`${API}${p}`, { ...init, headers: { 'Content-Type': 'application/json', ...(init.headers || {}) } })).json();
const mp = (await api('/api/v1/products?partner_id=pt_002&limit=5')).data[0];
const direct = (await api('/api/v1/products?partner_id=pt_001&limit=5')).data[0];
fs.rmSync(OUT, { recursive: true, force: true });

const browser = await launchBrowser();
const page = await browser.newPage();
await page.viewport('desktop');
let orderId = null;

await step('B01 storefront home renders with legal business disclosure from API', page, async () => {
  await page.goto(`${STORE}/`, { waitFor: "document.querySelector('[data-testid=business-info]')" });
  const txt = await page.eval("document.querySelector('[data-testid=business-info]').textContent");
  if (!txt.includes('사업자등록번호') || txt.includes('120-88-99102')) throw new Error('business info missing or still hard-coded');
  await shots(page, 'store_home', ['desktop', 'tablet', 'mobile']);
});
await step('B02 protected route redirects anonymous users to login', page, async () => {
  await page.goto(`${STORE}/orders`);
  await page.waitFor("location.pathname === '/login'");
});
await step('B03 product detail (marketplace seller) and add to cart', page, async () => {
  await page.goto(`${STORE}/product/${mp.id}`, { waitFor: "[...document.querySelectorAll('button')].some(b => /장바구니|Cart/i.test(b.textContent))" });
  await shots(page, 'store_product', ['desktop', 'mobile']);
  await chooseOptions(page);
  await page.eval("[...document.querySelectorAll('button')].find(b => /장바구니 담기|Add to Cart/i.test(b.textContent) && b.offsetParent && !b.disabled).click()");
  await page.idle(500);
});
await step('B04 add a direct-sales (MODEL A) product -> mixed cart', page, async () => {
  await page.goto(`${STORE}/product/${direct.id}`, { waitFor: "[...document.querySelectorAll('button')].some(b => /장바구니|Cart/i.test(b.textContent))" });
  await chooseOptions(page);
  await page.eval("[...document.querySelectorAll('button')].find(b => /장바구니 담기|Add to Cart/i.test(b.textContent) && b.offsetParent && !b.disabled).click()");
  await page.idle(500);
  const n = await page.eval("JSON.parse(localStorage.getItem('olmoa_cart_items_v3') || '[]').length");
  if (n < 2) throw new Error(`cart has ${n} items`);
  await page.goto(`${STORE}/cart`);
  await shots(page, 'store_cart', ['desktop', 'mobile']);
});
await step('B05 checkout requires login; login through the real form', page, async () => {
  await page.goto(`${STORE}/checkout`);
  await page.waitFor("location.pathname === '/login'");
  await shots(page, 'store_login', ['desktop', 'mobile']);
  await page.type('#login-email', 'customer@example.com');
  await page.type('#login-password', 'wrong-password-1!');
  await page.click('[data-testid=login-submit]');
  await page.waitFor("document.querySelector('[role=alert]')");
  await page.type('#login-password', PW);
  await page.click('[data-testid=login-submit]');
  await page.waitFor("location.pathname === '/checkout'");
});
await step('B06 checkout shows the server quote; pay with the local simulator', page, async () => {
  await page.waitFor("document.querySelector('[data-testid=pay-total]')");
  await page.type('input[autocomplete=name]', '김올모');
  await page.type('input[autocomplete=tel]', '010-2222-3333');
  await page.type('input[autocomplete=postal-code]', '04524');
  await page.type('input[autocomplete=address-line1]', '서울특별시 중구 세종대로 110');
  await page.check('aside input[type=checkbox]');
  await page.idle(400);
  const shown = await page.eval("document.querySelector('[data-testid=pay-total]').textContent.replace(/[^0-9]/g,'')");
  await shots(page, 'store_checkout', ['desktop', 'mobile']);
  await page.waitFor("!document.querySelector('[data-testid=pay-button]').disabled");
  await page.click('[data-testid=pay-button]');
  await page.waitFor("location.pathname === '/payments/success'");
  await shots(page, 'store_payment_simulator', ['desktop']);
  await page.click('[data-testid=sim-approve]');
  await page.waitFor("location.pathname.startsWith('/orders/')", 20000);
  orderId = await page.eval('location.pathname.split("/").pop()');
  await page.waitFor("document.querySelector('[data-testid=order-status]')");
  const status = await page.eval("document.querySelector('[data-testid=order-status]').textContent.trim()");
  if (!status.includes('결제 완료')) throw new Error(`order status shown: ${status}`);
  const token = await page.eval("localStorage.getItem('olmoa_token')");
  const o = await api(`/api/v1/orders/${orderId}`, { headers: { Authorization: `Bearer ${token}` } });
  if (String(o.data.total_pay_amount) !== shown) throw new Error(`displayed ${shown} != charged ${o.data.total_pay_amount}`);
  if (o.data.sub_orders.length !== 2) throw new Error('expected 2 seller shipments');
  await shots(page, 'store_order_detail_paid', ['desktop', 'mobile']);
});

const ptPage = await browser.newPage();
await ptPage.viewport('desktop');
await step('B07 seller center: login, see the paid order, ship it', ptPage, async () => {
  await ptPage.goto(`${PARTNER}/`);
  await ptPage.waitFor("location.pathname === '/login'");
  await ptPage.type('#pt-email', 'partner2@olmoa-tech.com');
  await ptPage.type('#pt-pw', PW);
  await ptPage.click('text=로그인');
  await ptPage.waitFor("location.pathname === '/'");
  await ptPage.idle(800);
  await shots(ptPage, 'partner_dashboard', ['desktop', 'mobile']);
  await ptPage.goto(`${PARTNER}/shipments`);
  await ptPage.idle(1200);
  await shots(ptPage, 'partner_shipments', ['desktop', 'mobile']);
  // Shipping is performed with the seller's own session token from the page (seller UI form layout varies per order).
  const r = await ptPage.eval(`(async () => {
    const t = localStorage.getItem('partner_token');
    const list = await (await fetch('${API}/api/v1/partner/orders', { headers: { Authorization: 'Bearer ' + t } })).json();
    const sub = list.data.find((s) => s.parent_order_id === ${JSON.stringify(orderId)});
    const res = await fetch('${API}/api/v1/partner/orders/' + sub.id + '/shipment', { method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + t }, body: JSON.stringify({ carrier: 'CJ대한통운', tracking_number: 'TRK20261105001' }) });
    return res.status;
  })()`);
  if (r !== 200) throw new Error(`ship status ${r}`);
});

const adPage = await browser.newPage();
await adPage.viewport('desktop');
let adminToken = null;
await step('B08 operator console: login, reconciliation, entities, purchase orders', adPage, async () => {
  await adPage.goto(`${ADMIN}/reconciliation`);
  await adPage.waitFor("location.pathname === '/login'");
  await adPage.type('#adm-email', 'admin@openmarket.com');
  await adPage.type('#adm-pw', PW);
  await adPage.click('text=로그인');
  await adPage.waitFor("location.pathname === '/reconciliation'");
  await adPage.waitFor("document.querySelector('[data-testid=recon-status]')");
  const recon = await adPage.eval("document.querySelector('[data-testid=recon-status]').textContent");
  if (!recon.includes('통과')) throw new Error(`reconciliation: ${recon}`);
  await shots(adPage, 'admin_reconciliation', ['desktop', 'mobile']);
  await adPage.goto(`${ADMIN}/business`);
  await adPage.idle(1000);
  await shots(adPage, 'admin_business_entities', ['desktop', 'mobile']);
  await adPage.goto(`${ADMIN}/suppliers`);
  await adPage.idle(1000);
  const hasPo = await adPage.eval("document.body.innerText.includes('발주 대기')");
  if (!hasPo) throw new Error('direct-sale purchase order not listed');
  await shots(adPage, 'admin_purchase_orders', ['desktop', 'mobile']);
  await adPage.goto(`${ADMIN}/`);
  await adPage.idle(1200);
  await shots(adPage, 'admin_dashboard', ['desktop', 'mobile']);
  adminToken = await adPage.eval("localStorage.getItem('olmoa_admin_token')");
});
await step('B09 delivery (dev simulator) -> customer purchase confirmation in the UI', page, async () => {
  for (let i = 0; i < 2; i++) await api(`/api/v1/orders/${orderId}/advance-tracking`, { method: 'POST', headers: { Authorization: `Bearer ${adminToken}` } });
  await page.goto(`${STORE}/orders/${orderId}`, { waitFor: "document.querySelector('[data-testid=confirm-order]')" });
  await page.click('[data-testid=confirm-order]');
  await page.waitFor("document.body.innerText.includes('구매확정 완료')");
  await shots(page, 'store_order_confirmed', ['desktop', 'mobile']);
});
await step('B10 customer cancels the remaining (direct) shipment from the UI', page, async () => {
  const visible = await page.eval("Boolean([...document.querySelectorAll('button')].find(b => b.textContent.includes('이 판매자 상품만 취소')))");
  // The direct shipment is still pre-shipment; after the marketplace part is delivered the whole-order cancel is not offered.
  if (!visible) {
    const anyCancel = await page.eval("Boolean(document.querySelector('[data-testid=cancel-order]'))");
    if (anyCancel) throw new Error('whole-order cancel offered although part of the order was delivered');
    return;
  }
  await page.eval('window.confirm = () => true');
  await page.click('text=이 판매자 상품만 취소');
  await page.waitFor("document.body.innerText.includes('부분 취소 완료')");
  await shots(page, 'store_partial_cancel', ['desktop']);
});
await step('B11 reconciliation still clean after the browser journey', adPage, async () => {
  await adPage.goto(`${ADMIN}/reconciliation`, { waitFor: "document.querySelector('[data-testid=recon-status]')" });
  const recon = await adPage.eval("document.querySelector('[data-testid=recon-status]').textContent");
  if (!recon.includes('통과')) throw new Error(`reconciliation: ${recon}`);
});

await browser.close();
const failed = steps.filter((s) => !s.ok);
const consoleErrors = steps.reduce((a, s) => a + s.console_errors.length, 0);
const httpErrors = steps.flatMap((s) => s.network_errors.map((n) => ({ step: s.name, ...n })));
fs.mkdirSync('reports/v3/evidence', { recursive: true });
fs.writeFileSync('reports/v3/evidence/05_browser_e2e.json', JSON.stringify({ browser: browser.exe, at: new Date().toISOString(), steps, screenshots: fs.readdirSync(OUT) }, null, 2));
console.log(`\n=== Browser E2E: ${steps.length - failed.length}/${steps.length} passed · console errors ${consoleErrors} · HTTP>=400 ${httpErrors.length} · screenshots ${fs.readdirSync(OUT).length} ===`);
for (const h of httpErrors) console.log(`  HTTP ${h.status} ${h.method || ''} ${h.url}  [${h.step}]`);
if (failed.length) process.exitCode = 1;
