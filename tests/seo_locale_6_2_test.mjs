// tests/seo_locale_6_2_test.mjs
// Phase 6 task 6-2: the saved locale behind the /en /ja mirrors — login and
// profile carry it, members can change it, nothing else may.

import assert from 'node:assert/strict';
import { createGateway, createRunner } from './lib/harness.mjs';

const t = createRunner('Storefront locale (6-2)');

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

// 1. Login and profile carry the saved locale (ko-KR default).
await t.test('1. auth responses carry the saved locale', async () => {
  const g = await newGateway();
  const login = await g.call('/api/v1/auth/login', {
    method: 'POST', body: { email: 'customer@example.com', password: 'DevPass!2026#', role: 'CUSTOMER' }
  });
  assert.equal(login.status, 200, login.text);
  assert.equal(login.json.user.locale, 'ko-KR');
  const me = await g.call('/api/v1/auth/me', { token: login.json.token });
  assert.equal(me.status, 200, me.text);
  assert.equal(me.json.data.user.locale, 'ko-KR');
});

// 2. Members change it through the profile endpoint only.
await t.test('2. profile persists valid locales, rejects the rest', async () => {
  const g = await newGateway();
  const login = await g.call('/api/v1/auth/login', {
    method: 'POST', body: { email: 'customer@example.com', password: 'DevPass!2026#', role: 'CUSTOMER' }
  });
  const token = login.json.token;
  for (const loc of ['en-US', 'ja-JP', 'ko-KR']) {
    const r = await g.call('/api/v1/auth/profile', { method: 'PUT', token, body: { locale: loc } });
    assert.equal(r.status, 200, r.text);
    assert.equal(r.json.data.user.locale, loc);
  }
  const bad = await g.call('/api/v1/auth/profile', { method: 'PUT', token, body: { locale: 'fr-FR' } });
  assert.equal(bad.status, 400);
  assert.equal(bad.json.code, 'INVALID_LOCALE');
  const me = await g.call('/api/v1/auth/me', { token });
  assert.equal(me.json.data.user.locale, 'ko-KR', 'rejected write changes nothing');
  const anon = await g.call('/api/v1/auth/profile', { method: 'PUT', body: { locale: 'en-US' } });
  assert.equal(anon.status, 401);
});

t.finish();
