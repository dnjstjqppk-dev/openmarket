// apps/cloudflare-gateway/src/routes/seo-ops.js
// Phase 4-6 SEO ops: IndexNow URL enqueue, the queue status log and manual
// drain. Admin only; drain without INDEXNOW_KEY reports degraded and leaves
// every row PENDING (fail-closed, nothing invented).

import { requireAdmin } from '../lib/auth.js';
import { json, readJson, bad } from '../lib/http.js';
import { enqueueUrls, listQueue, drainQueue } from '../services/seo/indexnow.js';

const STATUSES = ['PENDING', 'SENT', 'FAILED'];

export async function handleSeoOpsRoutes(request, url, env, corsHeaders) {
  const p = url.pathname;
  if (!p.startsWith('/api/v1/admin/seo')) return null;
  await requireAdmin(request, env);

  if (p === '/api/v1/admin/seo/indexnow/enqueue' && request.method === 'POST') {
    const body = await readJson(request);
    if (!Array.isArray(body.urls)) throw bad('URLS_REQUIRED', 'urls 배열이 필요합니다.');
    try {
      const r = await enqueueUrls(env, body.urls);
      return json(corsHeaders, { success: true, queued: r.queued });
    } catch (e) {
      throw bad(String((e && e.code) || 'INVALID_URL'), '수집 가능한 URL이 아닙니다.');
    }
  }

  if (p === '/api/v1/admin/seo/indexnow/status' && request.method === 'GET') {
    const { results } = await env.DB.prepare(
      'SELECT status, COUNT(*) AS c FROM indexnow_queue GROUP BY status').all();
    const counts = { PENDING: 0, SENT: 0, FAILED: 0 };
    for (const r of results || []) counts[r.status] = Number(r.c) || 0;
    return json(corsHeaders, {
      success: true, key_configured: Boolean(String(env.INDEXNOW_KEY || '')), ...counts
    });
  }

  if (p === '/api/v1/admin/seo/indexnow/queue' && request.method === 'GET') {
    const status = String(url.searchParams.get('status') || '').toUpperCase();
    if (status && !STATUSES.includes(status)) throw bad('INVALID_STATUS', '유효하지 않은 상태입니다.');
    const data = await listQueue(env, { status, limit: url.searchParams.get('limit') });
    return json(corsHeaders, { success: true, data });
  }

  if (p === '/api/v1/admin/seo/indexnow/drain' && request.method === 'POST') {
    const body = await readJson(request);
    const r = await drainQueue(env, { limit: Number(body.limit) || 100 });
    return json(corsHeaders, { success: true, ...r });
  }

  return null;
}
