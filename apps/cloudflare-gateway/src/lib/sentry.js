// apps/cloudflare-gateway/src/lib/sentry.js
// NEW-18: server-side error reporting to Sentry via the envelope API (no SDK).
// Only unexpected errors (the 500 INTERNAL_ERROR path) are reported — business
// outcomes (HttpError 4xx/503) are not noise for the on-call channel.
// Privacy: only method + pathname are shipped; no query string, headers,
// cookies, or request body. Messages/stacks are truncated to 4 KB.
// Without a parseable SENTRY_DSN this is a silent no-op and never throws.

const SENTRY_CLIENT = 'olmoa-gateway/1.0';
const MAX_TEXT = 4096;

/** Parse `https://{publicKey}@{host}/{projectId}`. Returns null when unusable. */
export function parseDsn(dsn) {
  try {
    const u = new URL(String(dsn || ''));
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    const publicKey = u.username;
    const projectId = u.pathname.replace(/^\/+|\/+$/g, '');
    if (!publicKey || !u.hostname || !projectId || projectId.includes('/')) return null;
    return { origin: `${u.protocol}//${u.host}`, projectId, publicKey };
  } catch {
    return null;
  }
}

const trunc = (s) => String(s || '').slice(0, MAX_TEXT);

function stackFrames(stack) {
  // V8 frames ("    at fn (file:line:col)") become Sentry frames, innermost last.
  const frames = [];
  for (const line of trunc(stack).split('\n').slice(0, 30)) {
    const m = line.match(/^\s*at\s+(?:(.*?)\s+\()?(.+?):(\d+):(\d+)\)?$/);
    if (m) frames.push({ function: m[1] || '<anonymous>', filename: m[2], lineno: Number(m[3]), colno: Number(m[4]) });
  }
  return frames.reverse();
}

export function buildEnvelope({ dsn, error, request, requestId, env }) {
  const parsed = parseDsn(dsn);
  if (!parsed) return null;
  const eventId = (globalThis.crypto && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`).replace(/-/g, '');
  const method = request ? request.method : 'UNKNOWN';
  let pathname = 'unknown';
  try { pathname = new URL(request.url).pathname; } catch { /* keep 'unknown' */ }
  const event = {
    event_id: eventId,
    timestamp: Math.floor(Date.now() / 1000),
    level: 'error',
    logger: 'olmoa-gateway',
    platform: 'javascript',
    environment: (env && env.ENVIRONMENT) || 'unset',
    release: (env && env.GIT_COMMIT) || 'unset',
    server_name: 'olmoa-api',
    request: { method, url: pathname },
    tags: { request_id: requestId || 'unknown' },
    exception: { values: [{ type: (error && error.name) || 'Error', value: trunc(error && error.message), stacktrace: { frames: stackFrames(error && error.stack) } }] }
  };
  const header = JSON.stringify({ event_id: eventId, sent_at: new Date().toISOString() });
  const itemHeader = JSON.stringify({ type: 'event' });
  return {
    url: `${parsed.origin}/api/${parsed.projectId}/envelope/`,
    headers: {
      'Content-Type': 'application/x-sentry-envelope',
      'X-Sentry-Auth': `Sentry sentry_version=7, sentry_client=${SENTRY_CLIENT}, sentry_key=${parsed.publicKey}`
    },
    body: `${header}\n${itemHeader}\n${JSON.stringify(event)}`
  };
}

/**
 * Fire-and-forget an unexpected error to Sentry. Resolves true when a report
 * was attempted, false when skipped (no DSN). Uses ctx.waitUntil when present
 * so the Worker is not held; never rejects.
 */
export function reportError(env, { error, request, requestId, ctx } = {}) {
  const envelope = buildEnvelope({ dsn: env && env.SENTRY_DSN, error, request, requestId, env });
  if (!envelope) return Promise.resolve(false);
  const send = fetch(envelope.url, { method: 'POST', headers: envelope.headers, body: envelope.body })
    .then(() => true, () => false);
  try {
    if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(send);
  } catch { /* a broken ctx must not break the error path */ }
  return send.catch(() => false);
}
