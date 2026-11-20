// apps/cloudflare-gateway/src/routes/sourcing.js
// Phase 1 B2B sourcing endpoints: provider inventory + live pull.
// Fail closed without provider keys; upstream errors stay generic.

import '../services/sourcing/domeme-adapter.js';
import '../services/sourcing/ownerclan-adapter.js';
import '../services/sourcing/onchannel-adapter.js';
import '../services/sourcing/cj-adapter.js';
import { getProvider, listProviders, SourcingConfigError } from '../services/sourcing/provider.js';
import { normalizeOffer } from '../services/sourcing/normalize.js';
import { requireAdmin } from '../lib/auth.js';
import { json, readJson, bad, unavailable } from '../lib/http.js';

export async function handleSourcingRoutes(request, url, env, corsHeaders) {
  const p = url.pathname;
  if (!p.startsWith('/api/v1/admin/sourcing')) return null;
  await requireAdmin(request, env);

  if (p === '/api/v1/admin/sourcing/providers' && request.method === 'GET') {
    const providers = listProviders().map((name) => ({ name, ...getProvider(name).keyStatus(env) }));
    return json(corsHeaders, { success: true, providers });
  }

  if (p === '/api/v1/admin/sourcing/offers/pull' && request.method === 'POST') {
    const body = await readJson(request);
    let provider;
    try {
      provider = getProvider(String(body.provider || ''));
    } catch {
      throw bad('PROVIDER_UNKNOWN', '알 수 없는 공급사입니다.');
    }
    let live;
    try {
      live = await provider.fetchOffer(env, String(body.external_id || ''));
    } catch (e) {
      if (e instanceof SourcingConfigError) {
        return json(corsHeaders, {
          success: false, code: 'PROVIDER_NOT_CONFIGURED',
          error: `공급사 연동 키가 설정되지 않았습니다 (${e.provider}).`
        }, 503);
      }
      throw unavailable('UPSTREAM_ERROR', '공급사 조회에 실패했습니다.');
    }
    const row = normalizeOffer(live.provider, {
      externalId: live.externalId, title: body.title || live.raw?.title,
      costKrw: body.cost_krw ?? live.raw?.cost_krw, currency: body.currency || 'KRW',
      stockQty: body.stock_qty ?? live.raw?.stock_qty ?? 0
    });
    await env.DB.prepare(
      `INSERT INTO sourcing_offers (id, provider, external_id, title, cost_krw, currency, stock_qty, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'PENDING')
       ON CONFLICT (provider, external_id) DO UPDATE SET title = excluded.title,
         cost_krw = excluded.cost_krw, stock_qty = excluded.stock_qty, updated_at = CURRENT_TIMESTAMP`
    ).bind(row.id, row.provider, row.external_id, row.title, row.cost_krw, row.currency, row.stock_qty).run();
    return json(corsHeaders, { success: true, offer_id: row.id, status: 'PENDING' });
  }

  return null;
}
