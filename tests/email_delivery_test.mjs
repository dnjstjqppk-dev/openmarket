// tests/email_delivery_test.mjs
// Focused regression suite for mail fail-closed behavior (routes/auth.js +
// lib/email.js): honest NOT_INTEGRATED without keys, identical answers for
// unknown addresses, and 503 (never fake success) when the provider fails.

import assert from 'node:assert/strict';
import { createGateway, createRunner } from './lib/harness.mjs';

const t = createRunner('Email Delivery Fail-Closed');

const BASE_ENV = {
  JWT_SECRET: 'e2e-secret-0123456789abcdefghijklmnopqrstu',
  ENVIRONMENT: 'development',
  PAYMENT_MODE: 'sandbox'
};

await t.test('1. unconfigured provider answers honestly and never enumerates', async () => {
  const g = await createGateway({ seedFiles: ['migrations/dev/seed_local_dev.sql'], env: BASE_ENV });
  const known = await g.call('/api/v1/auth/forgot-password', { method: 'POST', body: { email: 'admin@openmarket.com' } });
  assert.equal(known.status, 200);
  assert.equal(known.json.success, true);
  assert.equal(known.json.email_delivery, 'NOT_INTEGRATED');
  const unknown = await g.call('/api/v1/auth/forgot-password', { method: 'POST', body: { email: 'nobody-xyz@example.com' } });
  assert.equal(unknown.status, 200);
  assert.equal(unknown.json.message, known.json.message);
  assert.equal(unknown.json.email_delivery, known.json.email_delivery);
  assert.equal(unknown.json.dev_reset_token, undefined);
});

await t.test('2. configured provider never reports fake success on failure', async () => {
  const g = await createGateway({
    seedFiles: ['migrations/dev/seed_local_dev.sql'],
    env: { ...BASE_ENV, RESEND_API_KEY: 're_invalid_test_key', EMAIL_FROM: 'noreply@olmoa.com' }
  });
  // A bogus key makes Resend answer 401 (or the fetch fail): the API must 503, never "SENT".
  const r = await g.call('/api/v1/auth/forgot-password', { method: 'POST', body: { email: 'admin@openmarket.com' } });
  assert.equal(r.status, 503);
  assert.equal(r.json.code, 'EMAIL_SEND_FAILED');
  assert.notEqual(r.json.email_delivery, 'SENT');
});

await t.test('3. reset + verify token round-trip still works end to end', async () => {
  const g = await createGateway({ seedFiles: ['migrations/dev/seed_local_dev.sql'], env: BASE_ENV });
  const fp = await g.call('/api/v1/auth/forgot-password', { method: 'POST', body: { email: 'admin@openmarket.com' } });
  assert.ok(fp.json.dev_reset_token, 'dev token exposed in development');
  const reset = await g.call('/api/v1/auth/reset-password', {
    method: 'POST',
    body: { token: fp.json.dev_reset_token, new_password: 'NewPass!2026#x' }
  });
  assert.equal(reset.status, 200);
  const reuse = await g.call('/api/v1/auth/reset-password', {
    method: 'POST',
    body: { token: fp.json.dev_reset_token, new_password: 'NewPass!2026#y' }
  });
  assert.equal(reuse.status, 400, 'one-time token cannot be reused');
});

t.finish();
