// tests/client_errors_test.mjs
// Focused regression suite for POST /api/v1/client-errors
// (routes/client-errors.js): public intake, 204, validation, no retention.

import assert from 'node:assert/strict';
import { createGateway, createRunner } from './lib/harness.mjs';

const t = createRunner('Client Error Telemetry');

async function newGateway() {
  return createGateway({
    seedFiles: ['migrations/dev/seed_local_dev.sql'],
    env: {
      JWT_SECRET: 'e2e-secret-0123456789abcdefghijklmnopqrstu',
      ENVIRONMENT: 'development'
    }
  });
}

await t.test('1. accepts a report without auth and stores nothing', async () => {
  const g = await newGateway();
  const tables = g.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'client_errors'").get();
  assert.equal(tables, undefined, 'no client_errors table may exist');
  const r = await g.call('/api/v1/client-errors', {
    method: 'POST',
    body: { app: 'storefront', kind: 'window.onerror', message: 'Cannot read properties of null', url: '/product/x' }
  });
  assert.equal(r.status, 204);
});

await t.test('2. rejects empty reports and wrong methods', async () => {
  const g = await newGateway();
  const empty = await g.call('/api/v1/client-errors', { method: 'POST', body: { app: 'storefront' } });
  assert.equal(empty.status, 400);
  const get = await g.call('/api/v1/client-errors');
  assert.equal(get.status, 405);
  const huge = await g.call('/api/v1/client-errors', { method: 'POST', body: { app: 'storefront', message: 'x'.repeat(9000) } });
  assert.ok([400, 413].includes(huge.status));
});

t.finish();
