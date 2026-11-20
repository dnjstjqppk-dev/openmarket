// apps/cloudflare-gateway/src/routes/sourcing-ops.js
// Phase 1 sourcing ops: channel margin quotes + pre-checkout defense probe.
// Quote needs operator-entered policy; precheck enforces the 500ms budget.

import { getProvider } from '../services/sourcing/provider.js';
import { quoteChannelPrices, loadChannelPolicy, saveQuotes } from '../services/sourcing/margin.js';
import { preCheckoutGuard } from '../services/sourcing/precheckout.js';
import { requireAdmin } from '../lib/auth.js';
import { json, readJson, bad, notFound } from '../lib/http.js';
import { newId } from '../lib/ids.js';

async function loadOffer(env, id) {
  const offer = await env.DB.prepare('SELECT * FROM sourcing_offers WHERE id = ?').bind(id).first();
  if (!offer) throw notFound('소싱 상품을 찾을 수 없습니다.');
  return offer;
}

export async function handleSourcingOpsRoutes(request, url, env, corsHeaders) {
  const p = url.pathname;
  if (!p.startsWith('/api/v1/admin/sourcing/offers/')) return null;
  await requireAdmin(request, env);

  const quoteMatch = p.match(/^\/api\/v1\/admin\/sourcing\/offers\/([^/]+)\/quote$/);
  if (quoteMatch && request.method === 'POST') {
    const offer = await loadOffer(env, quoteMatch[1]);
    const policy = await loadChannelPolicy(env);
    let quotes;
    try {
      quotes = quoteChannelPrices(offer.cost_krw, policy);
    } catch (e) {
      if (String(e.message).startsWith('POLICY_MISSING')) {
        throw bad('POLICY_MISSING', '채널 마진 정책을 먼저 등록하세요.');
      }
      throw e;
    }
    await saveQuotes(env, offer.id, quotes);
    return json(corsHeaders, { success: true, offer_id: offer.id, quotes });
  }

  const preMatch = p.match(/^\/api\/v1\/admin\/sourcing\/offers\/([^/]+)\/precheck$/);
  if (preMatch && request.method === 'POST') {
    const body = await readJson(request);
    const offer = await loadOffer(env, preMatch[1]);
    const verdict = await preCheckoutGuard(getProvider(offer.provider), offer.external_id, Number(body.qty || 1), { env });
    await env.DB.prepare(
      'INSERT INTO sourcing_precheck_log (id, offer_id, decision, reason, stock_qty) VALUES (?, ?, ?, ?, ?)'
    ).bind(newId('pck'), offer.id, verdict.decision, verdict.reason, verdict.stockQty).run();
    return json(corsHeaders, { success: true, ...verdict });
  }

  return null;
}
