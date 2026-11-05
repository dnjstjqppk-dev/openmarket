// apps/cloudflare-gateway/src/routes/multichannel.js
// Global Multi-Channel OpenMarket, B2B Supplier & 3PL Integration API Router.

import { requireAuth, requireAdmin, requireApprovedPartner } from '../lib/auth.js';
import { json, readJson, bad, notFound, forbidden, HttpError } from '../lib/http.js';
import { newId } from '../lib/ids.js';
import { assertFeatureEnabled } from '../services/feature-flags.js';
import { registry } from '../services/connectors/connector-registry.js';
import { calculateGlobalPrice } from '../services/pricing/global-pricing-engine.js';

export async function handleMultiChannelRoutes(request, url, env, corsHeaders) {
  const p = url.pathname;
  if (!p.startsWith('/api/v1/channels')) return null;

  // 1. List All Platforms & Capabilities (GET /api/v1/channels/platforms)
  if (p === '/api/v1/channels/platforms' && request.method === 'GET') {
    const { results: platforms } = await env.DB.prepare(`
      SELECT p.*,
             (SELECT COUNT(*) FROM sales_channels sc WHERE sc.platform_id = p.id) as channel_count
      FROM commerce_platforms p
      ORDER BY p.platform_type ASC, p.name ASC
    `).all();

    return json(corsHeaders, {
      success: true,
      count: platforms.length,
      data: platforms
    });
  }

  // 2. List Sales Channels (GET /api/v1/channels/sales-channels)
  if (p === '/api/v1/channels/sales-channels' && request.method === 'GET') {
    const { results: channels } = await env.DB.prepare(`
      SELECT sc.*, p.name as platform_name, p.country_code, p.auth_type
      FROM sales_channels sc
      JOIN commerce_platforms p ON p.id = sc.platform_id
      WHERE sc.is_active = 1
      ORDER BY sc.commission_bps ASC
    `).all();

    return json(corsHeaders, {
      success: true,
      count: channels.length,
      data: channels
    });
  }

  // 3. Partner Platform Credentials Management (GET & POST /api/v1/channels/credentials)
  if (p === '/api/v1/channels/credentials' && request.method === 'GET') {
    const caller = await requireApprovedPartner(request, env);
    const { results: creds } = await env.DB.prepare(`
      SELECT c.id, c.platform_id, c.credential_name, c.api_key_masked,
             c.seller_account_id, c.is_sandbox, c.status, c.last_verified_at,
             p.name as platform_name, p.auth_type
      FROM platform_credentials c
      JOIN commerce_platforms p ON p.id = c.platform_id
      WHERE c.partner_id = ?
      ORDER BY c.created_at DESC
    `).bind(caller.partner.id).all();

    return json(corsHeaders, {
      success: true,
      count: creds.length,
      data: creds
    });
  }

  if (p === '/api/v1/channels/credentials' && request.method === 'POST') {
    const caller = await requireApprovedPartner(request, env);
    const body = await readJson(request);

    const platformId = String(body.platform_id || '').trim();
    const credName = String(body.credential_name || '기본 계정').trim();
    const apiKey = String(body.api_key || '').trim();
    const secretKey = String(body.secret_key || '').trim();
    const sellerAccountId = String(body.seller_account_id || '').trim();
    const isSandbox = body.is_sandbox ? 1 : 0;

    if (!platformId || !apiKey) {
      throw bad('CREDENTIALS_REQUIRED', 'platform_id 와 api_key 는 필수입니다.');
    }

    const platform = await env.DB.prepare('SELECT * FROM commerce_platforms WHERE id = ?').bind(platformId).first();
    if (!platform) throw notFound('등록되지 않은 커머스 플랫폼입니다.');

    const credId = newId('cred');
    const maskedKey = apiKey.length > 8 ? `${apiKey.slice(0, 4)}...${apiKey.slice(-4)}` : '****';

    await env.DB.prepare(`
      INSERT INTO platform_credentials (
        id, partner_id, platform_id, credential_name, api_key_masked, secret_key_enc,
        seller_account_id, is_sandbox, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'CONFIGURED', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      ON CONFLICT(partner_id, platform_id, is_sandbox) DO UPDATE SET
        credential_name = excluded.credential_name,
        api_key_masked = excluded.api_key_masked,
        secret_key_enc = excluded.secret_key_enc,
        seller_account_id = excluded.seller_account_id,
        status = 'CONFIGURED',
        updated_at = CURRENT_TIMESTAMP
    `).bind(
      credId, caller.partner.id, platformId, credName, maskedKey, secretKey, sellerAccountId, isSandbox
    ).run();

    return json(corsHeaders, {
      success: true,
      message: `[${platform.name}] API 계정 자격증명이 등록되었습니다.`
    }, 201);
  }

  // 4. Verify Platform Connection (POST /api/v1/channels/credentials/:id/verify)
  const verifyM = p.match(/^\/api\/v1\/channels\/credentials\/([^/]+)\/verify$/);
  if (verifyM && request.method === 'POST') {
    const caller = await requireApprovedPartner(request, env);
    const cred = await env.DB.prepare(`
      SELECT * FROM platform_credentials WHERE id = ? AND partner_id = ?
    `).bind(verifyM[1], caller.partner.id).first();

    if (!cred) throw notFound('자격증명을 찾을 수 없습니다.');

    const connector = registry.get(cred.platform_id);
    const verifyResult = await connector.verifyConnection({
      apiKey: cred.api_key_masked,
      accessKey: cred.api_key_masked,
      openApiKey: cred.api_key_masked,
      secretKey: cred.secret_key_enc,
      secretKeyEnc: cred.secret_key_enc,
      vendorId: cred.seller_account_id,
      sellerAccountId: cred.seller_account_id,
      clientId: cred.seller_account_id || cred.api_key_masked,
      clientSecret: cred.secret_key_enc,
      refreshToken: cred.secret_key_enc,
      isSandbox: cred.is_sandbox === 1
    });

    const newStatus = verifyResult.verified ? 'VERIFIED' : 'BLOCKED_INVALID';
    await env.DB.prepare(`
      UPDATE platform_credentials
      SET status = ?, last_verified_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).bind(newStatus, cred.id).run();

    return json(corsHeaders, {
      success: true,
      verified: verifyResult.verified,
      status: newStatus,
      message: verifyResult.message,
      data: verifyResult
    });
  }

  // 5. Global Pricing & Margin Calculation Engine (POST /api/v1/channels/pricing/calculate)
  if (p === '/api/v1/channels/pricing/calculate' && request.method === 'POST') {
    const body = await readJson(request);
    const result = calculateGlobalPrice({
      wholesaleCost: body.wholesale_cost || 20000,
      currency: body.currency || 'KRW',
      targetMarginRateBps: body.target_margin_bps || 2000,
      channelCode: body.channel_code || 'NAVER_SMARTSTORE',
      weightKg: body.weight_kg || 0.5,
      isCrossborder: Boolean(body.is_crossborder),
      originCountry: body.origin_country || 'CN',
      minMarginKrw: body.min_margin_krw || 3000,
      roundingUnit: body.rounding_unit || 100
    });

    return json(corsHeaders, {
      success: true,
      data: result
    });
  }

  // 6. Multi-Channel Product Listing Distribution (POST /api/v1/channels/listings/publish)
  if (p === '/api/v1/channels/listings/publish' && request.method === 'POST') {
    const caller = await requireApprovedPartner(request, env);
    await assertFeatureEnabled(env, 'marketplace_listing_publish');

    const body = await readJson(request);
    const productId = String(body.product_id || '').trim();
    const salesChannelId = String(body.sales_channel_id || '').trim();

    if (!productId || !salesChannelId) {
      throw bad('PARAMS_REQUIRED', 'product_id 와 sales_channel_id 는 필수입니다.');
    }

    const prod = await env.DB.prepare('SELECT * FROM products WHERE id = ?').bind(productId).first();
    if (!prod) throw notFound('상품을 찾을 수 없습니다.');

    const channel = await env.DB.prepare(`
      SELECT sc.*, p.id as platform_id, p.name as platform_name
      FROM sales_channels sc
      JOIN commerce_platforms p ON p.id = sc.platform_id
      WHERE sc.id = ?
    `).bind(salesChannelId).first();
    if (!channel) throw notFound('판매 채널을 찾을 수 없습니다.');

    // Find Partner Credential for this platform
    const cred = await env.DB.prepare(`
      SELECT * FROM platform_credentials WHERE partner_id = ? AND platform_id = ?
    `).bind(caller.partner.id, channel.platform_id).first();

    const connector = registry.get(channel.platform_id);
    const listingRes = await connector.createListing({
      title: prod.title,
      description_html: prod.description_html,
      brand: 'OLMOA',
      channel_sale_price: body.sale_price || prod.lowest_sale_price,
      channel_original_price: body.original_price || prod.lowest_original_price,
      stock_quantity: 100
    }, cred ? {
      accessKey: cred.api_key_masked,
      apiKey: cred.api_key_masked,
      openApiKey: cred.api_key_masked,
      secretKey: cred.secret_key_enc,
      secretKeyEnc: cred.secret_key_enc,
      vendorId: cred.seller_account_id,
      sellerAccountId: cred.seller_account_id,
      clientId: cred.seller_account_id || cred.api_key_masked,
      clientSecret: cred.secret_key_enc,
      refreshToken: cred.secret_key_enc
    } : {});

    const listingId = newId('lst');
    const listingStatus = listingRes.success ? (listingRes.status || 'ACTIVE') : 'SYNC_FAILED';

    await env.DB.prepare(`
      INSERT INTO channel_listings (
        id, partner_id, sales_channel_id, product_id, external_product_id,
        external_url, listing_title, channel_sale_price, channel_original_price,
        currency, stock_allocated, status, last_synced_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 100, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      ON CONFLICT(sales_channel_id, product_id) DO UPDATE SET
        external_product_id = excluded.external_product_id,
        external_url = excluded.external_url,
        channel_sale_price = excluded.channel_sale_price,
        status = excluded.status,
        last_synced_at = CURRENT_TIMESTAMP,
        updated_at = CURRENT_TIMESTAMP
    `).bind(
      listingId,
      caller.partner.id,
      salesChannelId,
      productId,
      listingRes.external_product_id || null,
      listingRes.channel_url || null,
      prod.title,
      body.sale_price || prod.lowest_sale_price,
      body.original_price || prod.lowest_original_price,
      channel.currency,
      listingStatus
    ).run();

    return json(corsHeaders, {
      success: listingRes.success,
      status: listingStatus,
      listing_id: listingId,
      external_product_id: listingRes.external_product_id,
      channel_name: channel.channel_name,
      message: listingRes.message || `[${channel.channel_name}]에 상품이 성공적으로 전송되었습니다.`
    });
  }

  // 7. List Channel Listings (GET /api/v1/channels/listings)
  if (p === '/api/v1/channels/listings' && request.method === 'GET') {
    const caller = await requireApprovedPartner(request, env);
    const { results } = await env.DB.prepare(`
      SELECT l.*, sc.channel_name, p.title as product_title, p.thumbnail_url
      FROM channel_listings l
      JOIN sales_channels sc ON sc.id = l.sales_channel_id
      JOIN products p ON p.id = l.product_id
      WHERE l.partner_id = ?
      ORDER BY l.created_at DESC
      LIMIT 100
    `).bind(caller.partner.id).all();

    return json(corsHeaders, {
      success: true,
      count: results.length,
      data: results
    });
  }

  // 8. Multi-Channel External Orders Synchronization (POST /api/v1/channels/orders/sync)
  if (p === '/api/v1/channels/orders/sync' && request.method === 'POST') {
    const caller = await requireApprovedPartner(request, env);
    await assertFeatureEnabled(env, 'marketplace_order_sync');

    const body = await readJson(request);
    const salesChannelId = String(body.sales_channel_id || '').trim();
    if (!salesChannelId) throw bad('CHANNEL_REQUIRED', 'sales_channel_id 는 필수입니다.');

    const channel = await env.DB.prepare(`
      SELECT sc.*, p.id as platform_id, p.name as platform_name
      FROM sales_channels sc
      JOIN commerce_platforms p ON p.id = sc.platform_id
      WHERE sc.id = ?
    `).bind(salesChannelId).first();
    if (!channel) throw notFound('판매 채널을 찾을 수 없습니다.');

    const connector = registry.get(channel.platform_id);
    const orderRes = await connector.getOrders({}, { isSandbox: true });

    let importedCount = 0;
    if (orderRes.success && Array.isArray(orderRes.orders)) {
      for (const ord of orderRes.orders) {
        const chOrdId = newId('cord');
        const stmts = [
          env.DB.prepare(`
            INSERT INTO channel_orders (
              id, sales_channel_id, partner_id, external_order_id, external_order_no,
              buyer_name, recipient_name, recipient_phone_masked, shipping_address,
              customs_id_pccc, total_order_amount, channel_commission_amount,
              settlement_expected_amount, currency, order_status, raw_payload_json,
              collected_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'COLLECTED', ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
            ON CONFLICT(sales_channel_id, external_order_id) DO UPDATE SET updated_at = CURRENT_TIMESTAMP
          `).bind(
            chOrdId,
            channel.id,
            caller.partner.id,
            ord.external_order_id,
            ord.external_order_no,
            ord.buyer_name,
            ord.recipient_name,
            ord.recipient_phone,
            ord.shipping_address,
            ord.customs_id_pccc || null,
            ord.total_order_amount,
            Math.round(ord.total_order_amount * (channel.commission_bps / 10000)),
            Math.round(ord.total_order_amount * (1 - channel.commission_bps / 10000)),
            ord.currency || 'KRW',
            JSON.stringify(ord)
          )
        ];

        for (const item of (ord.items || [])) {
          const itemId = newId('citm');
          stmts.push(env.DB.prepare(`
            INSERT INTO channel_order_items (
              id, channel_order_id, external_sku_code, product_title, quantity, unit_price, total_price, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
          `).bind(
            itemId, chOrdId, item.external_sku_code || 'SKU_01', item.product_title,
            item.quantity || 1, item.unit_price, (item.quantity || 1) * item.unit_price
          ));
        }

        await env.DB.batch(stmts);
        importedCount++;
      }
    }

    return json(corsHeaders, {
      success: true,
      channel_name: channel.channel_name,
      imported_orders_count: importedCount,
      message: `[${channel.channel_name}] 채널에서 신규 주문 ${importedCount}건이 수집되었습니다.`
    });
  }

  // 9. List External Channel Orders (GET /api/v1/channels/orders)
  if (p === '/api/v1/channels/orders' && request.method === 'GET') {
    const caller = await requireApprovedPartner(request, env);
    const { results } = await env.DB.prepare(`
      SELECT o.*, sc.channel_name, sc.channel_code
      FROM channel_orders o
      JOIN sales_channels sc ON sc.id = o.sales_channel_id
      WHERE o.partner_id = ?
      ORDER BY o.collected_at DESC
      LIMIT 100
    `).bind(caller.partner.id).all();

    return json(corsHeaders, {
      success: true,
      count: results.length,
      data: results
    });
  }

  // 10. Dispatch External Order to B2B Supplier (POST /api/v1/channels/orders/:id/dispatch-po)
  const poM = p.match(/^\/api\/v1\/channels\/orders\/([^/]+)\/dispatch-po$/);
  if (poM && request.method === 'POST') {
    const caller = await requireApprovedPartner(request, env);
    await assertFeatureEnabled(env, 'supplier_order_manual');

    const body = await readJson(request);
    const chOrder = await env.DB.prepare(`
      SELECT * FROM channel_orders WHERE id = ? AND partner_id = ?
    `).bind(poM[1], caller.partner.id).first();

    if (!chOrder) throw notFound('외부 채널 주문을 찾을 수 없습니다.');
    if (chOrder.order_status === 'PO_DISPATCHED') {
      throw bad('ALREADY_DISPATCHED', '이미 공급업체에 발주가 완료된 주문입니다.');
    }

    const supplierId = String(body.supplier_id || 'domeggook_domeme').trim();
    const connector = registry.get(supplierId);

    const poRes = await connector.createSupplierOrder({
      sub_order_id: chOrder.id,
      idempotency_key: `po_ext_${chOrder.id}_${Date.now()}`,
      total_cost_krw: Math.round(chOrder.total_order_amount * 0.7),
      recipient_name: chOrder.recipient_name,
      recipient_phone: chOrder.recipient_phone_masked,
      shipping_address: chOrder.shipping_address
    }, { isSandbox: true });

    if (!poRes.success) {
      throw bad('PO_DISPATCH_FAILED', poRes.error || '공급업체 발주 처리에 실패했습니다.');
    }

    await env.DB.prepare(`
      UPDATE channel_orders
      SET order_status = 'PO_DISPATCHED', updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).bind(chOrder.id).run();

    return json(corsHeaders, {
      success: true,
      b2b_order_id: poRes.b2b_order_id,
      status: 'PO_DISPATCHED',
      message: poRes.message
    });
  }

  // 11. Multi-Carrier 3PL Fulfillment & Waybill Sync (POST /api/v1/channels/orders/:id/fulfill)
  const fulM = p.match(/^\/api\/v1\/channels\/orders\/([^/]+)\/fulfill$/);
  if (fulM && request.method === 'POST') {
    const caller = await requireApprovedPartner(request, env);
    const body = await readJson(request);

    const chOrder = await env.DB.prepare(`
      SELECT o.*, sc.platform_id
      FROM channel_orders o
      JOIN sales_channels sc ON sc.id = o.sales_channel_id
      WHERE o.id = ? AND o.partner_id = ?
    `).bind(fulM[1], caller.partner.id).first();

    if (!chOrder) throw notFound('외부 채널 주문을 찾을 수 없습니다.');

    const carrierCode = String(body.carrier_code || 'CJ_LOGISTICS').toUpperCase();
    const logistics = registry.get('3pl_logistics');
    const flmRes = await logistics.createFulfillmentOrder({
      carrier_code: carrierCode,
      tracking_number: body.tracking_number,
      customs_id_pccc: chOrder.customs_id_pccc
    });

    // Sync shipment back to external open market
    const marketConnector = registry.get(chOrder.platform_id);
    await marketConnector.updateShipment({
      external_order_id: chOrder.external_order_id,
      tracking_number: flmRes.tracking_number,
      carrier_code: carrierCode
    }, { isSandbox: true });

    await env.DB.prepare(`
      UPDATE channel_orders
      SET order_status = 'SHIPPED', updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).bind(chOrder.id).run();

    return json(corsHeaders, {
      success: true,
      status: 'SHIPPED',
      tracking_number: flmRes.tracking_number,
      carrier_name: flmRes.carrier_name,
      tracking_url: flmRes.tracking_url,
      message: `3PL 운송장(${flmRes.tracking_number}) 발행 및 판매채널 송장 연동이 완료되었습니다.`
    });
  }

  // 12. Inbound Platform Webhooks (POST /api/v1/channels/webhooks/:platform)
  const hookM = p.match(/^\/api\/v1\/channels\/webhooks\/([^/]+)$/);
  if (hookM && request.method === 'POST') {
    const platformId = hookM[1];
    const bodyText = await request.text();
    const signature = request.headers.get('x-signature') || request.headers.get('authorization') || '';

    const hookId = newId('wh');
    await env.DB.prepare(`
      INSERT INTO integration_webhook_events (
        id, platform_id, event_type, signature_header, signature_valid, payload_json, processed_status, created_at
      ) VALUES (?, ?, 'ORDER_STATUS_CHANGED', ?, 1, ?, 'PROCESSED', CURRENT_TIMESTAMP)
    `).bind(hookId, platformId, signature, bodyText).run();

    return json(corsHeaders, {
      received: true,
      event_id: hookId,
      message: `[${platformId}] 웹훅 이벤트가 안전하게 수신 및 기록되었습니다.`
    });
  }

  return null;
}
