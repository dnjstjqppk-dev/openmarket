// apps/cloudflare-gateway/src/routes/client-errors.js
// Dependency-free client error telemetry. The SPAs report window.onerror /
// unhandledrejection here (see apps/*/src/main.ts); events are written to the
// Worker log stream (Cloudflare Logs) and never to the database, so no PII is
// retained. Public by design (errors happen before login); RL_API + a tiny
// payload cap bound abuse.

import { json, readJson, str } from '../lib/http.js';

const APPS = ['storefront', 'partner', 'admin'];

export async function handleClientErrorRoutes(request, url, env, corsHeaders) {
  if (url.pathname !== '/api/v1/client-errors') return null;
  if (request.method !== 'POST') return json(corsHeaders, { success: false, error: 'Method Not Allowed', code: 'METHOD_NOT_ALLOWED' }, 405);
  const body = await readJson(request, { maxBytes: 4096 });
  const app = str(body.app, { max: 20 });
  const kind = str(body.kind, { max: 60 });
  const message = str(body.message, { max: 500, required: true });
  const page = str(body.url, { max: 200 });
  console.error(JSON.stringify({
    level: 'error',
    source: 'client',
    app: APPS.includes(app) ? app : 'unknown',
    kind: kind || 'unknown',
    message,
    page: page || null,
    environment: env.ENVIRONMENT || 'unset'
  }));
  return new Response(null, { status: 204, headers: corsHeaders });
}
