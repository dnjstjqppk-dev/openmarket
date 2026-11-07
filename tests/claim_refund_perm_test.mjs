// tests/claim_refund_perm_test.mjs
// Claim decision privilege separation (P0 gap #7):
//   PUT /api/v1/admin/claims/:id with decision=APPROVE moves money through
//   the refund engine, so it requires 'orders.refund' — 'orders.manage' alone
//   (OPERATIONS role) must get 403, while REJECT stays on 'orders.manage'.
//   CS (orders.manage + orders.refund) passes the permission check.

import assert from 'node:assert/strict';
import { createGateway, createRunner } from './lib/harness.mjs';

const t = createRunner('Claim Refund Permission');

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

// Minimal orders row built from the live schema (robust to column drift).
function insertOrder(g, id, customerId) {
  const cols = g.db.prepare('PRAGMA table_info(orders)').all();
  const names = ['id'];
  const vals = [id];
  for (const c of cols) {
    if (c.name === 'id' || c.notnull !== 1 || c.dflt_value !== null) continue;
    names.push(c.name);
    if (c.name === 'order_no') vals.push(`CLM-${id}`);
    else if (c.name === 'customer_id') vals.push(customerId);
    else vals.push(/^INT/i.test(c.type) ? 0 : 't');
  }
  g.db.prepare(`INSERT INTO orders (${names.join(',')}) VALUES (${names.map(() => '?').join(',')})`).run(...vals);
}

function insertClaim(g, id, orderId, userId) {
  g.db.prepare(
    "INSERT INTO returns (id, order_id, user_id, claim_type, reason, status) VALUES (?, ?, ?, 'RETURN', 'test', 'REQUESTED')"
  ).run(id, orderId, userId);
}

const claimStatus = (g, id) => g.db.prepare('SELECT status FROM returns WHERE id = ?').get(id).status;
const setRole = (g, role) => g.db.prepare("UPDATE users SET admin_role = ? WHERE email = 'admin@openmarket.com'").run(role);

await t.test('1. OPERATIONS approves nothing: 403 without orders.refund', async () => {
  const g = await newGateway();
  const login = await g.call('/api/v1/auth/login', { method: 'POST', body: { email: 'admin@openmarket.com', password: 'DevPass!2026#', role: 'ADMIN' } });
  assert.equal(login.status, 200);
  const token = login.json.token;
  const uid = g.db.prepare("SELECT id FROM users WHERE role = 'ROLE_CUSTOMER' LIMIT 1").get().id;
  insertOrder(g, 'o_clm1', uid);
  insertClaim(g, 'clm_op1', 'o_clm1', uid);

  setRole(g, 'OPERATIONS');
  const r = await g.call('/api/v1/admin/claims/clm_op1', { method: 'PUT', token, body: { decision: 'APPROVE' } });
  assert.equal(r.status, 403);
  assert.match(String(r.json.error || ''), /orders\.refund/);
  assert.equal(claimStatus(g, 'clm_op1'), 'REQUESTED');
});

await t.test('2. OPERATIONS can still REJECT on orders.manage', async () => {
  const g = await newGateway();
  const login = await g.call('/api/v1/auth/login', { method: 'POST', body: { email: 'admin@openmarket.com', password: 'DevPass!2026#', role: 'ADMIN' } });
  const token = login.json.token;
  const uid = g.db.prepare("SELECT id FROM users WHERE role = 'ROLE_CUSTOMER' LIMIT 1").get().id;
  insertOrder(g, 'o_clm2', uid);
  insertClaim(g, 'clm_op2', 'o_clm2', uid);

  setRole(g, 'OPERATIONS');
  const r = await g.call('/api/v1/admin/claims/clm_op2', { method: 'PUT', token, body: { decision: 'REJECT', notes: '사유 불충분' } });
  assert.equal(r.status, 200);
  assert.equal(r.json.status, 'REJECTED');
  assert.equal(claimStatus(g, 'clm_op2'), 'REJECTED');
  assert.ok(g.db.prepare("SELECT action FROM admin_audit_log WHERE action = 'CLAIM_REJECT' AND target_id = 'clm_op2'").get(), 'reject audited');
});

await t.test('3. CS passes the refund permission check on APPROVE', async () => {
  const g = await newGateway();
  const login = await g.call('/api/v1/auth/login', { method: 'POST', body: { email: 'admin@openmarket.com', password: 'DevPass!2026#', role: 'ADMIN' } });
  const token = login.json.token;
  const uid = g.db.prepare("SELECT id FROM users WHERE role = 'ROLE_CUSTOMER' LIMIT 1").get().id;
  insertOrder(g, 'o_clm3', uid);
  insertClaim(g, 'clm_cs3', 'o_clm3', uid);

  setRole(g, 'CS');
  const r = await g.call('/api/v1/admin/claims/clm_cs3', { method: 'PUT', token, body: { decision: 'APPROVE' } });
  assert.notEqual(r.status, 403, `CS must pass the orders.refund check (got ${r.status}: ${JSON.stringify(r.json).slice(0, 160)})`);
});

t.finish();
