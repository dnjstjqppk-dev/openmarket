// apps/cloudflare-gateway/src/routes/channels-ops.js
// Phase 2 channel ops: 30-day idle rotation batch + 15-minute delta sync.
// Admin-only manual triggers; the cron wiring calls the same service entry
// points. Both are idempotent and safe to re-run.

import '../services/channels/smartstore-adapter.js';
import '../services/channels/coupang-adapter.js';
import { runRotation, ROTATION_IDLE_DAYS } from '../services/channels/rotation.js';
import { runDeltaSync, DELTA_INTERVAL_MIN } from '../services/channels/delta.js';
import { listChannels, getChannel } from '../services/channels/channel.js';
import { requireAdmin } from '../lib/auth.js';
import { json, readJson, bad } from '../lib/http.js';

/** Optional caller batch bound; absent means the service default, garbage is 400. */
function batchLimit(raw, max) {
  if (raw === undefined || raw === null || raw === '') return undefined;
  const n = Number(raw);
  if (!Number.isSafeInteger(n) || n <= 0 || n > max) {
    throw bad('INVALID_LIMIT', `limit은 1~${max} 정수여야 합니다.`);
  }
  return n;
}

export async function handleChannelsOpsRoutes(request, url, env, corsHeaders) {
  const p = url.pathname;
  if (!p.startsWith('/api/v1/admin/channels')) return null;
  await requireAdmin(request, env);

  if (p === '/api/v1/admin/channels/rotation/run' && request.method === 'POST') {
    const body = await readJson(request);
    const result = await runRotation(env, {
      dryRun: body.dry_run === true, limit: batchLimit(body.limit, 1000)
    });
    return json(corsHeaders, {
      success: true, idle_days: ROTATION_IDLE_DAYS,
      scanned: result.scanned, rotated: result.rotated, ids: result.ids,
      cutoff: result.cutoff, dry_run: result.dry_run
    });
  }

  if (p === '/api/v1/admin/channels/delta/run' && request.method === 'POST') {
    const body = await readJson(request);
    const result = await runDeltaSync(env, { limit: batchLimit(body.limit, 500) });
    return json(corsHeaders, {
      success: true, window_min: DELTA_INTERVAL_MIN,
      checked: result.checked, synced: result.synced, failed: result.failed, cutoff: result.cutoff
    });
  }

  if (p === '/api/v1/admin/channels' && request.method === 'GET') {
    const channels = listChannels().map((name) => ({ name, ...getChannel(name).keyStatus(env) }));
    return json(corsHeaders, { success: true, channels });
  }

  return null;
}
