// tests/migration_order_test.mjs
// Migration versions compare numerically: lexical ordering misplaces d1_100
// before d1_20, which broke MAX(version) reads, remote apply order, and
// rehearsal order. Every layer pins its numeric rule here.
// Run: node tests/migration_order_test.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createGateway, createRunner, listMigrations } from './lib/harness.mjs';
import { compareMigrationNames, maxMigrationVersion, migrationNum } from '../apps/cloudflare-gateway/src/lib/migration-version.js';
import { assertSchemaLevel, REQUIRED_SCHEMA_VERSION } from '../apps/cloudflare-gateway/src/services/orders.js';

const t = createRunner('Migration version ordering');
const read = (p) => readFileSync(p, 'utf8');
const SECRET = 'test-jwt-secret-0123456789abcdefghijklmnop';

await t.test('V01 comparator orders numerically with name tiebreak', async () => {
  assert.equal(migrationNum('d1_100_x.sql'), 100);
  assert.equal(migrationNum('d1_09a_y.sql'), 9);
  assert.equal(migrationNum('seed.sql'), -1);
  const names = ['d1_77_b.sql', 'd1_100_a.sql', 'd1_9_c.sql', 'd1_77_a.sql'];
  assert.deepEqual([...names].sort(compareMigrationNames),
    ['d1_9_c.sql', 'd1_77_a.sql', 'd1_77_b.sql', 'd1_100_a.sql']);
  assert.equal(maxMigrationVersion(names), 'd1_100_a.sql');
  assert.equal(maxMigrationVersion([]), null);
});

await t.test('V02 harness lists migrations in numeric order', async () => {
  const files = listMigrations();
  assert.ok(files.length > 70, `expected 70+ migrations, got ${files.length}`);
  assert.equal(files.at(-1), REQUIRED_SCHEMA_VERSION, 'pin tracks the newest file');
  const nums = files.map(migrationNum);
  assert.ok(nums.every((n, i) => i === 0 || n >= nums[i - 1]), 'non-decreasing numeric order');
});

await t.test('V03 gateway reads the numeric ledger max', async () => {
  const g = await createGateway({ env: { JWT_SECRET: SECRET, ENVIRONMENT: 'test' } });
  g.db.prepare('INSERT OR IGNORE INTO schema_migrations (version) VALUES (?)').run('d1_100_probe_fake.sql');
  const h = await g.call('/health');
  assert.equal(h.json.schemaVersion, 'd1_100_probe_fake.sql', 'health reports the numeric max, not lexical MAX');
  // The fake row differs from REQUIRED_SCHEMA_VERSION, so order writes must refuse.
  let code = null;
  try { await assertSchemaLevel(g.env); } catch (e) { code = e.code; }
  assert.equal(code, 'SCHEMA_MISMATCH');
});

await t.test('V04 remote workflow sorts, compares, and snapshots', async () => {
  const yml = read('.github/workflows/migrate-d1-remote.yml');
  assert.ok(yml.includes('sort -V'), 'apply loop uses version sort');
  assert.ok(yml.includes('mig_gt'), 'pending check compares numerically');
  assert.ok(yml.includes('SELECT version AS v FROM schema_migrations'), 'ledger max computed numerically');
  assert.ok(!yml.includes('SELECT MAX(version)'), 'no lexical MAX remains');
  // Restore point taken before anything is applied (fail closed).
  const bm = yml.indexOf('d1 time-travel info');
  assert.ok(bm > 0 && bm < yml.indexOf('--file="$f"'), 'Time Travel bookmark recorded before applying');
  // Whole-DB export fails on FTS5 databases (since d1_51): export per table.
  assert.ok(yml.includes('"${ARGS[@]}"') && yml.includes("CREATE VIRTUAL TABLE%"), 'per-table export without virtual tables');
  assert.ok(!/d1 export "\$DB" --remote --config "\$CFG" --output/.test(yml), 'no whole-DB export');
  // Public repository: artifacts are world-readable, so only an encrypted snapshot may be uploaded.
  assert.ok(yml.includes('gpg --batch') && yml.includes('--symmetric --cipher-algo AES256'), 'snapshot encrypted');
  const up = yml.slice(yml.indexOf('upload-artifact@v4'));
  assert.ok(/path: \$\{\{ env\.SNAP \}\}/.test(up) && yml.includes('.tar.gz.gpg"'), 'only the .gpg file is uploaded');
});

await t.test('V05 python ops scripts compare numerically and fail closed', async () => {
  for (const f of ['scripts/ops/rehearse_phase5.py', 'scripts/d1_rehearse_on_backup.py', 'scripts/d1_rollback_from_backup.py']) {
    assert.ok(read(f).includes('def mig_key('), `${f} defines the numeric key`);
  }
  assert.ok(!read('scripts/ops/rehearse_phase5.py').includes('SELECT MAX(version)'), 'rehearsal avoids lexical MAX');
  const restore = read('scripts/ops/build_d1_restore.py');
  assert.ok(restore.includes('assert not cycles'), 'restore fails on FK cycles');
  assert.ok(read('scripts/local-db-reset.mjs').includes('sort(migCmp)'), 'local reset applies in numeric order');
});

t.finish();
