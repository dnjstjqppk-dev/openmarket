// apps/cloudflare-gateway/src/routes/multichannel.js
// Multi-channel listing / external order / B2B PO / 3PL API.
//
// Honesty contract: no connector performs a real platform call yet (services/connectors/simulation.js), so
//   * in production every action that would reach an external platform answers 501 CONNECTOR_NOT_INTEGRATED;
//   * in development with CONNECTOR_SIMULATION=true it runs the canned flow and says `simulated: true`;
//   * credentials are never reported as VERIFIED without a real call, and webhooks are refused until a
//     per-platform signature verifier exists (nothing unauthenticated is written to the database).
// Sellers act only on their own products / channel orders. Credentials are sealed (AES-GCM) at rest.

import { requireApprovedPartner } from '../lib/auth.js';
import { krwPerUnitMap } from '../lib/fx.js';
import { json, readJson, bad, notFound, conflict, HttpError, str } from '../lib/http.js';
import { newId } from '../lib/ids.js';
import { sealSecret, openSecret } from '../lib/totp.js';
import { assertFeatureEnabled } from '../services/feature-flags.js';
import { registry } from '../services/connectors/connector-registry.js';
import { assertConnectorUsable } from '../services/connectors/simulation.js';
import { calculateGlobalPrice } from '../services/pricing/global-pricing-engine.js';

const TRACKING_RE = /^[A-Za-z0-9-]{6,40}$/;

function maskKey(k) {
  return k.length > 8 ? `${k.slice(0, 4)}...${k.slice(-4)}` : '****';
}

/** Decrypted credential bundle for a connector call (never returned to clients). */
async function connectorCredentials(env, cred) {
  if (!cred) return {};
  let sealed = {};
  try { sealed = JSON.parse(await openSecret(env, cred.secret_key_enc)); } catch { sealed = {}; }
  const apiKey = sealed.api_key || null;
  const secretKey = sealed.secret_key || null;
  return {
    apiKey, accessKey: apiKey, openApiKey: apiKey, secretKey, clientSecret: secretKey,
    vendorId: cred.seller_account_id, sellerAccountId: cred.seller_account_id, clientId: cred.seller_account_id || apiKey,
    isSandbox: cred.is_sandbox === 1
  };
}

const posInt = (v, field) => {
  const n = Number(v);
  if (!Number.isSafeInteger(n) || n <= 0) throw bad('INVALID_NUMBER', `${field}은(는) 1 이상의 정수여야 합니다.`);
  return n;
};

