// tests/p1_honesty_defaults_test.mjs
// Phase 2 (NEW-02/03/04/05/13): no invented copy, no fake defaults, secure defaults.
// Run: node tests/p1_honesty_defaults_test.mjs

import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createGateway, createRunner } from './lib/harness.mjs';
import { enhanceProductWithAi } from '../apps/cloudflare-gateway/src/services/crawler/ai-translator.js';
import { crawlAndExtractProduct } from '../apps/cloudflare-gateway/src/services/crawler/crawler-service.js';
import { NaverCommerceConnector } from '../apps/cloudflare-gateway/src/services/connectors/naver-connector.js';
import { totpAt, currentStep } from '../apps/cloudflare-gateway/src/lib/totp.js';

const SEED = ['migrations/dev/seed_local_dev.sql'];
const PW = 'DevPass!2026#';
const SECRET = 'test-jwt-secret-0123456789abcdefghijklmnop';
const BASE_ENV = { JWT_SECRET: SECRET, ENVIRONMENT: 'test', PAYMENT_MODE: 'sandbox', PAYMENT_WEBHOOK_SECRET: 'wh-secret-0123456789abcdef' };

async function boot(env = {}) {
  const g = await createGateway({ seedFiles: SEED, env: { ...BASE_ENV, ...env } });
  const one = (sql, ...p) => { const r = g.db.prepare(sql).get(...p); return r ? { ...r } : null; };
  const login = async (email, role = 'CUSTOMER') => {
    const r = await g.call('/api/v1/auth/login', { method: 'POST', body: { email, password: PW, role } });
    assert.equal(r.status, 200, `login ${email}: ${r.text}`);
    return r.json.token;
  };
  return { ...g, one, login };
}

const t = createRunner('P1 honesty & secure defaults (NEW-02/03/04/05/13)');

// ---------- NEW-02: AI translator tells the truth ----------
await t.test('NEW-02 enhance returns SKIPPED with empty bullets and the original description', async () => {
  const out = await enhanceProductWithAi(
    { title: 'Wireless Bluetooth Vacuum Cleaner Pro', description_html: '<p>Shop text.</p>' },
    { targetLang: 'KO', env: { VERTEX_AI_KEY: 'key-that-changes-nothing' } }
  );
  assert.equal(out.live_external_api_status, 'SKIPPED');
  assert.deepEqual(out.bullets, []);
  assert.equal(out.enhanced_summary, '<p>Shop text.</p>');
  assert.ok(out.translated_title.includes('무선'), 'dictionary title translation still works');
  const blob = JSON.stringify(out);
  for (const banned of ['주변 소음', 'BLDC', '검증된 글로벌', '엄격한 품질', 'COMPLETED', 'VERTEX_AI', '심층 가공']) {
    assert.ok(!blob.includes(banned), `output must not contain: ${banned}`);
  }
});

await t.test('NEW-02 ai-translator source carries no fabricated claims or false provider report', async () => {
  const src = fs.readFileSync('apps/cloudflare-gateway/src/services/crawler/ai-translator.js', 'utf8');
  for (const banned of ['주변 소음 완벽 차단', 'BLDC 고성능 모터', '검증된 글로벌 공식 공급업체', '엄격한 품질 검사', 'VERTEX_AI', 'COMPLETED', '실시간 심층 가공']) {
    assert.ok(!src.includes(banned), `source must not contain: ${banned}`);
  }
});

