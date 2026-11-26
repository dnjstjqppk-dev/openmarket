import { authenticate, requireAdmin, requireCustomer } from '../lib/auth.js';
import { krwPerUnit, krwPerUnitMap } from '../lib/fx.js';
import { auditStatement } from '../lib/ledger.js';
import { logPiiView } from '../services/privacy.js';
import { bad, forbidden, json, notFound, HttpError, readJson } from '../lib/http.js';
import { maybeOpenPii } from '../lib/pii-crypto.js';
import { validatePccc, queryUnipass } from '../lib/pccc.js';
// apps/cloudflare-gateway/src/routes/global-customs-fx.js
// OLMOA Global OpenMarket Engine: Real-Time Customs PCCC Verification, DDP/DDU Duty Calculator & Multi-Currency FX Engine

const ALLOWED_FX_CURRENCIES = ['USD', 'JPY', 'TWD', 'CNY', 'EUR', 'SGD'];

export async function handleGlobalCustomsAndFxRoutes(request, url, env, corsHeaders) {
  // 1. Real-Time Personal Customs Clearance Code (PCCC / 개인통관고유부호) Validation
  if (url.pathname === '/api/v1/customs/validate-pccc' && request.method === 'POST') {
    // P2-SEC-06: the Uni-Pass verdict (when the key is set) is a per-person oracle —
    // only signed-in buyers may ask, and RL_WRITE bounds the cadence per account.
    await requireCustomer(request, env);
    const body = await readJson(request);
    const verdict = validatePccc(body.pccc);
    const rawPccc = verdict.normalized;
    const recipientName = String(body.name || body.recipient_name || '').trim();
    const recipientPhone = String(body.phone || body.recipient_phone || '').trim();

    if (!verdict.ok) {
      return new Response(JSON.stringify({
        success: false,
        verified: false,
        error: verdict.message,
        code: verdict.code
      }), { status: 400, headers: corsHeaders });
    }

    // In production or sandbox, verify matching name
    if (recipientName && recipientName.length < 2) {
      return new Response(JSON.stringify({
        success: false,
        verified: false,
        error: '수하인 성명(한글 또는 영문)을 정확히 입력해주세요.',
        code: 'INVALID_NAME'
      }), { status: 400, headers: corsHeaders });
    }

    // Only a Uni-Pass (관세청) lookup can say the code belongs to this person. A well-formed code is just
    // well-formed: it used to be reported as verified=true / "관세청 전산망 일치 검증 완료" without any lookup,
    // and stayed verified even when the configured Uni-Pass call failed or found nothing.
    let verified = false;
    let verificationMode = 'FORMAT_ONLY';
    let message = '형식이 올바른 개인통관고유부호입니다. 관세청 조회는 연동되어 있지 않아 명의 일치 여부는 확인하지 않았습니다.';
    if (env && env.UNIPASS_API_KEY) {
      const live = await queryUnipass(env, rawPccc, { name: recipientName, phone: recipientPhone });
      verificationMode = live.mode;
      if (live.mode === 'UNIPASS_MATCH') {
        verified = true;
        message = '관세청 조회 결과 성명·연락처와 일치합니다.';
      } else if (live.mode === 'UNIPASS_NO_MATCH') {
        message = '관세청 조회 결과 일치하는 정보가 없습니다. 성명·연락처·부호를 확인해 주세요.';
      } else {
        message = '관세청 조회에 실패했습니다. 형식만 확인되었습니다.';
      }
    }

    return new Response(JSON.stringify({
      success: true,
      verified,
      format_valid: true,
      verification_mode: verificationMode,
      message,
      data: {
        pccc: rawPccc,
        verified,
        format_valid: true,
        verification_mode: verificationMode,
        message
      }
    }), { headers: corsHeaders });
  }

  // 2. Display exchange rates. There is no external FX feed: the only source is the operator-maintained
  //    exchange_rates table, so the response says exactly that and carries each row's own updated_at.
  //    Currencies without a row are simply absent (clients must not convert into them).
  if (url.pathname === '/api/v1/fx/rates' && request.method === 'GET') {
    let rows = [];
    try {
      rows = (await env.DB.prepare('SELECT target_currency, rate, inverse_rate, spread_pct, updated_at FROM exchange_rates WHERE base_currency = ?').bind('KRW').all()).results || [];
    } catch (e) {
      // P2: keep serving the (possibly empty) rate table, but a DB failure
      // must be visible instead of disguised as "no rates configured".
      console.error(JSON.stringify({ level: 'error', job: 'fx_rates', error: String(e && e.message || e) }));
      rows = [];
    }
    const valid = rows.filter((r) => Number(r.rate) > 0 && Number(r.inverse_rate) > 0);
    const rates = { KRW: 1 };
    const inverseRates = {};
    const updatedAt = {};
    for (const r of valid) {
      rates[r.target_currency] = Number(r.rate);
      inverseRates[r.target_currency] = Number(r.inverse_rate);
      updatedAt[r.target_currency] = r.updated_at;
    }
    const oldest = valid.map((r) => r.updated_at).sort()[0] || null;

    return new Response(JSON.stringify({
      success: true,
      base_currency: 'KRW',
      supported_currencies: ['KRW', ...valid.map((r) => r.target_currency)],
      rates,
      inverse_rates: inverseRates,
      updated_at: updatedAt,
      last_updated: oldest,
      source: 'OPERATOR_TABLE',
      source_note: '운영자가 입력한 참고 환율입니다. 실시간 시세가 아니며 결제는 원화(KRW)로 진행됩니다.'
    }), {
      headers: {
        ...corsHeaders,
        'Cache-Control': 'public, max-age=300, s-maxage=300'
      }
    });
  }

  // 3. Customs Duty & Tax Calculator (DDP vs DDU)
  if (url.pathname === '/api/v1/customs/estimate-duty' && request.method === 'POST') {
    const body = await readJson(request);
    const totalGoodsKrw = Math.max(0, parseInt(body.goods_amount_krw || body.total_goods_amount || 0, 10));
    const shippingFeeKrw = Math.max(0, parseInt(body.shipping_fee_krw || body.total_shipping_amount || 0, 10));
    const countryOrigin = String(body.country_origin || 'OTHER').toUpperCase();

    // KRW per USD from the single-source FX helper (operator table, else reference).
    // P-N03: the response discloses the rate basis — an exemption decided on a stale
    // fallback must say so instead of passing as a live quote.
    const usdFx = await krwPerUnit(env, 'USD');
    const usdRate = usdFx.rate;
    const totalOrderKrw = totalGoodsKrw + shippingFeeKrw;
    const totalOrderUsd = Math.round((totalOrderKrw / usdRate) * 100) / 100;

    // De Minimis: US origin is $200 (KOR-US FTA), other countries are $150
    const exemptionThresholdUsd = countryOrigin === 'US' ? 200 : 150;
    const isTaxExempt = totalOrderUsd <= exemptionThresholdUsd;

    let estimatedTariffKrw = 0;
    let estimatedVatKrw = 0;
    let totalTaxKrw = 0;

    if (!isTaxExempt) {
      // Standard HS tariff: ~8% on goods, VAT: 10% on (goods + tariff)
      estimatedTariffKrw = Math.round(totalGoodsKrw * 0.08);
      estimatedVatKrw = Math.round((totalGoodsKrw + estimatedTariffKrw) * 0.10);
      totalTaxKrw = estimatedTariffKrw + estimatedVatKrw;
    }

    return new Response(JSON.stringify({
      success: true,
      brand: 'OLMOA',
      data: {
        total_order_krw: totalOrderKrw,
        total_order_usd: totalOrderUsd,
        country_origin: countryOrigin,
        exemption_threshold_usd: exemptionThresholdUsd,
        is_tax_exempt: isTaxExempt,
        estimated_tariff_krw: estimatedTariffKrw,
        estimated_vat_krw: estimatedVatKrw,
        total_estimated_tax_krw: totalTaxKrw,
        ddp_total_amount_krw: totalOrderKrw + totalTaxKrw,
        ddu_total_amount_krw: totalOrderKrw,
        fx_rate: usdFx.rate,
        fx_source: usdFx.source,
        fx_as_of: usdFx.updated_at,
        explanation: isTaxExempt
          ? `주문 금액($${totalOrderUsd.toFixed(2)})이 소액물품 면세한도($${exemptionThresholdUsd}) 이하이므로 관세 및 부가세가 전액 면제됩니다.`
          : `주문 금액($${totalOrderUsd.toFixed(2)})이 면세한도($${exemptionThresholdUsd})를 초과하여 예상 관부가세(약 ₩${totalTaxKrw.toLocaleString()})가 부과됩니다.`
      }
    }), { headers: corsHeaders });
  }

  // 4. Currency Conversion Utility
  if (url.pathname === '/api/v1/fx/convert' && request.method === 'POST') {
    const body = await readJson(request);
    const amount = Number(body.amount || 0);
    const from = String(body.from || 'KRW').toUpperCase();
    const to = String(body.to || 'USD').toUpperCase();

    const fxTable = await krwPerUnitMap(env);

    const fromInKrw = from === 'KRW' ? amount : amount * (fxTable[from] || 1);
    const converted = to === 'KRW' ? fromInKrw : fromInKrw / (fxTable[to] || 1);

    return new Response(JSON.stringify({
      success: true,
      from,
      to,
      original_amount: amount,
      converted_amount: Math.round(converted * 100) / 100,
      formatted: `${to} ${converted.toLocaleString(undefined, { maximumFractionDigits: 2 })}`
    }), { headers: corsHeaders });
  }

  // 5. Cross-Border Commercial Invoice & Packing List Manifest (GET /api/v1/orders/:id/commercial-invoice)
  if (url.pathname.match(/^\/api\/v1\/orders\/[^\/]+\/commercial-invoice$/) && request.method === 'GET') {
    const principal = await authenticate(request, env);
    const isAdmin = Boolean(principal && principal.role === 'ROLE_ADMIN');
    const customerId = principal && principal.role === 'ROLE_CUSTOMER' ? principal.userId : '';

    if (!isAdmin && !customerId) throw new HttpError(401, 'UNAUTHORIZED', 'Authentication required: Please provide Authorization token or X-Customer-Id header');

    const orderId = url.pathname.split('/')[4];
    const order = await env.DB.prepare(
      `SELECT o.*, u.full_name as customer_name, u.email as customer_email, u.phone as customer_phone
       FROM orders o
       LEFT JOIN users u ON o.customer_id = u.id
       WHERE o.id = ? OR o.order_no = ?`
    ).bind(orderId, orderId).first();

    if (!order) throw new HttpError(404, 'NOT_FOUND', 'Order not found', { order_id: orderId });

    if (isAdmin && order.customer_id) await logPiiView(env, principal, 'admin.commercial-invoice', 'order', [order.id], 'recipient_name,recipient_phone,shipping_address,pccc,customer_email', request);
    if (!isAdmin && order.customer_id !== customerId) throw forbidden('Access denied: You do not have permission to view this order commercial invoice');

    // SEC-10: the owner and the operator read the full PCCC on the invoice; open the sealed value first.
    order.pccc = await maybeOpenPii(env, order.pccc);
    // Fail-Closed Validation (OM-09): Required customs/recipient information must be present and non-empty
    const missingFields = [];
    if (!order.pccc || !String(order.pccc).trim()) missingFields.push('pccc');
    if (!order.recipient_name || !String(order.recipient_name).trim()) missingFields.push('recipient_name');
    if (!order.recipient_phone || !String(order.recipient_phone).trim()) missingFields.push('recipient_phone');
    if (!order.shipping_address_line1 || !String(order.shipping_address_line1).trim()) missingFields.push('shipping_address_line1');
    if (!order.shipping_postal_code || !String(order.shipping_postal_code).trim()) missingFields.push('shipping_postal_code');

    if (missingFields.length > 0) throw new HttpError(422, 'INCOMPLETE_CUSTOMS_DATA', 'Customs commercial invoice cannot be generated: required customs/recipient information is missing (Fail-Closed)', { order_id: order.id, order_no: order.order_no, missing_fields: missingFields });

    // 5-7: the exporter is the order-time operating business, never a hardcoded
    // identity. An order without one (pre-entity legacy rows) fails closed:
    // printing the current operator there would misattribute the shipment.
    let exporter = null;
    if (order.operator_entity_id) {
      exporter = await env.DB.prepare('SELECT * FROM business_entities WHERE id = ?').bind(order.operator_entity_id).first();
    }
    if (!exporter) throw new HttpError(409, 'EXPORTER_NOT_CONFIGURED', '수출자(운영 사업자) 정보가 없어 통관 인보이스를 만들 수 없습니다. 운영 사업자를 먼저 등록·활성화해 주세요.', { order_id: order.id, order_no: order.order_no });

    const { results: items } = await env.DB.prepare(
      `SELECT oi.*, so.partner_id, so.carrier_code, so.tracking_number,
              p.title as product_title, COALESCE(pt.business_name, 'OLMOA') as brand, p.hs_code, p.country_origin, p.package_weight_kg,
              pt.business_name as seller_name, pt.business_reg_number
       FROM order_items oi
       JOIN sub_orders so ON oi.sub_order_id = so.id
       LEFT JOIN product_skus ps ON oi.sku_id = ps.id
       LEFT JOIN products p ON ps.product_id = p.id
       LEFT JOIN partners pt ON so.partner_id = pt.id
       WHERE so.parent_order_id = ?`
    ).bind(order.id).all();

    let usdRate = order.fx_rate || 0;
    let fxSource = 'Order Checkout FX Rate';
    if (!usdRate || usdRate <= 0) {
      const live = await krwPerUnit(env, 'USD');
      usdRate = live.rate;
      fxSource = live.source === 'OPERATOR_TABLE'
        ? `OLMOA Dynamic FX Engine (${live.updated_at || 'Live'})`
        : 'OLMOA Internal Treasury Reference Rate';
    }

    const totalKrw = order.total_pay_amount || 0;
    const totalUsd = Math.round((totalKrw / usdRate) * 100) / 100;

    const manifestItems = (items || []).map((it, idx) => {
      const itPriceKrw = it.unit_price || 0;
      const itPriceUsd = Math.round((itPriceKrw / usdRate) * 100) / 100;
      const subtotalUsd = Math.round((itPriceUsd * (it.quantity || 1)) * 100) / 100;
      return {
        item_no: idx + 1,
        sku_id: it.sku_id || 'SKU_STD',
        description: it.product_title || 'Cross-Border Consumer Commodity',
        brand: it.brand || 'OLMOA',
        hs_code: it.hs_code || '6109.10',
        origin_country: it.country_origin || 'KR',
        quantity: it.quantity || 1,
        unit_price_usd: itPriceUsd,
        unit_price_krw: itPriceKrw,
        total_amount_usd: subtotalUsd,
        total_amount_krw: it.total_price || (itPriceKrw * (it.quantity || 1)),
        net_weight_kg: it.package_weight_kg ?? null,
        seller_name: it.seller_name || null,
        carrier_code: it.carrier_code || null,
        tracking_number: it.tracking_number || null
      };
    });

    // 5-7: absent weights stay empty; the header counts them instead of inventing 0.5kg.
    const missingWeightCount = manifestItems.filter((it) => it.net_weight_kg == null).length;

    const invoiceData = {
      invoice_number: `INV-CB-${order.order_no || order.id}`,
      issue_date: new Date(order.created_at || Date.now()).toISOString().slice(0, 10),
      order_id: order.id,
      order_no: order.order_no,
      incoterms: order.customs_duty_type === 'DDU' ? 'DDU (Delivered Duty Unpaid)' : 'DDP (Delivered Duty Paid)',
      currency: 'USD',
      fx_rate_applied: usdRate,
      fx_rate_source: fxSource,
      exporter: {
        company_name: exporter.legal_name,
        business_number: exporter.business_reg_number,
        country: 'KR',
        address: exporter.address,
        contact: exporter.cs_email
      },
      consignee: {
        name: order.recipient_name,
        pccc: order.pccc,
        phone: order.recipient_phone,
        address: `${order.shipping_address_line1 || ''} ${order.shipping_address_line2 || ''}`.trim(),
        postal_code: order.shipping_postal_code,
        country: 'KR'
      },
      summary: {
        total_items: manifestItems.reduce((acc, it) => acc + it.quantity, 0),
        total_customs_value_usd: totalUsd,
        total_customs_value_krw: totalKrw,
        freight_charge_usd: 0.00,
        insurance_charge_usd: 0.00,
        missing_weight_count: missingWeightCount,
        missing_weight_note: missingWeightCount > 0 ? `중량 미입력 품목 ${missingWeightCount}개` : null,
        declaration_status: 'DRAFT_REFERENCE_ONLY',
        customs_submission_verified: false,
        purpose_note: '구매자 보관 및 내부 참조용 전자 상업송장 (관세청 실신고 연동 전 DRAFT 단계)'
      },
      line_items: manifestItems,
      customs_declaration_statement: 'I hereby certify that the information on this commercial invoice is true and correct, and that the contents and value of this shipment are as stated above according to Korea Customs Service regulations.'
    };

    return new Response(JSON.stringify({
      success: true,
      brand: 'OLMOA Global Customs Engine',
      data: invoiceData
    }), { headers: corsHeaders });
  }

  // 6. Operator FX rate management (GET/PUT/DELETE /api/v1/admin/fx-rates[/:currency])
  //    Allows Finance/Super-Admin operators to publish KRW-per-unit display rates (incl. TWD).
  if (url.pathname === '/api/v1/admin/fx-rates' && request.method === 'GET') {
    await requireAdmin(request, env);
    const { results } = await env.DB.prepare(
      'SELECT base_currency, target_currency, rate, inverse_rate, spread_pct, updated_at FROM exchange_rates WHERE base_currency = ? ORDER BY target_currency ASC'
    ).bind('KRW').all();
    return json(corsHeaders, { success: true, allowed_currencies: ALLOWED_FX_CURRENCIES, data: results || [] });
  }

  const fxM = url.pathname.match(/^\/api\/v1\/admin\/fx-rates\/([A-Za-z]{3})$/);
  if (fxM && (request.method === 'PUT' || request.method === 'DELETE')) {
    const admin = await requireAdmin(request, env);
    const currency = fxM[1].toUpperCase();
    if (!ALLOWED_FX_CURRENCIES.includes(currency)) {
      throw bad('UNSUPPORTED_CURRENCY', `지원 통화는 ${ALLOWED_FX_CURRENCIES.join('·')}입니다.`);
    }
    const before = await env.DB.prepare(
      'SELECT base_currency, target_currency, rate, inverse_rate, spread_pct, updated_at FROM exchange_rates WHERE base_currency = ? AND target_currency = ?'
    ).bind('KRW', currency).first();

    if (request.method === 'DELETE') {
      if (!before) throw notFound(`${currency} 환율이 등록되어 있지 않습니다.`);
      await env.DB.batch([
        env.DB.prepare('DELETE FROM exchange_rates WHERE base_currency = ? AND target_currency = ?').bind('KRW', currency),
        auditStatement(env, admin, { action: 'FX_RATE_DELETE', targetType: 'exchange_rates', targetId: `KRW:${currency}`, before, after: null, request })
      ]);
      return json(corsHeaders, { success: true, message: `${currency} 환율을 삭제했습니다.` });
    }

    const body = await readJson(request);
    const inverseRate = Number(body.inverse_rate ?? body.krw_per_unit);
    if (!Number.isFinite(inverseRate) || inverseRate <= 0 || inverseRate > 1000000) {
      throw bad('INVALID_RATE', '원화 기준 환율(inverse_rate)은 0보다 크고 1,000,000 이하의 숫자여야 합니다.');
    }
    const spreadPct = body.spread_pct === undefined || body.spread_pct === null ? 1.2 : Number(body.spread_pct);
    if (!Number.isFinite(spreadPct) || spreadPct < 0 || spreadPct > 20) {
      throw bad('INVALID_SPREAD', '스프레드(spread_pct)는 0~20 범위여야 합니다.');
    }
    const rate = Number((1 / inverseRate).toPrecision(8));
    const after = { base_currency: 'KRW', target_currency: currency, rate, inverse_rate: inverseRate, spread_pct: spreadPct };
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO exchange_rates (base_currency, target_currency, rate, inverse_rate, spread_pct, updated_at)
         VALUES ('KRW', ?, ?, ?, ?, CURRENT_TIMESTAMP)
         ON CONFLICT(base_currency, target_currency) DO UPDATE SET
           rate = excluded.rate, inverse_rate = excluded.inverse_rate, spread_pct = excluded.spread_pct, updated_at = CURRENT_TIMESTAMP`
      ).bind(currency, rate, inverseRate, spreadPct),
      auditStatement(env, admin, { action: 'FX_RATE_UPSERT', targetType: 'exchange_rates', targetId: `KRW:${currency}`, before, after, request })
    ]);
    const saved = await env.DB.prepare(
      'SELECT base_currency, target_currency, rate, inverse_rate, spread_pct, updated_at FROM exchange_rates WHERE base_currency = ? AND target_currency = ?'
    ).bind('KRW', currency).first();
    return json(corsHeaders, { success: true, message: `${currency} 환율을 저장했습니다.`, data: saved });
  }

  return null;
}

