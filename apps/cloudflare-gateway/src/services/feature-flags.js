// apps/cloudflare-gateway/src/services/feature-flags.js
// Centralized Feature Flag Guard Engine & Audit Logger.
// Prevents unverified or risky external actions until approved and turned ON by Admin.

import { HttpError, notFound, bad } from '../lib/http.js';
import { newId } from '../lib/ids.js';

export async function getFeatureFlag(env, key) {
  if (!env || !env.DB) return null;
  return await env.DB.prepare('SELECT * FROM feature_flags WHERE key = ?').bind(key).first();
}

export async function isFeatureEnabled(env, key) {
  const flag = await getFeatureFlag(env, key);
  if (!flag) return false;
  return flag.is_enabled === 1;
}

export async function assertFeatureEnabled(env, key) {
  const flag = await getFeatureFlag(env, key);
  if (!flag) {
    throw notFound(`정의되지 않은 기능 플래그(${key})입니다.`);
  }

  if (flag.is_enabled !== 1) {
    throw new HttpError(
      403,
      'FEATURE_DISABLED',
      `해당 기능 [${flag.name || key}]은(는) 현재 운영 정책상 비활성화(OFF)되어 있습니다. 관리자 콘솔의 기능 설정(Feature Flags)에서 활성화 후 이용해 주세요.`
    );
  }

  return flag;
}

export async function listFeatureFlags(env) {
  const { results } = await env.DB.prepare(`
    SELECT * FROM feature_flags
    ORDER BY category ASC, risk_level DESC, key ASC
  `).all();
  return results || [];
}

export async function toggleFeatureFlag(env, key, isEnabled, actorUserId = null, reason = 'Admin Console Toggle', ipAddress = null) {
  const flag = await getFeatureFlag(env, key);
  if (!flag) throw notFound(`기능 플래그(${key})를 찾을 수 없습니다.`);

  const targetState = isEnabled ? 1 : 0;
  if (flag.is_enabled === targetState) {
    return { unchanged: true, flag };
  }

  // If feature requires external credential that is not configured, flag as warning
  if (targetState === 1 && flag.requires_credential === 1 && flag.credential_configured === 0) {
    // Allowed to toggle ON, but returns BLOCKED status advice
  }

  const logId = newId('fflog');
  await env.DB.batch([
    env.DB.prepare(`
      UPDATE feature_flags
      SET is_enabled = ?, updated_by = ?, updated_at = CURRENT_TIMESTAMP
      WHERE key = ?
    `).bind(targetState, actorUserId || 'SYSTEM_ADMIN', key),

    env.DB.prepare(`
      INSERT INTO feature_flag_audit_logs (
        id, flag_key, old_value, new_value, actor_user_id, reason, ip_address, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `).bind(logId, key, flag.is_enabled, targetState, actorUserId || 'SYSTEM_ADMIN', reason, ipAddress)
  ]);

  const updated = await getFeatureFlag(env, key);
  return {
    success: true,
    previous_state: flag.is_enabled === 1,
    current_state: updated.is_enabled === 1,
    flag: updated
  };
}
