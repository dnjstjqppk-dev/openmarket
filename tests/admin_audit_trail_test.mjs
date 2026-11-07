// tests/admin_audit_trail_test.mjs
// The admin router contract: every mutation writes admin_audit_log, and every
// JSON body goes through the size-capped readJson (413 PAYLOAD_TOO_LARGE).

import assert from 'node:assert/strict';
import { createGateway, createRunner } from './lib/harness.mjs';

const t = createRunner('Admin Audit Trail');

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

function audited(g, action, targetId) {
  return g.db.prepare('SELECT action FROM admin_audit_log WHERE action = ? AND target_id = ?').get(action, targetId);
}

await t.test('1. banner/notif/coupon/category mutations are audited', async () => {
  const g = await newGateway();
  const login = await g.call('/api/v1/auth/login', { method: 'POST', body: { email: 'admin@openmarket.com', password: 'DevPass!2026#', role: 'ADMIN' } });
  assert.equal(login.status, 200);
  const token = login.json.token;
  const uid = g.db.prepare("SELECT id FROM users WHERE role = 'ROLE_CUSTOMER' LIMIT 1").get().id;

  const b = await g.call('/api/v1/admin/banners', { method: 'POST', token, body: { title: '감사 배너', subtitle: 's', badge_text: 'B', image_url: 'https://cdn.example/b.png', link_url: '/x', bg_gradient: 'g', display_order: 9, is_active: true } });
  assert.equal(b.status, 201);
  assert.ok(audited(g, 'BANNER_CREATE', b.json.data.id), 'banner create audited');

  const u = await g.call(`/api/v1/admin/banners/${b.json.data.id}`, { method: 'PUT', token, body: { title: '감사 배너2' } });
  assert.equal(u.status, 200);
  assert.ok(audited(g, 'BANNER_UPDATE', b.json.data.id), 'banner update audited');

  const d = await g.call(`/api/v1/admin/banners/${b.json.data.id}`, { method: 'DELETE', token });
  assert.equal(d.status, 200);
  assert.ok(audited(g, 'BANNER_DELETE', b.json.data.id), 'banner delete audited');
  assert.equal((await g.call('/api/v1/admin/banners/bnr_nope', { method: 'DELETE', token })).status, 404);

  const n = await g.call('/api/v1/admin/notifications', { method: 'POST', token, body: { target: uid, title: '감사 알림', message: 'm', type: 'SYSTEM' } });
  assert.equal(n.status, 201);
  assert.ok(g.db.prepare("SELECT action FROM admin_audit_log WHERE action = 'NOTIFICATION_BROADCAST'").get(), 'broadcast audited');

  const c = await g.call('/api/v1/admin/coupons', { method: 'POST', token, body: { code: 'AUDIT10', title: '감사 쿠폰', discount_type: 'FIXED_AMOUNT', discount_value: 1000 } });
  assert.equal(c.status, 201);
  assert.ok(audited(g, 'COUPON_CREATE', c.json.data.id), 'coupon create audited');

  const cat = await g.call('/api/v1/admin/categories', { method: 'POST', token, body: { name: '감사카테고리', slug: 'audit-cat' } });
  assert.equal(cat.status, 201);
  assert.ok(audited(g, 'CATEGORY_CREATE', cat.json.data.id), 'category create audited');
  assert.equal((await g.call(`/api/v1/admin/categories/${cat.json.data.id}`, { method: 'DELETE', token })).status, 200);
  assert.ok(audited(g, 'CATEGORY_DELETE', cat.json.data.id), 'category delete audited');
});

await t.test('2. oversize JSON bodies are rejected with 413', async () => {
  const g = await newGateway();
  const login = await g.call('/api/v1/auth/login', { method: 'POST', body: { email: 'admin@openmarket.com', password: 'DevPass!2026#', role: 'ADMIN' } });
  const r = await g.call('/api/v1/admin/banners', { method: 'POST', token: login.json.token, body: { title: 'x'.repeat(1_100_000) } });
  assert.equal(r.status, 413);
  assert.equal(r.json.code, 'PAYLOAD_TOO_LARGE');
});

t.finish();
