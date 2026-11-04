// scripts/local-db-reset.mjs — rebuild the LOCAL D1 used by `wrangler dev` (never touches remote).
//   node scripts/local-db-reset.mjs
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const persist = path.join(root, '.wrangler', 'local-state');
fs.rmSync(persist, { recursive: true, force: true });
const files = fs.readdirSync(path.join(root, 'migrations')).filter((f) => /^d1_\d+.*\.sql$/.test(f)).sort().map((f) => path.join('migrations', f));
files.push(path.join('migrations', 'dev', 'seed_local_dev.sql'));
for (const f of files) {
  process.stdout.write(`applying ${f} ... `);
  execFileSync(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['wrangler', 'd1', 'execute', 'openmarket-db', '--local', '--persist-to', persist,
    '--config', 'apps/cloudflare-gateway/wrangler.jsonc', '--file', f, '--yes'], { cwd: root, stdio: ['ignore', 'ignore', 'inherit'], shell: process.platform === 'win32' });
  console.log('ok');
}
console.log(`local D1 ready at ${persist}`);
