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
await step('B02b search finds products and a price filter narrows to zero', page, async () => {
  await page.goto(`${STORE}/search?q=${encodeURIComponent('이어폰')}`, { waitFor: "document.body.innerText.includes('개 상품')" });
  if (await page.eval("document.body.innerText.includes('검색 결과가 없습니다')")) throw new Error('seed search unexpectedly empty');
  await page.goto(`${STORE}/search?q=${encodeURIComponent('이어폰')}&min_price=999999999`);
  await page.waitFor("document.body.innerText.includes('검색 결과가 없습니다')");
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
await step('B04b quick-add from the home grid grows the cart', page, async () => {
  await page.goto(`${STORE}/`, { waitFor: "document.querySelector('[data-testid=quick-add]')" });
  const len = () => page.eval("JSON.parse(localStorage.getItem('olmoa_cart_items_v3') || '[]').length");
  const before = await len();
  // B03/B04 may already hold the first cards (same-SKU adds merge quantity):
  // walk the grid until a genuinely new line lands.
  for (let i = 0; i < 6; i++) {
    await page.eval(`document.querySelectorAll('[data-testid=quick-add]')[${i}].click()`);
    await page.idle(800);
    const sheeted = await page.eval("!!document.querySelector('[data-testid=quick-sheet]')");
    if (sheeted) {
      await page.eval("document.querySelector('[data-testid=quick-sku]:not([disabled])').click()");
      await page.eval("document.querySelector('[data-testid=quick-confirm]').click()");
      await page.idle(500);
    }
    if ((await len()) === before + 1) break;
  }
  const after = await len();
  if (after !== before + 1) throw new Error(`cart grew ${before} -> ${after}`);
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
await step('B05b store follow toggles on and off in the UI', page, async () => {
  await page.goto(`${STORE}/store/pt_002`, { waitFor: "document.querySelector('[data-testid=follow-toggle]')" });
  const label = () => page.eval("document.querySelector('[data-testid=follow-toggle]').textContent.trim()");
  const count = () => page.eval("document.querySelector('[data-testid=follower-count]').textContent.replace(/[^0-9]/g,'')");
  if ((await label()) === '팔로잉') {
    await page.click('[data-testid=follow-toggle]');
    await page.waitFor("document.querySelector('[data-testid=follow-toggle]').textContent.trim() === '팔로우'");
  }
  const before = await count();
  await page.click('[data-testid=follow-toggle]');
  await page.waitFor("document.querySelector('[data-testid=follow-toggle]').textContent.trim() === '팔로잉'");
  const up = await count();
  if (Number(up) !== Number(before) + 1) throw new Error(`followers ${before} -> ${up}`);
  await shots(page, 'store_follow_on', ['desktop']);
  await page.click('[data-testid=follow-toggle]');
  await page.waitFor("document.querySelector('[data-testid=follow-toggle]').textContent.trim() === '팔로우'");
  const down = await count();
  if (down !== before) throw new Error(`followers ${up} -> ${down}, expected ${before}`);
});
await step('B05c platform and store coupons minted and claimed for checkout', page, async () => {
  const ts = String(Date.now()).slice(-8);
  const adminLogin = await api('/api/v1/auth/login', { method: 'POST', body: JSON.stringify({ email: 'admin@openmarket.com', password: PW, role: 'ADMIN' }) });
  if (!adminLogin.token) throw new Error('admin API login failed');
  const sellerLogin = await api('/api/v1/auth/login', { method: 'POST', body: JSON.stringify({ email: 'seller@temu-supply.com', password: PW, role: 'PARTNER' }) });
  if (!sellerLogin.token) throw new Error('seller API login failed');
  const plat = await api('/api/v1/admin/coupons', { method: 'POST', headers: { Authorization: `Bearer ${adminLogin.token}` },
    body: JSON.stringify({ code: `E2E${ts}P`, title: 'E2E 플랫폼 쿠폰', discount_type: 'FIXED_AMOUNT', discount_value: 1000 }) });
  if (plat.data?.id == null) throw new Error(`platform coupon mint failed: ${JSON.stringify(plat).slice(0, 120)}`);
  const store = await api('/api/v1/partner/coupons', { method: 'POST', headers: { Authorization: `Bearer ${sellerLogin.token}` },
    body: JSON.stringify({ code: `E2E${ts}S`, title: 'E2E 스토어 쿠폰', discount_type: 'FIXED_AMOUNT', discount_value: 500 }) });
  if (store.data?.id == null) throw new Error(`store coupon mint failed: ${JSON.stringify(store).slice(0, 120)}`);
  // P0-2: web sessions live in httpOnly cookies (unreadable from JS); the
  // script authenticates its direct API calls with its own Bearer login.
  const custLogin = await api('/api/v1/auth/login', { method: 'POST', body: JSON.stringify({ email: 'customer@example.com', password: PW, role: 'CUSTOMER' }) });
  if (!custLogin.token) throw new Error('customer API login failed');
  const custToken = custLogin.token;
  for (const code of [`E2E${ts}P`, `E2E${ts}S`]) {
    const claim = await api('/api/v1/coupons/claim', { method: 'POST', headers: { Authorization: `Bearer ${custToken}`, 'X-Idempotency-Key': `e2e-${ts}-${code}` },
      body: JSON.stringify({ code }) });
    if (claim.user_coupon_id == null) throw new Error(`claim ${code} failed: ${JSON.stringify(claim).slice(0, 120)}`);
  }
});
await step('B06 checkout shows the server quote; pay with the local simulator', page, async () => {
  await page.goto(`${STORE}/checkout`);
  await page.waitFor("document.querySelector('[data-testid=pay-total]')");
  await page.waitFor("[...document.querySelectorAll('button')].some(b => (b.textContent.trim() === '스토어 쿠폰' && !b.disabled) || b.textContent.trim() === '쿠폰 변경')");
  for (let i = 0; i < 3; i++) {
    const state = await page.eval(`(() => {
      const btn = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === '스토어 쿠폰' && !b.disabled && !b.dataset.e2eTried);
      if (!btn) return 'done';
      btn.dataset.e2eTried = '1';
      btn.click();
      return 'opened';
    })()`);
    if (state === 'done') break;
    await page.waitFor("document.querySelector('[data-testid=seller-coupon-modal]')");
    const empty = await page.eval("document.querySelector('[data-testid=seller-coupon-modal]').innerText.includes('사용할 수 있는 스토어 쿠폰이 없습니다')");
    if (empty) {
      await page.eval("(() => { const m = document.querySelector('[data-testid=seller-coupon-modal]'); [...m.querySelectorAll('button')].pop().click(); })()");
    } else {
      await page.eval("document.querySelector('[data-testid=seller-coupon-modal] [role=radio][aria-checked=\"false\"]').click()");
    }
  }
  const storePicked = await page.eval("[...document.querySelectorAll('button')].some((b) => b.textContent.trim() === '쿠폰 변경')");
  if (!storePicked) throw new Error('no store coupon picked');
  const platPicked = await page.eval(`(() => {
    for (const sel of document.querySelectorAll('select')) {
      const hit = [...sel.options].find((o) => o.text.includes('E2E') && o.value);
      if (hit) { sel.value = hit.value; sel.dispatchEvent(new Event('change', { bubbles: true })); return hit.value; }
    }
    return '';
  })()`);
  if (!platPicked) throw new Error('platform coupon select not driven');
  await page.type('input[autocomplete=name]', '김올모');
  await page.type('input[autocomplete=tel]', '010-2222-3333');
  await page.type('input[autocomplete=postal-code]', '04524');
  await page.type('input[autocomplete=address-line1]', '서울특별시 중구 세종대로 110');
  await page.eval("Array.from(document.querySelectorAll('aside input[type=checkbox]')).forEach((c) => { if (!c.checked) c.click() })");
  await page.idle(400);
  const shown = await page.eval("document.querySelector('[data-testid=pay-total]').textContent.replace(/[^0-9]/g,'')");
  await shots(page, 'store_checkout', ['desktop', 'mobile']);
  await page.waitFor("!document.querySelector('[data-testid=pay-button]').disabled");
  await page.click('[data-testid=pay-button]');
  await page.waitFor("location.pathname === '/payments/success'");
  await shots(page, 'store_payment_simulator', ['desktop']);
  await page.click('[data-testid=sim-approve]');
  await page.waitFor("document.querySelector('[data-testid=pay-done]')", 20000);
  await page.waitFor("document.querySelector('[data-testid=pay-card]')");
  const cardShown = await page.eval("document.querySelector('[data-testid=pay-card]')?.textContent || ''");
  if (!cardShown.includes('****')) throw new Error(`masked card missing on the receipt: ${cardShown}`);
  await page.click('[data-testid=order-detail-link]');
  await page.waitFor("location.pathname.startsWith('/orders/')", 20000);
  orderId = await page.eval('location.pathname.split("/").pop()');
  await page.waitFor("document.querySelector('[data-testid=order-status]')");
  const status = await page.eval("document.querySelector('[data-testid=order-status]').textContent.trim()");
  if (!status.includes('결제 완료')) throw new Error(`order status shown: ${status}`);
  const verifyLogin = await api('/api/v1/auth/login', { method: 'POST', body: JSON.stringify({ email: 'customer@example.com', password: PW, role: 'CUSTOMER' }) });
  if (!verifyLogin.token) throw new Error('customer API login failed');
  const o = await api(`/api/v1/orders/${orderId}`, { headers: { Authorization: `Bearer ${verifyLogin.token}` } });
  if (String(o.data.total_pay_amount) !== shown) throw new Error(`displayed ${shown} != charged ${o.data.total_pay_amount}`);
  if (o.data.sub_orders.length !== 2) throw new Error('expected 2 seller shipments');
  if (!(o.data.coupon_discount_amount > 0)) throw new Error('coupons did not discount the order');
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
  // Shipping is performed with the seller's own page session (P0-2: the httpOnly
  // cookies authenticate in-page fetches; seller UI form layout varies per order).
  const r = await ptPage.eval(`(async () => {
    const list = await (await fetch('${API}/api/v1/partner/orders')).json();
    const sub = list.data.find((s) => s.parent_order_id === ${JSON.stringify(orderId)});
    const res = await fetch('${API}/api/v1/partner/orders/' + sub.id + '/shipment', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ carrier: 'CJ대한통운', tracking_number: 'TRK20261105001' }) });
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
  // P0-2: web sessions live in httpOnly cookies; later steps authenticate
  // direct API calls with a dedicated Bearer login instead.
  const admLogin = await api('/api/v1/auth/login', { method: 'POST', body: JSON.stringify({ email: 'admin@openmarket.com', password: PW, role: 'ADMIN' }) });
  if (!admLogin.token) throw new Error('admin API login failed');
  adminToken = admLogin.token;
});
// P0-2: one browser profile holds one API (cookie) session, so logging into
// the partner/admin consoles clobbers the storefront session. Re-establish
// the customer session in the page before customer UI steps that follow a
// console switch. Harmless when the session is already the customer's.
async function ensureCustomerUiLogin(pg) {
  await pg.goto(`${STORE}/login`);
  await pg.idle(800);
  if ((await pg.eval('location.pathname')) !== '/login') return;
  await pg.type('#login-email', 'customer@example.com');
  await pg.type('#login-password', PW);
  await pg.click('[data-testid=login-submit]');
  await pg.waitFor("location.pathname !== '/login'");
}
await step('B09 delivery (dev simulator) -> customer purchase confirmation in the UI', page, async () => {
  for (let i = 0; i < 2; i++) await api(`/api/v1/orders/${orderId}/advance-tracking`, { method: 'POST', headers: { Authorization: `Bearer ${adminToken}` } });
  await ensureCustomerUiLogin(page);
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
  await page.click('text=이 판매자 상품만 취소');
  await page.waitFor("document.querySelector('[data-testid=confirm-dialog]')");
  const dlg = await page.eval("document.querySelector('[data-testid=confirm-dialog]').textContent");
  if (!dlg.includes('해당 상품')) throw new Error(`cancel dialog hides the amount: ${dlg.slice(0, 80)}`);
  await page.click('[data-testid=confirm-ok]');
  await page.waitFor("document.body.innerText.includes('부분 취소 완료')");
  await shots(page, 'store_partial_cancel', ['desktop']);
});
await step('B10b partial return on one seller shipment from the UI', page, async () => {
  // P0-2: web sessions live in httpOnly cookies; direct API calls use a dedicated Bearer login.
  const retLogin = await api('/api/v1/auth/login', { method: 'POST', body: JSON.stringify({ email: 'customer@example.com', password: PW, role: 'CUSTOMER' }) });
  if (!retLogin.token) throw new Error('customer API login failed');
  const auth = { Authorization: `Bearer ${retLogin.token}` };
  const s1 = (await api('/api/v1/products?partner_id=pt_001&limit=5')).data.find((p) => p.default_sku_id);
  const s2 = (await api('/api/v1/products?partner_id=pt_002&limit=5')).data.find((p) => p.default_sku_id);
  const co = await api('/api/v1/orders/checkout', { method: 'POST', headers: auth,
    body: JSON.stringify({ recipient_name: '김올모', recipient_phone: '010-2222-3333', shipping_address_line1: '서울특별시 중구 세종대로 110', shipping_postal_code: '04524',
      items: [{ sku_id: s1.default_sku_id, quantity: 1 }, { sku_id: s2.default_sku_id, quantity: 1 }] }) });
  if (!co.order_id) throw new Error(`return-order checkout failed: ${JSON.stringify(co).slice(0, 160)}`);
  const pay = await api('/api/v1/payments/confirm', { method: 'POST', headers: auth,
    body: JSON.stringify({ order_id: co.order_id, payment_key: `sandbox_${String(co.order_id).slice(-8)}xx`, amount: co.total_pay_amount }) });
  if (pay.order_id == null && pay.data?.order_id == null) throw new Error(`return-order pay failed: ${JSON.stringify(pay).slice(0, 160)}`);
  const sLogin1 = await api('/api/v1/auth/login', { method: 'POST', body: JSON.stringify({ email: 'seller@temu-supply.com', password: PW, role: 'PARTNER' }) });
  const sLogin2 = await api('/api/v1/auth/login', { method: 'POST', body: JSON.stringify({ email: 'partner2@olmoa-tech.com', password: PW, role: 'PARTNER' }) });
  const sellerToken = { pt_001: sLogin1.token, pt_002: sLogin2.token };
  const created = await api(`/api/v1/orders/${co.order_id}`, { headers: auth });
  for (const sub of created.data.sub_orders) {
    const st = sellerToken[sub.partner_id];
    if (!st) throw new Error(`no seller token for ${sub.partner_id}`);
    await api('/api/v1/partner/orders/confirm', { method: 'PUT', headers: { Authorization: `Bearer ${st}` }, body: JSON.stringify({ sub_order_ids: [sub.id] }) });
    const ship = await api(`/api/v1/partner/orders/${sub.id}/shipment`, { method: 'PUT', headers: { Authorization: `Bearer ${st}` },
      body: JSON.stringify({ carrier: 'CJ대한통운', tracking_number: `E2E${Date.now()}${sub.id.slice(-4)}` }) });
    if (ship.status !== 'SHIPPED') throw new Error(`ship failed: ${JSON.stringify(ship).slice(0, 160)}`);
  }
  for (let i = 0; i < 2; i++) await api(`/api/v1/orders/${co.order_id}/advance-tracking`, { method: 'POST', headers: { Authorization: `Bearer ${adminToken}` } });
  await ensureCustomerUiLogin(page);
  await page.goto(`${STORE}/orders/${co.order_id}`, { waitFor: "document.body.innerText.includes('반품 · 교환 신청')" });
  await page.click('text=반품 · 교환 신청');
  await page.waitFor("document.querySelector('[aria-labelledby=claim-title]')");
  await page.click('text=신청하기');
  await page.waitFor("document.body.innerText.includes('반품 신청이 접수되었습니다')");
  const detail = await api(`/api/v1/orders/${co.order_id}`, { headers: auth });
  const claims = detail.data.claims || detail.claims || [];
  if (claims.length !== 1) throw new Error(`expected 1 claim, saw ${claims.length}`);
  await shots(page, 'store_partial_return', ['desktop']);
});
async function ensureAdminUiLogin(pg) {
  await pg.goto(`${ADMIN}/login`);
  await pg.idle(800);
  if ((await pg.eval('location.pathname')) !== '/login') return;
  await pg.type('#adm-email', 'admin@openmarket.com');
  await pg.type('#adm-pw', PW);
  await pg.click('text=로그인');
  await pg.waitFor("location.pathname !== '/login'");
}
await step('B11 reconciliation still clean after the browser journey', adPage, async () => {
  // P0-2: the customer re-login in B09/B10b clobbered the shared admin cookies.
  await ensureAdminUiLogin(adPage);
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
