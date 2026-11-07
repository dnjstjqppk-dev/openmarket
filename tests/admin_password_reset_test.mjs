// tests/admin_password_reset_test.mjs
// P2R-01: mail is not integrated (no provider contract), so the supported
// recovery path is an operator password reset: POST
// /api/v1/admin/users/:id/reset-password sets a policy-checked password,
// revokes all sessions, clears lockout, and writes the audit log.

import assert from 'node:assert/strict';
import { createGateway, createRunner } from './lib/harness.mjs';

const t = createRunner('Admin Password Reset (P2R-01)');

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

async function login(g, email, password, role) {
  return g.call('/api/v1/auth/login', { method: 'POST', body: { email, password, role } });
}

async function freshCustomer(g, email) {
  const r = await g.call('/api/v1/auth/register', {
    method: 'POST',
    body: { email, password: 'CustPass!2026#', full_name: '재설정', phone: '010-2222-3333', agree_terms: true, agree_privacy: true }
  });
  assert.equal(r.status, 201);
  return r.json;
}

await t.test('1. admin reset swaps the password, revokes sessions and clears lockout', async () => {
  const g = await newGateway();
  const cust = await freshCustomer(g, 'reset.case@example.com');
  const adm = await login(g, 'admin@openmarket.com', 'DevPass!2026#', 'ADMIN');
  assert.equal(adm.status, 200);

  // Lock the account with real failed logins first.
  for (let i = 0; i < 5; i++) await login(g, 'reset.case@example.com', 'WrongPass!0000#', 'CUSTOMER');
  const locked = await login(g, 'reset.case@example.com', 'CustPass!2026#', 'CUSTOMER');
  assert.equal(locked.status, 423);

  const reset = await g.call(`/api/v1/admin/users/${cust.customer_id}/reset-password`, {
    method: 'POST', token: adm.json.token, body: { new_password: 'BrandNew!2026#1' }
  });
  assert.equal(reset.status, 200);
  assert.equal(reset.json.success, true);
  assert.ok(!JSON.stringify(reset.json).includes('BrandNew'), 'new password must not echo back');

  assert.equal((await login(g, 'reset.case@example.com', 'CustPass!2026#', 'CUSTOMER')).status, 401);
  const fresh = await login(g, 'reset.case@example.com', 'BrandNew!2026#1', 'CUSTOMER');
  assert.equal(fresh.status, 200);
  assert.equal((await g.call('/api/v1/auth/me', { token: cust.token })).status, 401);

  const row = g.db.prepare('SELECT failed_login_count, locked_until FROM users WHERE id = ?').get(cust.customer_id);
  assert.equal(row.failed_login_count, 0);
  assert.equal(row.locked_until, null);
});

await t.test('2. guards: role, target, password policy and audit', async () => {
  const g = await newGateway();
  const cust = await freshCustomer(g, 'reset.guard@example.com');
  const adm = await login(g, 'admin@openmarket.com', 'DevPass!2026#', 'ADMIN');
  const pt = await login(g, 'seller@temu-supply.com', 'DevPass!2026#', 'PARTNER');
  const url = `/api/v1/admin/users/${cust.customer_id}/reset-password`;

  assert.equal((await g.call(url, { method: 'POST', token: pt.json.token, body: { new_password: 'BrandNew!2026#1' } })).status, 403);
  assert.equal((await g.call(url, { method: 'POST', body: { new_password: 'BrandNew!2026#1' } })).status, 401);
  const weak = await g.call(url, { method: 'POST', token: adm.json.token, body: { new_password: 'short' } });
  assert.equal(weak.status, 400);
  assert.equal(weak.json.code, 'WEAK_PASSWORD');
  const missing = await g.call('/api/v1/admin/users/no_such_user/reset-password', { method: 'POST', token: adm.json.token, body: { new_password: 'BrandNew!2026#1' } });
  assert.equal(missing.status, 404);

  const adminRow = g.db.prepare("SELECT id FROM users WHERE role = 'ROLE_ADMIN' LIMIT 1").get();
  const opReset = await g.call(`/api/v1/admin/users/${adminRow.id}/reset-password`, { method: 'POST', token: adm.json.token, body: { new_password: 'BrandNew!2026#1' } });
  assert.equal(opReset.status, 403);
  assert.match(opReset.json.error, /보안 절차/);

  const ok = await g.call(url, { method: 'POST', token: adm.json.token, body: { new_password: 'BrandNew!2026#1' } });
  assert.equal(ok.status, 200);
  const audit = g.db.prepare("SELECT action, target_id FROM admin_audit_log WHERE action = 'USER_PASSWORD_RESET' AND target_id = ?").get(cust.customer_id);
  assert.ok(audit, 'reset must be audited');
});

t.finish();
