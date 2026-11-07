// tests/fx_singlesource_test.mjs
// FX single source (Lane E): the operator-maintained exchange_rates table is
// the live rate source; lib/fx.js FALLBACK_KRW_PER_UNIT is the only hardcoded
// map. No other gateway module may carry its own rate literals.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGateway, createRunner } from './lib/harness.mjs';

const t = createRunner('FX Single Source');
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

async function newGateway() {
  return createGateway({
    seedFiles: ['migrations/dev/seed_local_dev.sql'],
    env: {
      JWT_SECRET: 'e2e-secret-0123456789abcdefghijklmnopqrstu',
      ENVIRONMENT: 'development',
      CONNECTOR_SIMULATION: 'true',
      PAYMENT_MODE: 'sandbox'
    }
  });
}

await t.test('F01 no hardcoded rate map outside lib/fx.js', async () => {
  const singleSource = read('apps/cloudflare-gateway/src/lib/fx.js');
  assert.ok(singleSource.includes('FALLBACK_KRW_PER_UNIT'), 'fallback map lives in lib/fx.js');
  for (const f of [
    'apps/cloudflare-gateway/src/services/crawler/pricing-calculator.js',
    'apps/cloudflare-gateway/src/services/pricing/global-pricing-engine.js',
    'apps/cloudflare-gateway/src/routes/global-customs-fx.js',
    'apps/cloudflare-gateway/src/routes/multichannel.js'
  ]) {
    const src = read(f);
    assert.ok(!/1380/.test(src), `${f} must not hardcode a USD rate`);
    assert.ok(!/192\.5|195\.0/.test(src), `${f} must not hardcode a CNY rate`);
    assert.ok(!/9\.15|9\.2\b/.test(src), `${f} must not hardcode a JPY rate`);
    assert.ok(!/1495/.test(src), `${f} must not hardcode a EUR rate`);
  }
});

await t.test('F02 /fx/convert follows the operator table', async () => {
  const g = await newGateway();
  g.db.prepare("UPDATE exchange_rates SET inverse_rate = 1400 WHERE base_currency = 'KRW' AND target_currency = 'USD'").run();
  const r = await g.call('/api/v1/fx/convert', { method: 'POST', body: { amount: 2, from: 'USD', to: 'KRW' } });
  assert.equal(r.status, 200);
  assert.equal(r.json.converted_amount, 2800);
});

await t.test('F03 empty table falls back to the reference rate', async () => {
  const g = await newGateway();
  g.db.prepare('DELETE FROM exchange_rates').run();
  const r = await g.call('/api/v1/fx/convert', { method: 'POST', body: { amount: 2, from: 'USD', to: 'KRW' } });
  assert.equal(r.status, 200);
  assert.equal(r.json.converted_amount, 2760); // 2 x 1380 reference
  const d = await g.call('/api/v1/customs/estimate-duty', { method: 'POST', body: { goods_amount_krw: 138000, shipping_fee_krw: 0, country_origin: 'CN' } });
  assert.equal(d.status, 200);
  assert.equal(d.json.data.total_order_usd, 100);
});

await t.test('F04 channel price calculator resolves live rates', async () => {
  const g = await newGateway();
  g.db.prepare("UPDATE exchange_rates SET inverse_rate = 1400 WHERE base_currency = 'KRW' AND target_currency = 'USD'").run();
  const r = await g.call('/api/v1/channels/pricing/calculate', {
    method: 'POST',
    body: { wholesale_cost: 100, currency: 'USD', target_margin_bps: 2000, channel_code: 'OLMOA_MAIN', weight_kg: 0.5, is_crossborder: false, origin_country: 'CN', min_margin_krw: 3000, rounding_unit: 100 }
  });
  assert.equal(r.status, 200);
  // 100 USD x 1400 x 1.02 buffer = 142800 supply cost (proves live-table injection, not the 1380 fallback)
  assert.equal(r.json.data.cost_breakdown.supply_cost_krw, 142800);
});

t.finish();
