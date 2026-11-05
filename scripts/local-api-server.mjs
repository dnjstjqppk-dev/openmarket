// scripts/local-api-server.mjs — serve the gateway Worker over HTTP on this machine without wrangler.
// Uses the test harness (in-memory node:sqlite D1 with every migration + migrations/dev/seed_local_dev.sql)
// and apps/cloudflare-gateway/.dev.vars. Data lives only in memory and is gone when the process exits;
// nothing here can reach the production D1.
//   node scripts/local-api-server.mjs [port]        (default 8787)
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { ROOT, createGateway } from '../tests/lib/harness.mjs';

const port = Number(process.argv[2] || process.env.PORT || 8787);
const devVars = path.join(ROOT, 'apps/cloudflare-gateway/.dev.vars');
const env = {};
if (fs.existsSync(devVars)) {
  for (const line of fs.readFileSync(devVars, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
if (env.ENVIRONMENT && env.ENVIRONMENT !== 'development') {
  console.error(`refusing to start: .dev.vars ENVIRONMENT=${env.ENVIRONMENT} (expected development)`);
  process.exit(1);
}

const { worker, env: workerEnv, ctx } = await createGateway({ env, seedFiles: ['migrations/dev/seed_local_dev.sql'] });

http.createServer(async (req, res) => {
  try {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const body = chunks.length ? Buffer.concat(chunks) : undefined;
    const headers = new Headers();
    for (const [k, v] of Object.entries(req.headers)) if (v !== undefined) headers.set(k, Array.isArray(v) ? v.join(', ') : v);
    const request = new Request(`http://${req.headers.host || `127.0.0.1:${port}`}${req.url}`, {
      method: req.method,
      headers,
      body: req.method === 'GET' || req.method === 'HEAD' ? undefined : body
    });
    const out = await worker.fetch(request, workerEnv, ctx);
    const outHeaders = {};
    out.headers.forEach((v, k) => { outHeaders[k] = v; });
    res.writeHead(out.status, outHeaders);
    res.end(Buffer.from(await out.arrayBuffer()));
    console.log(`${out.status} ${req.method} ${req.url}`);
  } catch (e) {
    console.error(`500 ${req.method} ${req.url} ${e?.stack || e}`);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: false, error: 'LOCAL_SERVER_ERROR' }));
  }
}).listen(port, '127.0.0.1', () => console.log(`local API (in-memory D1, dev seed) listening on http://127.0.0.1:${port}`));
