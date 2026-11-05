// apps/cloudflare-gateway/src/routes/feature-flags.js
// Feature Flags Management API for Admin Console.
// Allows granular ON/OFF control of Crawlers, 3PL, AI Translation, Auto-publish, and Sync engines.

import { requireAdmin, requireAuth } from '../lib/auth.js';
import { json, readJson, bad, notFound } from '../lib/http.js';
import { listFeatureFlags, getFeatureFlag, toggleFeatureFlag } from '../services/feature-flags.js';

export async function handleFeatureFlagRoutes(request, url, env, corsHeaders) {
  const p = url.pathname;
  if (!p.startsWith('/api/v1/admin/feature-flags') && !p.startsWith('/api/v1/feature-flags')) return null;

  // 1. List All Feature Flags (GET /api/v1/admin/feature-flags)
  if (p === '/api/v1/admin/feature-flags' && request.method === 'GET') {
    await requireAdmin(request, env);
    const flags = await listFeatureFlags(env);

    return json(corsHeaders, {
      success: true,
      count: flags.length,
      data: flags
    });
  }

  // 2. Toggle Feature Flag (POST /api/v1/admin/feature-flags/:key/toggle)
  const toggleM = p.match(/^\/api\/v1\/admin\/feature-flags\/([^/]+)\/toggle$/);
  if (toggleM && request.method === 'POST') {
    const caller = await requireAdmin(request, env);
    const body = await readJson(request);

    const key = toggleM[1];
    if (body.is_enabled === undefined) throw bad('IS_ENABLED_REQUIRED', 'is_enabled (true/false) 값을 지정해 주세요.');

    const reason = String(body.reason || '운영자 수동 제어').trim();
    const ipAddress = request.headers.get('CF-Connecting-IP') || '127.0.0.1';

    const result = await toggleFeatureFlag(
      env,
      key,
      Boolean(body.is_enabled),
      caller.userId,
      reason,
      ipAddress
    );

    return json(corsHeaders, {
      success: true,
      message: `기능 플래그 [${result.flag?.name || key}]의 상태가 ${result.current_state ? '활성화(ON)' : '비활성화(OFF)'}되었습니다.`,
      data: result
    });
  }

  // 3. Public / Partner Feature Capabilities Summary (GET /api/v1/feature-flags/public)
  if (p === '/api/v1/feature-flags/public' && request.method === 'GET') {
    const flags = await listFeatureFlags(env);
    const statusMap = {};
    for (const f of flags) {
      statusMap[f.key] = {
        name: f.name,
        is_enabled: f.is_enabled === 1,
        requires_credential: f.requires_credential === 1,
        credential_configured: f.credential_configured === 1
      };
    }

    return json(corsHeaders, {
      success: true,
      features: statusMap
    });
  }

  return null;
}