await t.test('NEW-02 ai-enhance route records SKIPPED and never flags ai_enhanced', async () => {
  const g = await boot();
  const adm = await g.login('admin@openmarket.com', 'ADMIN');
  const pt = await g.login('seller@temu-supply.com', 'PARTNER');
  const tg = await g.call('/api/v1/admin/feature-flags/ai_translation/toggle', {
    method: 'POST', token: adm, body: { is_enabled: true, reason: 'phase2 test' }
  });
  assert.equal(tg.status, 200, tg.text);
  const partner = g.one("SELECT p.id FROM partners p JOIN users u ON u.id = p.owner_user_id WHERE u.email = 'seller@temu-supply.com'");
  const preview = { product: { title: 'Wireless Earbuds', description_html: '<p>Orig.</p>' } };
  g.db.prepare('INSERT INTO product_import_jobs (id, partner_id, source_url, domain, status, preview_data_json) VALUES (?,?,?,?,?,?)')
    .run('job_phase2_ai', partner.id, 'https://example.com/p', 'example.com', 'ANALYZED', JSON.stringify(preview));
  const r = await g.call('/api/v1/imports/job_phase2_ai/ai-enhance', { method: 'POST', token: pt });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.data.live_external_api_status, 'SKIPPED');
  assert.equal(r.json.data.updated_preview.ai_enhanced, false);
  const row = g.one('SELECT status, bullets_json, provider FROM ai_product_enhancements WHERE import_job_id = ?', 'job_phase2_ai');
  assert.equal(row.status, 'SKIPPED');
  assert.equal(row.bullets_json, '[]');
});

// ---------- NEW-03: empty description stays empty ----------
await t.test('NEW-03 crawl with no description yields empty string, not invented genuine copy', async () => {
  const res = await crawlAndExtractProduct({
    url: 'https://example-supplier.com/item/9',
    htmlOverride: `<html><head>
      <meta property="og:title" content="Test Product Without Description" />
      <meta property="og:image" content="https://example-supplier.com/i.jpg" />
      <meta property="product:price:amount" content="10000" />
      <meta property="product:price:currency" content="KRW" />
    </head></html>`
  });
  assert.equal(res.success, true, JSON.stringify(res).slice(0, 300));
  assert.equal(res.data.product.description_html, '');
  assert.ok(res.data.missing_fields.includes('상세 설명(30자 이상)'));
});

await t.test('NEW-03 crawler source no longer invents a verified-genuine description', async () => {
  const src = fs.readFileSync('apps/cloudflare-gateway/src/services/crawler/crawler-service.js', 'utf8');
  assert.ok(!src.includes('공식 공급업체 직출고 검증 정품 상품입니다.'));
});

// ---------- NEW-04: naver connector validates, never invents ----------
const NAVER_CREDS = { isSandbox: true };
const NAVER_VALID = {
  title: 'Test Headphones', brand: 'TestBrand', description_html: '<p>Real desc.</p>',
  sale_price: 25000, stock_quantity: 3, as_phone: '010-1111-2222',
  delivery_company: 'CJGLS', external_category_id: '50000803',
  delivery_fee_type: 'CHARGE', delivery_fee: 3000, business_name: 'Test Store'
};

await t.test('NEW-04 naver createListing rejects missing fields with VALIDATION_ERROR', async () => {
  const naver = new NaverCommerceConnector();
  const r = await naver.createListing({ title: 'Only Title' }, NAVER_CREDS);
  assert.equal(r.success, false);
  assert.equal(r.status, 'VALIDATION_ERROR');
  for (const f of ['brand', 'description_html', 'sale_price', 'stock_quantity', 'as_phone', 'delivery_company', 'external_category_id', 'delivery_fee_type']) {
    assert.ok(r.missing_fields.includes(f), `missing_fields names ${f}`);
  }
});

await t.test('NEW-04 naver payload echoes exact inputs, invents nothing', async () => {
  const naver = new NaverCommerceConnector();
  const r = await naver.createListing({ ...NAVER_VALID }, NAVER_CREDS);
  assert.equal(r.success, true, JSON.stringify(r).slice(0, 300));
  const op = r.payload_sent.originProduct;
  assert.equal(op.name, 'Test Headphones');
  assert.equal(op.salePrice, 25000);
  assert.equal(op.stockQuantity, 3);
  assert.equal(op.detailAttribute.naverShoppingSearchInfo.brandName, 'TestBrand');
  assert.equal(op.detailAttribute.afterServiceInfo.afterServiceTelephoneNumber, '01011112222');
  assert.equal(op.detailInfo, undefined);
  assert.equal(op.deliveryInfo.deliveryCompany, 'CJGLS');
  assert.equal(op.deliveryInfo.deliveryFee.deliveryFeeType, 'CHARGE');
  assert.equal(op.deliveryInfo.deliveryFee.deliveryFee, 3000);
  assert.equal(op.leafCategoryId, '50000803');
  const blob = JSON.stringify(r.payload_sent);
  for (const banned of ['02-1588-0000', '19900', '정품 보장', 'OLMOA PARTNER']) {
    assert.ok(!blob.includes(banned), `payload must not contain: ${banned}`);
  }
});

