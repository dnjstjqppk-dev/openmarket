// tests/ops_health_test.mjs
// P0-4: health must report 503 when degraded, every error must carry a
// request_id, and one failing scheduled job must not abort the whole tick.
// Run: node tests/ops_health_test.mjs
import assert from 'node:assert/strict';
import { createGateway, createRunner } from './lib/harness.mjs';

const t = createRunner('Ops health hardening (P0-4)');
const SECRET = 'test-jwt-secret-0123456789abcdefghijklmnop';
const BASE_ENV = { JWT_SECRET: SECRET, ENVIRONMENT: 'test' };
// Minute 7 of hour 10 on the 26th: time-gated jobs (pii purge, grading,
// search purge, delta sync, rotation) are all NOT_DUE, keeping the tick fast.
const TICK = { scheduledTime: Date.parse('2026-11-26T10:07:00Z'), cron: '*/5 * * * *' };

async function runTick(g) {
  const lines = [];
  const realLog = console.log;
  const realErr = console.error;
  console.log = (...a) => { lines.push(a.join(' ')); };
  console.error = (...a) => { lines.push(a.join(' ')); };
  try {
    await g.worker.scheduled(TICK, g.env, g.ctx);
    assert.equal(g.scheduled.length, 1, 'tick must schedule exactly one batch');
    await g.scheduled[0];
  } finally {
    console.log = realLog;
    console.error = realErr;
  }
  return lines.join('\n');
}

await t.test('H01 healthy gateway reports UP with 200', async () => {
  const g = await createGateway({ env: BASE_ENV });
  const r = await g.call('/health');
  assert.equal(r.status, 200);
  assert.equal(r.json.status, 'UP');
});

await t.test('H02 disconnected DB reports DEGRADED with 503', async () => {
  const g = await createGateway({ env: BASE_ENV });
  g.env.DB.prepare = () => { throw new Error('DB_DOWN'); };
  const r = await g.call('/health');
  assert.equal(r.status, 503);
  assert.equal(r.json.status, 'DEGRADED');
});

await t.test('H03 client errors carry a unique request_id', async () => {
  const g = await createGateway({ env: BASE_ENV });
  const a = await g.call('/api/v1/partner/products');
  assert.equal(a.status, 401);
  assert.ok(typeof a.json.request_id === 'string' && a.json.request_id.length > 0, '401 has request_id');
  const b = await g.call('/api/v1/partner/products');
  assert.ok(b.json.request_id && b.json.request_id !== a.json.request_id, 'ids differ per request');
});

await t.test('H04 tick survives a failing expire-orders job', async () => {
  const g = await createGateway({ env: BASE_ENV });
  const realPrepare = g.env.DB.prepare;
  g.env.DB.prepare = (sql) => {
    if (String(sql).includes('payment_expires_at <')) throw new Error('EXPIRE_BOOM');
    return realPrepare(sql);
  };
  const out = await runTick(g);
  assert.ok(out.includes('"job":"scheduled"'), 'summary still logged');
  assert.ok(out.includes('"expired":"ERROR"'), 'failed job marked ERROR');
  assert.ok(/"confirmed":\d+/.test(out), 'later auto-confirm job still ran');
  assert.ok(out.includes('"job":"expire_orders"'), 'failure itself is logged');
});

await t.test('H05 tick survives a failing auto-confirm job', async () => {
  const g = await createGateway({ env: BASE_ENV });
  const realPrepare = g.env.DB.prepare;
  g.env.DB.prepare = (sql) => {
    if (String(sql).includes('delivered_at <=')) throw new Error('CONFIRM_BOOM');
    return realPrepare(sql);
  };
  const out = await runTick(g);
  assert.ok(out.includes('"job":"scheduled"'), 'summary still logged');
  assert.ok(out.includes('"confirmed":"ERROR"'), 'failed job marked ERROR');
  assert.ok(/"expired":\d+/.test(out), 'earlier expire job still ran');
});

t.finish();
