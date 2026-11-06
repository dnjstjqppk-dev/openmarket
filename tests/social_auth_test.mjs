// tests/social_auth_test.mjs
// Focused regression suite for Kakao OAuth login (routes/social-auth.js +
// migrations/d1_34_social_accounts.sql). No live provider calls: start,
// fail-closed behavior, callback guards, and the oauth identity columns.

import assert from 'node:assert/strict';
import { createGateway, createRunner } from './lib/harness.mjs';

const t = createRunner('Social Auth (Kakao OAuth)');

const BASE_ENV = {
  JWT_SECRET: 'e2e-secret-0123456789abcdefghijklmnopqrstu',
  ENVIRONMENT: 'development'
};

const KAKAO_ENV = {
  ...BASE_ENV,
  KAKAO_REST_API_KEY: 'test-rest-api-key',
  KAKAO_REDIRECT_URI: 'https://api.test.local/api/v1/auth/social/kakao/callback'
};

await t.test('1. unconfigured server answers 501 and creates nothing', async () => {
  const g = await createGateway({ seedFiles: ['migrations/dev/seed_local_dev.sql'], env: BASE_ENV });
  const cols = g.db.prepare('PRAGMA table_info(users)').all().map((c) => c.name);
  assert.ok(cols.includes('oauth_provider'), 'd1_34 applied: oauth_provider');
  assert.ok(cols.includes('oauth_subject'), 'd1_34 applied: oauth_subject');
  const start = await g.call('/api/v1/auth/social/kakao/start');
  assert.equal(start.status, 501);
  assert.equal(start.json.code, 'SOCIAL_LOGIN_NOT_INTEGRATED');
});

await t.test('2. configured start redirects to Kakao authorize', async () => {
  const g = await createGateway({ seedFiles: ['migrations/dev/seed_local_dev.sql'], env: KAKAO_ENV });
  const start = await g.call('/api/v1/auth/social/kakao/start');
  assert.equal(start.status, 302);
  const loc = start.headers.get('location') || '';
  assert.ok(loc.startsWith('https://kauth.kakao.com/oauth/authorize?'), `redirects to Kakao, got ${loc}`);
  assert.ok(loc.includes('client_id=test-rest-api-key'));
  assert.ok(loc.includes(encodeURIComponent(KAKAO_ENV.KAKAO_REDIRECT_URI)));
  assert.ok(loc.includes('scope=account_email'));
});

await t.test('3. callback without a code bounces to login with OAUTH_DENIED', async () => {
  const g = await createGateway({ seedFiles: ['migrations/dev/seed_local_dev.sql'], env: KAKAO_ENV });
  const cb = await g.call('/api/v1/auth/social/kakao/callback');
  assert.equal(cb.status, 302);
  const loc = cb.headers.get('location') || '';
  assert.ok(loc.includes('/login?'), `bounces to login, got ${loc}`);
  assert.ok(loc.includes('social_error=OAUTH_DENIED'));
  const denied = await g.call('/api/v1/auth/social/kakao/callback?error=access_denied');
  assert.equal(denied.status, 302);
  assert.ok((denied.headers.get('location') || '').includes('social_error=OAUTH_DENIED'));
});

await t.test('4. oauth identity is unique per provider subject', async () => {
  const g = await createGateway({ seedFiles: ['migrations/dev/seed_local_dev.sql'], env: BASE_ENV });
  g.db.prepare(
    "INSERT INTO users (id, email, password_hash, full_name, phone, role, is_active, oauth_provider, oauth_subject) VALUES ('usr_oauth_1', 'oauth1@example.com', 'oauth:x', 'OAuth One', '', 'ROLE_CUSTOMER', 1, 'kakao', 'subj_1')"
  ).run();
  assert.throws(
    () =>
      g.db.prepare(
        "INSERT INTO users (id, email, password_hash, full_name, phone, role, is_active, oauth_provider, oauth_subject) VALUES ('usr_oauth_2', 'oauth2@example.com', 'oauth:y', 'OAuth Two', '', 'ROLE_CUSTOMER', 1, 'kakao', 'subj_1')"
      ).run(),
    /UNIQUE/
  );
});

t.finish();
