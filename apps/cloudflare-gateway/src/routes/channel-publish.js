// apps/cloudflare-gateway/src/routes/channel-publish.js
// Phase 2 distribution endpoints: elite shortlist + guarded channel publish.
// Publish requires APPROVED offer + margin >= 15% + own-mall product carrying
// a notice template + live adapter success. Without channel keys the publish
// fails closed (503) — a listing is never marked LIVE on a failed call.

import '../services/channels/smartstore-adapter.js';
import '../services/channels/coupang-adapter.js';
import { getChannel, ChannelConfigError } from '../services/channels/channel.js';
import { selectEliteCandidates, quoteMarginBps, ELITE_MIN_MARGIN_BPS } from '../services/channels/elite.js';
import { requireAdmin } from '../lib/auth.js';
import { json, readJson, bad, notFound, unavailable } from '../lib/http.js';
import { newId } from '../lib/ids.js';

function channelParam(url) {
  const ch = String(url.searchParams.get('channel') || '').trim();
  try {
    getChannel(ch);
  } catch {
    throw bad('CHANNEL_UNKNOWN', '알 수 없는 채널입니다 (smartstore/coupang).');
  }
  return ch;
}

export async function handleChannelPublishRoutes(request, url, env, corsHeaders) {
  const p = url.pathname;
  if (!p.startsWith('/api/v1/admin/channels')) return null;
  await requireAdmin(request, env);

  if (p === '/api/v1/admin/channels/elite' && request.method === 'GET') {
    const channel = channelParam(url);
    const limit = Number.parseInt(url.searchParams.get('limit') || '50', 10);
    const candidates = await selectEliteCandidates(env, channel, { limit });
    return json(corsHeaders, { success: true, channel, min_margin_bps: ELITE_MIN_MARGIN_BPS, count: candidates.length, data: candidates });
  }

  if (p === '/api/v1/admin/channels/publish' && request.method === 'POST') {
    const body = await readJson(request);
    const channel = String(body.channel || '');
    let adapter;
    try {
      adapter = getChannel(channel);
    } catch {
      throw bad('CHANNEL_UNKNOWN', '알 수 없는 채널입니다 (smartstore/coupang).');
    }
    const offer = await env.DB.prepare('SELECT * FROM sourcing_offers WHERE id = ?').bind(String(body.offer_id || '')).first();
    if (!offer) throw notFound('소싱 상품을 찾을 수 없습니다.');
    if (offer.status !== 'APPROVED') throw bad('OFFER_NOT_APPROVED', '승인(APPROVED) 상태의 상품만 배포할 수 있습니다.');
    const product = await env.DB.prepare('SELECT * FROM products WHERE id = ?').bind(String(body.product_id || '')).first();
    if (!product || product.status !== 'ACTIVE') throw bad('PRODUCT_NOT_ACTIVE', '판매중 자사몰 상품을 연결해야 합니다.');
    if (!product.notice_template_id) throw bad('NOTICE_MISSING', '상품정보제공고시가 등록된 상품만 채널에 배포할 수 있습니다.');
    const bps = quoteMarginBps(offer.cost_krw, offer.channel_quotes_json, channel);
    if (bps === null) throw bad('QUOTES_MISSING', '채널 견적을 먼저 생성하세요.');
    if (bps < ELITE_MIN_MARGIN_BPS) throw bad('MARGIN_BELOW_ELITE', '마진 15% 미만 상품은 정예선별에서 제외됩니다.');
    let external;
    try {
      external = await adapter.publish(env, {
        title: offer.title, cost_krw: offer.cost_krw, stock_qty: offer.stock_qty,
        product_id: product.id, notice_template_id: product.notice_template_id
      });
    } catch (e) {
      if (e instanceof ChannelConfigError) {
        return json(corsHeaders, { success: false, code: 'CHANNEL_NOT_CONFIGURED', error: `채널 연동 키가 설정되지 않았습니다 (${channel}).` }, 503);
      }
      throw unavailable('UPSTREAM_ERROR', '채널 등록에 실패했습니다.');
    }
    const id = newId('chl');
    await env.DB.prepare(
      `INSERT INTO sourcing_channel_listings (id, offer_id, product_id, channel, external_listing_id, status, margin_bps)
       VALUES (?, ?, ?, ?, ?, 'LIVE', ?)
       ON CONFLICT (channel, offer_id) DO UPDATE SET product_id = excluded.product_id,
         external_listing_id = excluded.external_listing_id, status = 'LIVE',
         margin_bps = excluded.margin_bps, updated_at = CURRENT_TIMESTAMP`
    ).bind(id, offer.id, product.id, channel, external.externalId, bps).run();
    return json(corsHeaders, { success: true, listing_id: id, channel, external_listing_id: external.externalId, margin_bps: bps });
  }

  return null;
}
