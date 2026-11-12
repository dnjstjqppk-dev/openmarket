// apps/cloudflare-gateway/src/routes/push.js
// Push notification API: device-token registry (customer + partner apps),
// admin broadcast, and operational stats. Sending runs through
// services/push.js (FCM HTTP v1, fail-closed without credentials).

import { requireAuth, requireAdmin } from '../lib/auth.js';
import { json, readJson, bad, str } from '../lib/http.js';
import { registerPushToken, unregisterPushToken, broadcastPush, PUSH_APPS, PUSH_BROADCAST_CAP } from '../services/push.js';
import { fcmConfigured } from '../lib/fcm.js';

const ROLE_APP = { ROLE_CUSTOMER: 'CUSTOMER', ROLE_PARTNER: 'PARTNER' };

export async function handlePushRoutes(request, url, env, corsHeaders) {
  const p = url.pathname;
  if (!p.startsWith('/api/v1/push/') && !p.startsWith('/api/v1/admin/push/')) return null;

  if (p === '/api/v1/push/tokens' && request.method === 'POST') {
    const me = await requireAuth(request, env, ['ROLE_CUSTOMER', 'ROLE_PARTNER']);
    const b = await readJson(request);
    const derived = ROLE_APP[me.role];
    const app = b.app !== undefined && b.app !== null ? String(b.app).toUpperCase() : derived;
    if (app !== derived) throw bad('APP_ROLE_MISMATCH', '앱 구분이 로그인한 계정과 일치하지 않습니다.');
    const platform = String(b.platform || '').toUpperCase();
    const r = await registerPushToken(env, { userId: me.userId, app, platform, token: b.token });
    return json(corsHeaders, { success: true, token_id: r.id, created: r.created }, r.created ? 201 : 200);
  }

  if (p === '/api/v1/push/tokens' && request.method === 'DELETE') {
    const me = await requireAuth(request, env, ['ROLE_CUSTOMER', 'ROLE_PARTNER']);
    const b = await readJson(request);
    const r = await unregisterPushToken(env, { userId: me.userId, token: b.token });
    return json(corsHeaders, { success: true, deleted: r.deleted });
  }

  if (p === '/api/v1/admin/push/broadcast' && request.method === 'POST') {
    await requireAdmin(request, env);
    const b = await readJson(request);
    const title = str(b.title, { field: '제목', max: 200, required: true });
    const body = str(b.body, { field: '내용', max: 1000, required: true });
    const app = b.app !== undefined && b.app !== null ? String(b.app).toUpperCase() : null;
    if (app !== null && !PUSH_APPS.includes(app)) throw bad('INVALID_APP', 'app은 CUSTOMER 또는 PARTNER입니다.');
    const r = await broadcastPush(env, { title, body, app, limit: b.limit });
    return json(corsHeaders, { success: true, ...r, data: r });
  }

  if (p === '/api/v1/admin/push/stats' && request.method === 'GET') {
    await requireAdmin(request, env);
    const { results } = await env.DB.prepare(
      'SELECT app, platform, COUNT(*) AS c FROM push_device_tokens GROUP BY app, platform'
    ).all();
    const data = { CUSTOMER: {}, PARTNER: {}, total: 0 };
    for (const row of results) {
      if (!data[row.app]) data[row.app] = {};
      data[row.app][row.platform] = Number(row.c) || 0;
      data.total += Number(row.c) || 0;
    }
    return json(corsHeaders, { success: true, data, fcm_configured: fcmConfigured(env) });
  }

  return null;
}

export { PUSH_BROADCAST_CAP };