export async function handleMultiChannelRoutes(request, url, env, corsHeaders) {
  const p = url.pathname;
  if (!p.startsWith('/api/v1/channels')) return null;

  // 1. Platform directory (static reference data)
  if (p === '/api/v1/channels/platforms' && request.method === 'GET') {
    const { results: platforms } = await env.DB.prepare(`
      SELECT p.*, (SELECT COUNT(*) FROM sales_channels sc WHERE sc.platform_id = p.id) AS channel_count
      FROM commerce_platforms p ORDER BY p.platform_type ASC, p.name ASC
    `).all();
    const data = platforms.map((pl) => ({ ...pl, api_integrated: registry.get(pl.id).isLive === true }));
    return json(corsHeaders, { success: true, count: data.length, data });
  }

  // 2. Sales channels (static reference data)
  if (p === '/api/v1/channels/sales-channels' && request.method === 'GET') {
    const { results: channels } = await env.DB.prepare(`
      SELECT sc.*, p.name AS platform_name, p.country_code, p.auth_type
      FROM sales_channels sc JOIN commerce_platforms p ON p.id = sc.platform_id
      WHERE sc.is_active = 1 ORDER BY sc.commission_bps ASC
    `).all();
    return json(corsHeaders, { success: true, count: channels.length, data: channels });
  }

  // 3. Seller platform credentials
  if (p === '/api/v1/channels/credentials' && request.method === 'GET') {
    const caller = await requireApprovedPartner(request, env);
    const { results: creds } = await env.DB.prepare(`
      SELECT c.id, c.platform_id, c.credential_name, c.api_key_masked, c.seller_account_id, c.is_sandbox, c.status, c.last_verified_at,
             p.name AS platform_name, p.auth_type
      FROM platform_credentials c JOIN commerce_platforms p ON p.id = c.platform_id
      WHERE c.partner_id = ? ORDER BY c.created_at DESC
    `).bind(caller.partner.id).all();
    return json(corsHeaders, { success: true, count: creds.length, data: creds });
  }

  if (p === '/api/v1/channels/credentials' && request.method === 'POST') {
    const caller = await requireApprovedPartner(request, env);
    const body = await readJson(request);
    const platformId = str(body.platform_id, { field: 'platform_id', max: 80, required: true });
    const credName = str(body.credential_name, { max: 100 }) || '기본 계정';
    const apiKey = str(body.api_key, { field: 'api_key', max: 500, required: true });
    const secretKey = str(body.secret_key, { max: 2000 });
    const sellerAccountId = str(body.seller_account_id, { max: 120 });
    const isSandbox = body.is_sandbox ? 1 : 0;

    const platform = await env.DB.prepare('SELECT * FROM commerce_platforms WHERE id = ?').bind(platformId).first();
    if (!platform) throw notFound('등록되지 않은 커머스 플랫폼입니다.');

    const sealed = await sealSecret(env, JSON.stringify({ api_key: apiKey, secret_key: secretKey || null }));
    await env.DB.prepare(`
      INSERT INTO platform_credentials (id, partner_id, platform_id, credential_name, api_key_masked, secret_key_enc, seller_account_id, is_sandbox, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'CONFIGURED')
      ON CONFLICT(partner_id, platform_id, is_sandbox) DO UPDATE SET
        credential_name = excluded.credential_name, api_key_masked = excluded.api_key_masked, secret_key_enc = excluded.secret_key_enc,
        seller_account_id = excluded.seller_account_id, status = 'CONFIGURED', last_verified_at = NULL, updated_at = CURRENT_TIMESTAMP
    `).bind(newId('cred'), caller.partner.id, platformId, credName, maskKey(apiKey), sealed, sellerAccountId || null, isSandbox).run();

    return json(corsHeaders, {
      success: true,
      message: `[${platform.name}] API 인증정보를 암호화해 저장했습니다. 실제 연동 전이므로 검증은 되지 않은 상태입니다.`
    }, 201);
  }

  // 4. Verify a credential — only a live connector may mark it VERIFIED.
  const verifyM = p.match(/^\/api\/v1\/channels\/credentials\/([^/]+)\/verify$/);
  if (verifyM && request.method === 'POST') {
    const caller = await requireApprovedPartner(request, env);
    const cred = await env.DB.prepare('SELECT * FROM platform_credentials WHERE id = ? AND partner_id = ?').bind(verifyM[1], caller.partner.id).first();
    if (!cred) throw notFound('자격증명을 찾을 수 없습니다.');
    const connector = registry.get(cred.platform_id);
    if (connector.isLive !== true) {
      return json(corsHeaders, {
        success: true, verified: false, status: cred.status, simulated: false,
        message: `[${connector.platformName}] 실제 API 연동이 구현되지 않아 인증정보를 검증하지 않았습니다.`
      });
    }
    const result = await connector.verifyConnection(await connectorCredentials(env, cred));
    const newStatus = result.verified ? 'VERIFIED' : 'BLOCKED_INVALID';
    await env.DB.prepare('UPDATE platform_credentials SET status = ?, last_verified_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .bind(newStatus, cred.id).run();
    return json(corsHeaders, { success: true, verified: Boolean(result.verified), status: newStatus, message: result.message });
  }

  // 5. Price calculator (pure computation, no side effects)
  if (p === '/api/v1/channels/pricing/calculate' && request.method === 'POST') {
    const body = await readJson(request);
    const result = calculateGlobalPrice({
      wholesaleCost: posInt(body.wholesale_cost, '공급원가'),
      currency: body.currency || 'KRW',
      targetMarginRateBps: body.target_margin_bps ?? 2000,
      channelCode: body.channel_code || 'NAVER_SMARTSTORE',
      weightKg: body.weight_kg ?? 0.5,
      isCrossborder: Boolean(body.is_crossborder),
      originCountry: body.origin_country || 'CN',
      minMarginKrw: body.min_margin_krw ?? 3000,
      roundingUnit: body.rounding_unit || 100,
      fxRatesToKrw: await krwPerUnitMap(env)
    });
    return json(corsHeaders, { success: true, data: result });
  }

  // 6. Publish one of the seller's own products to an external channel
  if (p === '/api/v1/channels/listings/publish' && request.method === 'POST') {
    const caller = await requireApprovedPartner(request, env);
    await assertFeatureEnabled(env, 'marketplace_listing_publish');
    const body = await readJson(request);
    const productId = str(body.product_id, { field: 'product_id', max: 80, required: true });
    const salesChannelId = str(body.sales_channel_id, { field: 'sales_channel_id', max: 80, required: true });

    const prod = await env.DB.prepare('SELECT * FROM products WHERE id = ? AND partner_id = ?').bind(productId, caller.partner.id).first();
    if (!prod) throw notFound('상품을 찾을 수 없습니다.');
    if (prod.status !== 'ACTIVE') throw conflict('PRODUCT_NOT_ACTIVE', `심사 승인(판매중) 상품만 외부 채널에 등록할 수 있습니다. (현재: ${prod.status})`);

    const channel = await env.DB.prepare(`
      SELECT sc.*, p.id AS platform_id, p.name AS platform_name FROM sales_channels sc JOIN commerce_platforms p ON p.id = sc.platform_id WHERE sc.id = ?
    `).bind(salesChannelId).first();
    if (!channel) throw notFound('판매 채널을 찾을 수 없습니다.');

    const connector = registry.get(channel.platform_id);
    const { simulated } = assertConnectorUsable(env, connector, '외부 상품 등록');
    const cred = await env.DB.prepare('SELECT * FROM platform_credentials WHERE partner_id = ? AND platform_id = ?').bind(caller.partner.id, channel.platform_id).first();
    if (!cred) throw conflict('CREDENTIAL_REQUIRED', `[${channel.platform_name}] API 인증정보를 먼저 등록해 주세요.`);

    // Real stock only — an external channel must never be offered more than OLMOA holds.
    const stock = Number(await env.DB.prepare('SELECT COALESCE(SUM(stock_quantity),0) AS s FROM product_skus WHERE product_id = ?').bind(prod.id).first('s')) || 0;
    const salePrice = body.sale_price !== undefined ? posInt(body.sale_price, '채널 판매가') : prod.lowest_sale_price;
    const origPrice = body.original_price !== undefined ? posInt(body.original_price, '채널 정가') : prod.lowest_original_price;

    const listingRes = await connector.createListing({
      title: prod.title, description_html: prod.description_html, channel_sale_price: salePrice, channel_original_price: origPrice, stock_quantity: stock
    }, await connectorCredentials(env, cred));

    // A simulated publish never claims the product is live on the channel.
    const listingStatus = simulated ? 'DRAFT' : (listingRes.success ? (listingRes.status || 'PENDING_REVIEW') : 'SYNC_FAILED');
    const listingId = newId('lst');
    await env.DB.prepare(`
      INSERT INTO channel_listings (id, partner_id, sales_channel_id, product_id, external_product_id, external_url, listing_title,
                                    channel_sale_price, channel_original_price, currency, stock_allocated, status, last_synced_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(sales_channel_id, product_id) DO UPDATE SET
        external_product_id = excluded.external_product_id, external_url = excluded.external_url, channel_sale_price = excluded.channel_sale_price,
        stock_allocated = excluded.stock_allocated, status = excluded.status, last_synced_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
    `).bind(listingId, caller.partner.id, salesChannelId, prod.id,
      simulated ? null : (listingRes.external_product_id || null), simulated ? null : (listingRes.channel_url || null),
      prod.title, salePrice, origPrice, channel.currency, stock, listingStatus).run();

    return json(corsHeaders, {
      success: simulated ? true : Boolean(listingRes.success),
      simulated,
      status: listingStatus,
      listing_id: listingId,
      external_product_id: simulated ? null : listingRes.external_product_id,
      channel_name: channel.channel_name,
      message: simulated ? `[시뮬레이션] ${channel.channel_name}에는 실제로 등록되지 않았습니다.` : (listingRes.message || null)
    });
  }

  // 7. Seller's listings
  if (p === '/api/v1/channels/listings' && request.method === 'GET') {
    const caller = await requireApprovedPartner(request, env);
    const { results } = await env.DB.prepare(`
      SELECT l.*, sc.channel_name, p.title AS product_title, p.thumbnail_url
      FROM channel_listings l JOIN sales_channels sc ON sc.id = l.sales_channel_id JOIN products p ON p.id = l.product_id
      WHERE l.partner_id = ? ORDER BY l.created_at DESC LIMIT 100
    `).bind(caller.partner.id).all();
    return json(corsHeaders, { success: true, count: results.length, data: results });
  }

  // 8. Collect external orders
  if (p === '/api/v1/channels/orders/sync' && request.method === 'POST') {
    const caller = await requireApprovedPartner(request, env);
    await assertFeatureEnabled(env, 'marketplace_order_sync');
    const body = await readJson(request);
    const salesChannelId = str(body.sales_channel_id, { field: 'sales_channel_id', max: 80, required: true });
    const channel = await env.DB.prepare(`
      SELECT sc.*, p.id AS platform_id, p.name AS platform_name FROM sales_channels sc JOIN commerce_platforms p ON p.id = sc.platform_id WHERE sc.id = ?
    `).bind(salesChannelId).first();
    if (!channel) throw notFound('판매 채널을 찾을 수 없습니다.');

    const connector = registry.get(channel.platform_id);
    const { simulated } = assertConnectorUsable(env, connector, '주문 수집');
    const cred = await env.DB.prepare('SELECT * FROM platform_credentials WHERE partner_id = ? AND platform_id = ?').bind(caller.partner.id, channel.platform_id).first();
    const creds = cred ? await connectorCredentials(env, cred) : {};
    const orderRes = await connector.getOrders({}, simulated ? { ...creds, isSandbox: true } : creds);

    let importedCount = 0;
    if (orderRes.success && Array.isArray(orderRes.orders)) {
      for (const ord of orderRes.orders) {
        const amount = Math.round(Number(ord.total_order_amount) || 0);
        const commission = Math.floor((amount * Number(channel.commission_bps || 0) + 5000) / 10000); // half-up, integer
        const externalId = simulated ? `SIM-${ord.external_order_id}` : ord.external_order_id;
        const chOrdId = newId('cord');
        const stmts = [env.DB.prepare(`
          INSERT INTO channel_orders (id, sales_channel_id, partner_id, external_order_id, external_order_no, buyer_name, recipient_name, recipient_phone_masked,
                                      shipping_address, customs_id_pccc, total_order_amount, channel_commission_amount, settlement_expected_amount, currency,
                                      order_status, raw_payload_json, collected_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'COLLECTED', ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
          ON CONFLICT(sales_channel_id, external_order_id) DO NOTHING
        `).bind(chOrdId, channel.id, caller.partner.id, externalId, ord.external_order_no, ord.buyer_name, ord.recipient_name, ord.recipient_phone,
          ord.shipping_address, ord.customs_id_pccc || null, amount, commission, amount - commission, ord.currency || 'KRW',
          JSON.stringify({ ...ord, simulated }))];
        for (const item of (ord.items || [])) {
          const qty = Math.max(1, Math.round(Number(item.quantity) || 1));
          const unit = Math.round(Number(item.unit_price) || 0);
          stmts.push(env.DB.prepare(`
            INSERT INTO channel_order_items (id, channel_order_id, external_sku_code, product_title, quantity, unit_price, total_price)
            SELECT ?, ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM channel_orders WHERE id = ?)
          `).bind(newId('citm'), chOrdId, item.external_sku_code || null, item.product_title, qty, unit, qty * unit, chOrdId));
        }
        const r = await env.DB.batch(stmts);
        if (r[0].meta.changes === 1) importedCount++;
      }
    }
    return json(corsHeaders, {
      success: true, simulated, channel_name: channel.channel_name, imported_orders_count: importedCount,
      message: simulated ? `[시뮬레이션] 가상 주문 ${importedCount}건이 생성되었습니다. 실제 채널 주문이 아닙니다.` : `[${channel.channel_name}] 신규 주문 ${importedCount}건 수집`
    });
  }

  // 9. Seller's external orders
  if (p === '/api/v1/channels/orders' && request.method === 'GET') {
    const caller = await requireApprovedPartner(request, env);
    const { results } = await env.DB.prepare(`
      SELECT o.*, sc.channel_name, sc.channel_code FROM channel_orders o JOIN sales_channels sc ON sc.id = o.sales_channel_id
      WHERE o.partner_id = ? ORDER BY o.collected_at DESC LIMIT 100
    `).bind(caller.partner.id).all();
    return json(corsHeaders, { success: true, count: results.length, data: results });
  }

  // 10. Place a B2B supplier PO for an external order — the supply cost is entered, never estimated.
  const poM = p.match(/^\/api\/v1\/channels\/orders\/([^/]+)\/dispatch-po$/);
  if (poM && request.method === 'POST') {
    const caller = await requireApprovedPartner(request, env);
    await assertFeatureEnabled(env, 'supplier_order_manual');
    const body = await readJson(request);
    const chOrder = await env.DB.prepare('SELECT * FROM channel_orders WHERE id = ? AND partner_id = ?').bind(poM[1], caller.partner.id).first();
    if (!chOrder) throw notFound('외부 채널 주문을 찾을 수 없습니다.');
    if (!['COLLECTED', 'CONFIRMED'].includes(chOrder.order_status)) {
      throw conflict('NOT_DISPATCHABLE', `발주할 수 없는 주문 상태입니다. (현재: ${chOrder.order_status})`);
    }
    const supplierId = str(body.supplier_id, { field: 'supplier_id', max: 80, required: true });
    const totalCost = posInt(body.total_cost_krw, '공급원가 합계');
    const connector = registry.get(supplierId);
    const { simulated } = assertConnectorUsable(env, connector, '공급사 발주');

    const poRes = await connector.createSupplierOrder({
      sub_order_id: chOrder.id, idempotency_key: `po_ext_${chOrder.id}`, total_cost_krw: totalCost,
      recipient_name: chOrder.recipient_name, recipient_phone: chOrder.recipient_phone_masked, shipping_address: chOrder.shipping_address
    }, { isSandbox: simulated });
    if (!poRes.success) throw bad('PO_DISPATCH_FAILED', poRes.error || poRes.message || '공급업체 발주 처리에 실패했습니다.');

    const r = await env.DB.prepare(`
      UPDATE channel_orders SET order_status = 'PO_DISPATCHED', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND order_status IN ('COLLECTED','CONFIRMED')
    `).bind(chOrder.id).run();
    if (r.meta.changes !== 1) throw conflict('ALREADY_DISPATCHED', '이미 공급업체에 발주된 주문입니다.');
    return json(corsHeaders, {
      success: true, simulated, b2b_order_id: simulated ? null : poRes.b2b_order_id, status: 'PO_DISPATCHED', total_cost_krw: totalCost,
      message: simulated ? '[시뮬레이션] 공급사에 실제 발주되지 않았습니다.' : poRes.message
    });
  }

  // 11. Register the real waybill for an external order and push it to the channel
  const fulM = p.match(/^\/api\/v1\/channels\/orders\/([^/]+)\/fulfill$/);
  if (fulM && request.method === 'POST') {
    const caller = await requireApprovedPartner(request, env);
    await assertFeatureEnabled(env, 'fulfillment_3pl');
    const body = await readJson(request);
    const chOrder = await env.DB.prepare(`
      SELECT o.*, sc.platform_id FROM channel_orders o JOIN sales_channels sc ON sc.id = o.sales_channel_id WHERE o.id = ? AND o.partner_id = ?
    `).bind(fulM[1], caller.partner.id).first();
    if (!chOrder) throw notFound('외부 채널 주문을 찾을 수 없습니다.');

    const logistics = registry.get('3pl_logistics');
    const carrier = logistics.carrierInfo(body.carrier_code || 'CJ_LOGISTICS');
    if (!carrier) throw bad('UNKNOWN_CARRIER', '지원하지 않는 택배사 코드입니다.');
    // The waybill number comes from the carrier; this system does not issue waybills.
    const trackingNumber = String(body.tracking_number || '').trim();
    if (!TRACKING_RE.test(trackingNumber)) throw bad('TRACKING_REQUIRED', '택배사에서 발급받은 운송장 번호를 입력해 주세요.');

    const marketConnector = registry.get(chOrder.platform_id);
    const { simulated } = assertConnectorUsable(env, marketConnector, '판매채널 송장 전송');
    const pushRes = await marketConnector.updateShipment({ external_order_id: chOrder.external_order_id, tracking_number: trackingNumber, carrier_code: carrier.code },
      { isSandbox: simulated });
    if (!simulated && !pushRes.success) throw bad('SHIPMENT_PUSH_FAILED', pushRes.message || '판매채널 송장 전송에 실패했습니다.');

    const r = await env.DB.prepare(`
      UPDATE channel_orders SET order_status = 'SHIPPED', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND order_status IN ('COLLECTED','CONFIRMED','PO_DISPATCHED')
    `).bind(chOrder.id).run();
    if (r.meta.changes !== 1) throw conflict('NOT_SHIPPABLE', `출고할 수 없는 주문 상태입니다. (현재: ${chOrder.order_status})`);
    return json(corsHeaders, {
      success: true, simulated, status: 'SHIPPED', tracking_number: trackingNumber, carrier_name: carrier.name,
      tracking_url: `${carrier.trackingUrl}${encodeURIComponent(trackingNumber)}`,
      message: simulated ? '[시뮬레이션] 판매채널에 송장이 실제로 전송되지 않았습니다.' : '판매채널 송장 연동 완료'
    });
  }

  // 12. Inbound platform webhooks: refused until a per-platform signature verifier exists.
  //     Nothing is written: an unauthenticated endpoint must not be able to fill the database or fake events.
  const hookM = p.match(/^\/api\/v1\/channels\/webhooks\/([^/]+)$/);
  if (hookM && request.method === 'POST') {
    throw new HttpError(501, 'WEBHOOK_NOT_INTEGRATED',
      `[${hookM[1].slice(0, 40)}] 웹훅 서명 검증이 구현되지 않아 수신하지 않습니다.`);
  }

  return null;
}