await t.test('NEW-04 naver accepts the publish-route price key and explicit FREE', async () => {
  const naver = new NaverCommerceConnector();
  const r = await naver.createListing(
    { ...NAVER_VALID, sale_price: undefined, channel_sale_price: 19900, delivery_fee_type: 'FREE', delivery_fee: undefined },
    NAVER_CREDS
  );
  assert.equal(r.success, true, JSON.stringify(r).slice(0, 300));
  assert.equal(r.payload_sent.originProduct.salePrice, 19900);
  assert.equal(r.payload_sent.originProduct.deliveryInfo.deliveryFee.deliveryFeeType, 'FREE');
});

await t.test('NEW-04 naver source carries no hardcoded A/S phone, price, stock, or genuine copy', async () => {
  const src = fs.readFileSync('apps/cloudflare-gateway/src/services/connectors/naver-connector.js', 'utf8');
  for (const banned of ['02-1588-0000', '|| 19900', '|| 100', '정품 보장', 'OLMOA PARTNER', "'OLMOA'", '50000803', "|| 'CJGLS'"]) {
    assert.ok(!src.includes(banned), `source must not contain: ${banned}`);
  }
});

await t.test('NEW-04 naver updateShipment fails closed without real tracking inputs', async () => {
  const naver = new NaverCommerceConnector();
  const badRes = await naver.updateShipment({ external_order_id: 'NVR_1' }, NAVER_CREDS);
  assert.equal(badRes.success, false);
  assert.equal(badRes.status, 'VALIDATION_ERROR');
  assert.ok(badRes.missing_fields.includes('tracking_number'));
  assert.ok(badRes.missing_fields.includes('carrier_code'));
  const okRes = await naver.updateShipment(
    { external_order_id: 'NVR_1', tracking_number: '123456789012', carrier_code: 'cjgls' }, NAVER_CREDS);
  assert.equal(okRes.success, true);
  assert.equal(okRes.delivery_company, 'CJGLS');
});

await t.test('NEW-04 publish route still succeeds (simulated) with explicit channel fields', async () => {
  const g = await boot({ ENVIRONMENT: 'development', CONNECTOR_SIMULATION: 'true' });
  const adm = await g.login('admin@openmarket.com', 'ADMIN');
  const pt = await g.login('seller@temu-supply.com', 'PARTNER');
  const tg = await g.call('/api/v1/admin/feature-flags/marketplace_listing_publish/toggle', {
    method: 'POST', token: adm, body: { is_enabled: true, reason: 'phase2 test' }
  });
  assert.equal(tg.status, 200, tg.text);
  const partner = g.one("SELECT p.id FROM partners p JOIN users u ON u.id = p.owner_user_id WHERE u.email = 'seller@temu-supply.com'");
  let sc = g.one("SELECT sc.id FROM sales_channels sc JOIN commerce_platforms p ON p.id = sc.platform_id WHERE p.id = 'naver_smartstore' LIMIT 1");
  if (sc) {
    g.db.prepare(`INSERT INTO platform_credentials (id, partner_id, platform_id, credential_name, api_key_masked, secret_key_enc, is_sandbox, status)
      VALUES (?,?,?,?,?,?,?,?)`)
      .run('cred_phase2_naver', partner.id, 'naver_smartstore', 'phase2 sandbox', '****', 'sealed-test', 1, 'CONFIGURED');
  } else {
    sc = g.one("SELECT id FROM sales_channels WHERE id = 'sc_coupang_wing'");
  }
  const r = await g.call('/api/v1/channels/listings/publish', {
    method: 'POST', token: pt,
    body: {
      sales_channel_id: sc.id, product_id: 'prod_001', sale_price: 18900,
      brand: 'RouteBrand', as_phone: '010-2222-3333', delivery_company: 'CJGLS',
      external_category_id: '50000803', delivery_fee_type: 'CHARGE', delivery_fee: 3000
    }
  });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.simulated, true);
  assert.equal(r.json.status, 'DRAFT');
});

