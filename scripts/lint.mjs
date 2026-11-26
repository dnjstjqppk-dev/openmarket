// scripts/lint.mjs — dependency-free static gate for the gateway worker.
// The old `node --check src/index.js` covered a single file; this checks every
// JS module under apps/cloudflare-gateway/src so a syntax break anywhere fails
// the gate. TS/Vue sources are covered by `npm run typecheck`.
// Run: node scripts/lint.mjs (exit 1 on any failure, or on zero files checked).
import { readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'apps/cloudflare-gateway/src');

function walk(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith('.js')) out.push(p);
  }
  return out;
}

const files = walk(SRC);
if (!files.length) {
  console.error('lint: no gateway sources found — refusing a vacuous pass');
  process.exit(1);
}
let failed = 0;
for (const f of files) {
  const r = spawnSync(process.execPath, ['--check', f], { stdio: 'pipe' });
  if (r.status !== 0) {
    failed++;
    console.error(`lint: syntax error in ${f}`);
    console.error(String(r.stderr || r.stdout || '').trim());
  }
}
console.log(`lint: ${files.length - failed}/${files.length} gateway modules syntax-clean`);
process.exit(failed ? 1 : 0);
