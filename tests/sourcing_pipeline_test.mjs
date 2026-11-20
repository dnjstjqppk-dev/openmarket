// tests/sourcing_pipeline_test.mjs
// Phase 1 B2B sourcing pipeline: providers fail closed without keys
// (Zero-Mock: no dummy data), normalize validates, margin stays integer,
// pre-checkout enforces a 500ms defense timeout.

import assert from 'node:assert/strict';
import { createRunner } from './lib/harness.mjs';
import { getProvider, listProviders } from '../apps/cloudflare-gateway/src/services/sourcing/provider.js';
import '../apps/cloudflare-gateway/src/services/sourcing/domeme-adapter.js';
import '../apps/cloudflare-gateway/src/services/sourcing/ownerclan-adapter.js';
import '../apps/cloudflare-gateway/src/services/sourcing/onchannel-adapter.js';
import '../apps/cloudflare-gateway/src/services/sourcing/cj-adapter.js';
import { normalizeOffer } from '../apps/cloudflare-gateway/src/services/sourcing/normalize.js';
import { quoteChannelPrices } from '../apps/cloudflare-gateway/src/services/sourcing/margin.js';
import { preCheckoutGuard } from '../apps/cloudflare-gateway/src/services/sourcing/precheckout.js';

const t = createRunner('Sourcing Pipeline');

await t.test('registry exposes the four B2B adapters', () => {
  assert.deepEqual([...listProviders()].sort(), ['cj-dropshipping', 'domeme', 'onchannel', 'ownerclan']);
});

await t.test('adapters fail closed without credentials (Zero-Mock)', async () => {
  for (const name of listProviders()) {
    const p = getProvider(name);
    await assert.rejects(() => p.fetchOffer({}, 'P-1'), /CONFIG_MISSING|API_KEY|CREDENTIAL/i);
  }
});

await t.test('normalize rejects invalid offers, never invents values', () => {
  assert.throws(() => normalizeOffer('domeme', { costKrw: -5 }), /INVALID_OFFER/);
  assert.throws(() => normalizeOffer('domeme', { costKrw: 1000 }), /INVALID_OFFER/);
  const row = normalizeOffer('domeme', {
    externalId: 'D-1', title: '소싱 상품', costKrw: 10000, currency: 'KRW', stockQty: 3
  });
  assert.equal(row.provider, 'domeme');
  assert.equal(row.status, 'PENDING');
});

await t.test('margin engine is integer-only per channel policy', () => {
  const q = quoteChannelPrices(10000, { storefront: 3000, naver: 1500 });
  assert.equal(q.storefront, 13000);
  assert.equal(q.naver, 11500);
  assert.throws(() => quoteChannelPrices(10000.5, {}), /MONEY_INVARIANT/);
  assert.throws(() => quoteChannelPrices(10000, {}), /POLICY_MISSING/);
});

await t.test('pre-checkout guard times out slow providers at 500ms', async () => {
  const slow = { checkAvailability: () => new Promise((r) => setTimeout(() => r({ ok: true }), 2000)) };
  const verdict = await preCheckoutGuard(slow, 'X-1', 1, { timeoutMs: 500 });
  assert.equal(verdict.decision, 'RECHECK');
  const fast = { checkAvailability: async () => ({ ok: true, stockQty: 5 }) };
  const ok = await preCheckoutGuard(fast, 'X-1', 1, { timeoutMs: 500 });
  assert.equal(ok.decision, 'ALLOW');
});

t.finish();