// ---------- NEW-05: SMS sender fail-closed ----------
await t.test('NEW-05 dispatch with keys but no sender never sends and reports misconfiguration', async () => {
  const g = await boot({ SOLAPI_API_KEY: 'k', SOLAPI_API_SECRET: 's'.repeat(32) });
  const adm = await g.login('admin@openmarket.com', 'ADMIN');
  const realFetch = globalThis.fetch;
  let calls = 0;
  try {
    globalThis.fetch = async (...a) => { calls++; return realFetch(...a); };
    const r = await g.call('/api/v1/notifications/dispatch', {
      method: 'POST', token: adm, body: { channel: 'SMS', recipient: '010-1234-5678', content: 'hi' }
    });
    assert.equal(r.status, 200, r.text);
    assert.equal(r.json.data.status, 'NOT_SENT_SENDER_NOT_CONFIGURED');
    assert.equal(r.json.sender_configured, false);
    assert.ok(String(r.json.config_error || '').includes('SOLAPI_SENDER_NUMBER'));
    assert.equal(calls, 0, 'no send attempt without a registered sender number');
  } finally {
    globalThis.fetch = realFetch;
  }
});

await t.test('NEW-05 dispatch without keys keeps NOT_SENT_PROVIDER_NOT_CONFIGURED', async () => {
  const g = await boot();
  const adm = await g.login('admin@openmarket.com', 'ADMIN');
  const r = await g.call('/api/v1/notifications/dispatch', {
    method: 'POST', token: adm, body: { channel: 'SMS', recipient: '010-1234-5678', content: 'hi' }
  });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.data.status, 'NOT_SENT_PROVIDER_NOT_CONFIGURED');
});

await t.test('NEW-05 features source carries no fake sender fallback', async () => {
  const src = fs.readFileSync('apps/cloudflare-gateway/src/routes/features.js', 'utf8');
  assert.ok(!src.includes('15880000'));
});

// ---------- NEW-13: MFA approval secure by default ----------
await t.test('NEW-13 default env requires SUPER_ADMIN approval for 2FA enable', async () => {
  const g = await boot();
  const adm = await g.login('admin@openmarket.com', 'ADMIN');
  const s = await g.call('/api/v1/auth/2fa/setup', { method: 'POST', token: adm });
  assert.equal(s.status, 200, s.text);
  const code = await totpAt(s.json.data.secret, currentStep());
  const denied = await g.call('/api/v1/auth/2fa/enable', { method: 'POST', token: adm, body: { code } });
  assert.equal(denied.status, 409);
  assert.equal(denied.json.code, 'MFA_APPROVAL_REQUIRED');
});

await t.test("NEW-13 explicit 'false' opts out of the approval requirement", async () => {
  const g = await boot({ ADMIN_MFA_APPROVAL_REQUIRED: 'false' });
  const adm = await g.login('admin@openmarket.com', 'ADMIN');
  const s = await g.call('/api/v1/auth/2fa/setup', { method: 'POST', token: adm });
  assert.equal(s.status, 200, s.text);
  const ok = await g.call('/api/v1/auth/2fa/enable', {
    method: 'POST', token: adm, body: { code: await totpAt(s.json.data.secret, currentStep()) }
  });
  assert.equal(ok.status, 200, ok.text);
  assert.equal(ok.json.data.recovery_codes.length, 10);
});

t.finish();
