// tests/consent_history_test.mjs
// P2R-03: signup consent (terms + privacy, optional marketing) is stored as
// append-only user_consents history, readable via /auth/me, and marketing can
// be toggled later from the profile (each change appends a row; latest wins).

import assert from 'node:assert/strict';
import { createGateway, createRunner } from './lib/harness.mjs';

const t = createRunner('Consent History (P2R-03)');

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

const NEW_USER = {
  email: 'consent.case@example.com',
  password: 'ConsentPass!2026#',
  full_name: '동의테',
  phone: '010-1111-2222',
  agree_terms: true,
  agree_privacy: true
};

await t.test('1. signup without both required consents is rejected and stores nothing', async () => {
  const g = await newGateway();
  for (const body of [
    { ...NEW_USER, agree_terms: false },
    { ...NEW_USER, agree_privacy: false },
    { ...NEW_USER, agree_terms: undefined }
  ]) {
    const r = await g.call('/api/v1/auth/register', { method: 'POST', body });
    assert.equal(r.status, 400);
    assert.equal(r.json.code, 'CONSENT_REQUIRED');
  }
  assert.equal(g.db.prepare('SELECT COUNT(*) AS c FROM users WHERE email = ?').get(NEW_USER.email).c, 0);
  assert.equal(g.db.prepare('SELECT COUNT(*) AS c FROM user_consents').get().c, 0);
});

await t.test('2. signup stores the required consents plus explicit marketing choice', async () => {
  const g = await newGateway();
  const r = await g.call('/api/v1/auth/register', {
    method: 'POST',
    body: { ...NEW_USER, agree_marketing: true, terms_version: 'terms-2026-11' }
  });
  assert.equal(r.status, 201);
  const rows = g.db.prepare('SELECT consent_type, consented, terms_version FROM user_consents WHERE user_id = ? ORDER BY consent_type').all(r.json.customer_id);
  assert.deepEqual(rows.map((x) => [x.consent_type, x.consented]), [
    ['MARKETING', 1],
    ['PRIVACY_POLICY', 1],
    ['TERMS_OF_SERVICE', 1]
  ]);
  assert.ok(rows.every((x) => x.terms_version === 'terms-2026-11'));

  // Marketing omitted: only the two required rows exist.
  const r2 = await g.call('/api/v1/auth/register', {
    method: 'POST',
    body: { ...NEW_USER, email: 'consent.nomkt@example.com' }
  });
  assert.equal(r2.status, 201);
  const types = g.db.prepare('SELECT consent_type FROM user_consents WHERE user_id = ?').all(r2.json.customer_id).map((x) => x.consent_type).sort();
  assert.deepEqual(types, ['PRIVACY_POLICY', 'TERMS_OF_SERVICE']);
});

await t.test('3. /auth/me exposes current consents; profile toggles append history', async () => {
  const g = await newGateway();
  const r = await g.call('/api/v1/auth/register', { method: 'POST', body: { ...NEW_USER, agree_marketing: false } });
  assert.equal(r.status, 201);
  const token = r.json.token;

  const me = await g.call('/api/v1/auth/me', { token });
  assert.equal(me.status, 200);
  const byType = Object.fromEntries(me.json.data.consents.map((c) => [c.consent_type, c.consented]));
  assert.deepEqual(byType, { TERMS_OF_SERVICE: 1, PRIVACY_POLICY: 1, MARKETING: 0 });

  const upd = await g.call('/api/v1/auth/profile', { method: 'PATCH', token, body: { agree_marketing: true } });
  assert.equal(upd.status, 200);
  const mkt = g.db.prepare("SELECT consented FROM user_consents WHERE user_id = ? AND consent_type = 'MARKETING' ORDER BY created_at, rowid").all(r.json.customer_id).map((x) => x.consented);
  assert.deepEqual(mkt, [0, 1], 'each toggle appends; both rows survive');
  const me2 = await g.call('/api/v1/auth/me', { token });
  assert.equal(Object.fromEntries(me2.json.data.consents.map((c) => [c.consent_type, c.consented])).MARKETING, 1);

  // Non-boolean marketing input is ignored, never stored.
  await g.call('/api/v1/auth/profile', { method: 'PATCH', token, body: { agree_marketing: 'yes' } });
  assert.equal(g.db.prepare("SELECT COUNT(*) AS c FROM user_consents WHERE user_id = ? AND consent_type = 'MARKETING'").get(r.json.customer_id).c, 2);

  // The data-subject export carries the full consent history.
  const exp = await g.call('/api/v1/auth/privacy/export', { token });
  assert.equal(exp.status, 200);
  assert.equal(exp.json.data.consents.length, 4);
});

t.finish();
