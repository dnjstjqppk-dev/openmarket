// tests/social_auth_test.mjs
// Focused regression suite for Kakao OAuth login (routes/social-auth.js +
// migrations/d1_34_social_accounts.sql). No live provider calls: start,
// fail-closed behavior, callback guards, and the oauth identity columns.

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
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

const sha256 = (s) => createHash('sha256').update(s, 'utf8').digest('hex');
const VALID_STATE = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';

await t.test('5. start echoes a valid state to Kakao and rejects a malformed one', async () => {
  const g = await createGateway({ seedFiles: ['migrations/dev/seed_local_dev.sql'], env: KAKAO_ENV });
  const ok = await g.call(`/api/v1/auth/social/kakao/start?state=${VALID_STATE}`);
  assert.equal(ok.status, 302);
  assert.ok((ok.headers.get('location') || '').includes(`state=${VALID_STATE}`), 'state round-trips to the provider');
  for (const badState of ['abc', 'x'.repeat(300), '<script>alert(1)</script>', 'has space']) {
    const r = await g.call(`/api/v1/auth/social/kakao/start?state=${encodeURIComponent(badState)}`);
    assert.equal(r.status, 400, `malformed state rejected: ${badState.slice(0, 20)}`);
    assert.equal(r.json.code, 'INVALID_STATE');
  }
});

await t.test('6. denial bounce echoes the state back to the login page', async () => {
  const g = await createGateway({ seedFiles: ['migrations/dev/seed_local_dev.sql'], env: KAKAO_ENV });
  const cb = await g.call(`/api/v1/auth/social/kakao/callback?error=access_denied&state=${VALID_STATE}`);
  assert.equal(cb.status, 302);
  const loc = cb.headers.get('location') || '';
  assert.ok(loc.includes('social_error=OAUTH_DENIED'));
  assert.ok(loc.includes(`state=${VALID_STATE}`), `state echoed on denial, got ${loc}`);
});

await t.test('7. one-time login code exchanges for a working JWT exactly once', async () => {
  const g = await createGateway({ seedFiles: ['migrations/dev/seed_local_dev.sql'], env: KAKAO_ENV });
  const cols = g.db.prepare('PRAGMA table_info(social_login_codes)').all().map((c) => c.name);
  assert.ok(cols.includes('code_hash'), 'd1_35 applied: social_login_codes');
  const user = g.db.prepare("SELECT id FROM users WHERE is_active = 1 LIMIT 1").get();
  assert.ok(user, 'seed user exists');
  const code = 'f'.repeat(64);
  g.db.prepare('INSERT INTO social_login_codes (id, user_id, code_hash, expires_at) VALUES (?, ?, ?, ?)')
    .run('slc_test_1', user.id, sha256(code), new Date(Date.now() + 5 * 60 * 1000).toISOString());
  const ex = await g.call('/api/v1/auth/social/kakao/exchange', { method: 'POST', body: { code } });
  assert.equal(ex.status, 200);
  assert.equal(ex.json.success, true);
  assert.ok(typeof ex.json.token === 'string' && ex.json.token.length > 20, 'JWT issued');
  assert.equal(ex.json.user.id, user.id);
  const me = await g.call('/api/v1/auth/me', { token: ex.json.token });
  assert.equal(me.status, 200, 'exchanged JWT authenticates');
  assert.equal(me.json.data.user.id, user.id);
  const replay = await g.call('/api/v1/auth/social/kakao/exchange', { method: 'POST', body: { code } });
  assert.equal(replay.status, 400, 'code is single-use');
  assert.equal(replay.json.code, 'INVALID_LOGIN_CODE');
});

await t.test('8. unknown and expired login codes are rejected without an oracle', async () => {
  const g = await createGateway({ seedFiles: ['migrations/dev/seed_local_dev.sql'], env: KAKAO_ENV });
  const user = g.db.prepare("SELECT id FROM users WHERE is_active = 1 LIMIT 1").get();
  g.db.prepare('INSERT INTO social_login_codes (id, user_id, code_hash, expires_at) VALUES (?, ?, ?, ?)')
    .run('slc_test_expired', user.id, sha256('e'.repeat(64)), new Date(Date.now() - 60 * 1000).toISOString());
  const unknown = await g.call('/api/v1/auth/social/kakao/exchange', { method: 'POST', body: { code: '0'.repeat(64) } });
  assert.equal(unknown.status, 400);
  assert.equal(unknown.json.code, 'INVALID_LOGIN_CODE');
  const expired = await g.call('/api/v1/auth/social/kakao/exchange', { method: 'POST', body: { code: 'e'.repeat(64) } });
  assert.equal(expired.status, 400);
  assert.equal(expired.json.code, unknown.json.code);
  assert.equal(expired.json.error, unknown.json.error, 'expired and unknown give the identical answer');
});

t.finish();
