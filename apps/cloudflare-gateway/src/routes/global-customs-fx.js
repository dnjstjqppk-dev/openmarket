import { authenticate } from '../lib/auth.js';
import { krwPerUnit, krwPerUnitMap } from '../lib/fx.js';
import { logPiiView } from '../services/privacy.js';
// apps/cloudflare-gateway/src/routes/global-customs-fx.js
// OLMOA Global OpenMarket Engine: Real-Time Customs PCCC Verification, DDP/DDU Duty Calculator & Multi-Currency FX Engine

export async function handleGlobalCustomsAndFxRoutes(request, url, env, corsHeaders) {
  // 1. Real-Time Personal Customs Clearance Code (PCCC / 개인통관고유부호) Validation
  if (url.pathname === '/api/v1/customs/validate-pccc' && request.method === 'POST') {
    const body = await request.json().catch(() => ({}));
    const rawPccc = String(body.pccc || '').trim().toUpperCase();
    const recipientName = String(body.name || body.recipient_name || '').trim();
    const recipientPhone = String(body.phone || body.recipient_phone || '').trim();

    if (!rawPccc) {
      return new Response(JSON.stringify({
        success: false,
        verified: false,
        error: '개인통관고유부호를 입력해주세요.',
        code: 'MISSING_PCCC'
      }), { status: 400, headers: corsHeaders });
    }

    // Korea Customs Service PCCC Standard Format: 'P' followed by 12 digits (Length: 13)
    const pcccRegex = /^P\d{12}$/;
    if (!pcccRegex.test(rawPccc)) {
      return new Response(JSON.stringify({
        success: false,
        verified: false,
        error: "개인통관고유부호 형식이 올바르지 않습니다. 'P'로 시작하는 13자리 번호여야 합니다 (예: P123456789012).",
        code: 'INVALID_PCCC_FORMAT'
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
      try {
        const queryParams = new URLSearchParams({
          crkyCn: env.UNIPASS_API_KEY,
          persEcm: rawPccc,
          pltxNm: recipientName || '',
          cralTelno: recipientPhone ? recipientPhone.replace(/[^0-9]/g, '') : ''
        });
        const unipassUrl = `https://unipass.customs.go.kr:38010/ext/rest/persEcmQry/retrievePersEcm?${queryParams.toString()}`;
        const uRes = await fetch(unipassUrl);
        const xmlText = uRes.ok ? await uRes.text() : '';
        // tCo = number of matching records in the Uni-Pass response.
        const count = Number((xmlText.match(/<tCo>(\d+)<\/tCo>/) || [])[1] || 0);
        if (count > 0) {
          verified = true;
          verificationMode = 'UNIPASS_MATCH';
          message = '관세청 조회 결과 성명·연락처와 일치합니다.';
        } else if (uRes.ok) {
          verificationMode = 'UNIPASS_NO_MATCH';
          message = '관세청 조회 결과 일치하는 정보가 없습니다. 성명·연락처·부호를 확인해 주세요.';
        } else {
          verificationMode = 'UNIPASS_UNAVAILABLE';
          message = '관세청 조회에 실패했습니다. 형식만 확인되었습니다.';
        }
      } catch (_) {
        verificationMode = 'UNIPASS_UNAVAILABLE';
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
    } catch (_) { rows = []; }
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
    const body = await request.json().catch(() => ({}));
    const totalGoodsKrw = Math.max(0, parseInt(body.goods_amount_krw || body.total_goods_amount || 0, 10));
    const shippingFeeKrw = Math.max(0, parseInt(body.shipping_fee_krw || body.total_shipping_amount || 0, 10));
    const countryOrigin = String(body.country_origin || 'OTHER').toUpperCase();

    // KRW per USD from the single-source FX helper (operator table, else reference).
    const usdRate = (await krwPerUnit(env, 'USD')).rate;
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
        explanation: isTaxExempt
          ? `주문 금액($${totalOrderUsd.toFixed(2)})이 소액물품 면세한도($${exemptionThresholdUsd}) 이하이므로 관세 및 부가세가 전액 면제됩니다.`
          : `주문 금액($${totalOrderUsd.toFixed(2)})이 면세한도($${exemptionThresholdUsd})를 초과하여 예상 관부가세(약 ₩${totalTaxKrw.toLocaleString()})가 부과됩니다.`
      }
    }), { headers: corsHeaders });
  }

  // 4. Currency Conversion Utility
  if (url.pathname === '/api/v1/fx/convert' && request.method === 'POST') {
    const body = await request.json().catch(() => ({}));
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

    if (!isAdmin && !customerId) {
      return new Response(JSON.stringify({
        error: 'Authentication required: Please provide Authorization token or X-Customer-Id header',
        code: 'UNAUTHORIZED'
      }), { status: 401, headers: corsHeaders });
    }

    const orderId = url.pathname.split('/')[4];
    const order = await env.DB.prepare(
      `SELECT o.*, u.full_name as customer_name, u.email as customer_email, u.phone as customer_phone
       FROM orders o
       LEFT JOIN users u ON o.customer_id = u.id
       WHERE o.id = ? OR o.order_no = ?`
    ).bind(orderId, orderId).first();

    if (!order) {
      return new Response(JSON.stringify({ error: 'Order not found', order_id: orderId }), { status: 404, headers: corsHeaders });
    }

    if (isAdmin && order.customer_id) await logPiiView(env, principal, 'admin.commercial-invoice', 'order', [order.id], 'recipient_name,recipient_phone,shipping_address,pccc,customer_email', request);
    if (!isAdmin && order.customer_id !== customerId) {
      return new Response(JSON.stringify({
        error: 'Access denied: You do not have permission to view this order commercial invoice',
        code: 'FORBIDDEN'
      }), { status: 403, headers: corsHeaders });
    }

    // Fail-Closed Validation (OM-09): Required customs/recipient information must be present and non-empty
    const missingFields = [];
    if (!order.pccc || !String(order.pccc).trim()) missingFields.push('pccc');
    if (!order.recipient_name || !String(order.recipient_name).trim()) missingFields.push('recipient_name');
    if (!order.recipient_phone || !String(order.recipient_phone).trim()) missingFields.push('recipient_phone');
    if (!order.shipping_address_line1 || !String(order.shipping_address_line1).trim()) missingFields.push('shipping_address_line1');
    if (!order.shipping_postal_code || !String(order.shipping_postal_code).trim()) missingFields.push('shipping_postal_code');

    if (missingFields.length > 0) {
      return new Response(JSON.stringify({
        error: 'Customs commercial invoice cannot be generated: required customs/recipient information is missing (Fail-Closed)',
        code: 'INCOMPLETE_CUSTOMS_DATA',
        order_id: order.id,
        order_no: order.order_no,
        missing_fields: missingFields
      }), { status: 422, headers: corsHeaders });
    }

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
        net_weight_kg: it.package_weight_kg || 0.5,
        seller_name: it.seller_name || 'OLMOA Official Partner',
        carrier_code: it.carrier_code || 'CUSTOMS_EXPRESS',
        tracking_number: it.tracking_number || null
      };
    });

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
        company_name: 'OLMOA Global Cross-Border Fulfillment Hub',
        business_number: '120-88-01928',
        country: 'KR',
        address: 'Incheon Free Trade Zone B1, Incheon, Republic of Korea',
        contact: 'customs-ops@olmoa.com'
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

  return null;
}

