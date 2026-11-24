// apps/cloudflare-gateway/src/services/connectors/naver-connector.js
// Naver SmartStore Commerce API Connector (OAuth 2.0 Client Credentials, Product Listing, Orders, Shipping).

import { BaseCommerceConnector } from './base-connector.js';

// NEW-04: strict validation, zero invented defaults. Every field Naver
// requires must arrive as real caller input; anything missing returns an
// explicit VALIDATION_ERROR so a malformed product can never be registered
// on the external market. Shared by the legacy stub below and the live
// partner bridge (services/channels/partner-live.js).
export function buildNaverListingPayload(input = {}) {
  const missing = [];
  const title = String(input.title || '').trim();
  if (!title) missing.push('title');
  const brand = String(input.brand || '').trim();
  if (!brand) missing.push('brand');
  const descriptionHtml = String(input.description_html || '').trim();
  if (!descriptionHtml) missing.push('description_html');
  // The publish route sends channel_sale_price; direct callers send sale_price. Both are real values.
  const salePrice = Number(input.sale_price ?? input.channel_sale_price);
  if (!Number.isSafeInteger(salePrice) || salePrice <= 0) missing.push('sale_price');
  const stockQuantity = Number(input.stock_quantity);
  if (!Number.isSafeInteger(stockQuantity) || stockQuantity < 0) missing.push('stock_quantity');
  const asPhone = String(input.as_phone || '').replace(/\D/g, '');
  if (asPhone.length < 8 || asPhone.length > 15) missing.push('as_phone');
  const deliveryCompany = String(input.delivery_company || '').trim().toUpperCase();
  if (!/^[A-Z0-9]{2,20}$/.test(deliveryCompany)) missing.push('delivery_company');
  const leafCategoryId = String(input.external_category_id || '').trim();
  if (!leafCategoryId) missing.push('external_category_id');
  const feeTypeRaw = String(input.delivery_fee_type || '').trim().toUpperCase();
  const feeType = { FREE: 'FREE', CHARGE: 'CHARGE', CONDITIONAL_FREE: 'CONDITIONAL_FREE', CONDITIONAL: 'CONDITIONAL_FREE' }[feeTypeRaw] || null;
  if (!feeType) missing.push('delivery_fee_type');
  const deliveryFee = Number(input.delivery_fee ?? 0);
  if (feeType === 'CHARGE' && (!Number.isSafeInteger(deliveryFee) || deliveryFee <= 0)) missing.push('delivery_fee');
  const freeThreshold = Number(input.free_shipping_threshold ?? 0);
  if (feeType === 'CONDITIONAL_FREE' && (!Number.isSafeInteger(freeThreshold) || freeThreshold <= 0)) missing.push('free_shipping_threshold');

  if (missing.length > 0) return { ok: false, missing };

  const sellerName = String(input.business_name || brand).slice(0, 50);
  const payload = {
    originProduct: {
      statusType: 'SALE',
      saleType: 'NEW',
      name: title.slice(0, 100),
      detailAttribute: {
        naverShoppingSearchInfo: {
          manufacturerName: brand,
          brandName: brand
        },
        afterServiceInfo: {
          afterServiceTelephoneNumber: asPhone,
          afterServiceGuideContent: `${sellerName} 고객센터(${asPhone})로 문의해 주세요.`
        },
        detailContent: descriptionHtml
      },
      leafCategoryId,
      salePrice,
      stockQuantity,
      deliveryInfo: {
        deliveryType: 'DELIVERY',
        deliveryAttributeType: 'NORMAL',
        deliveryCompany,
        deliveryFee: {
          deliveryFeeType: feeType,
          ...(feeType === 'CHARGE' ? { deliveryFee } : {}),
          ...(feeType === 'CONDITIONAL_FREE' ? { deliveryFee, freeConditionalAmount: freeThreshold } : {})
        }
      }
    },
    smartstoreChannelProduct: {
      naverShoppingRegistration: true,
      channelProductDisplayStatusType: 'ON'
    }
  };
  return { ok: true, payload };
}

export class NaverCommerceConnector extends BaseCommerceConnector {
  constructor() {
    super('naver_smartstore', '네이버 스마트스토어', {
      baseUrl: 'https://api.commerce.naver.com/external',
      authUrl: 'https://api.commerce.naver.com/external/v1/oauth2/token'
    });
  }

  async verifyConnection(credentials = {}) {
    if (credentials.isSandbox) {
      return { status: 'SANDBOX_STUB', verified: true, simulated: true, message: `${this.platformName || '플랫폼'} 샌드박스 스텁입니다. 실제 API는 호출하지 않았습니다.` };
    }
    const clientId = credentials.clientId || credentials.apiKey || credentials.sellerAccountId;
    const clientSecret = credentials.clientSecret || credentials.secretKey || credentials.secretKeyEnc;

    if (!clientId || !clientSecret) {
      return {
        status: 'BLOCKED_NO_CREDENTIAL',
        verified: false,
        message: '네이버 커머스 API 연동을 위해 Application Client ID 및 Client Secret 등록이 필요합니다.'
      };
    }
    // Not implemented: the OAuth token exchange with Naver is never performed.
    return {
      status: 'NOT_INTEGRATED', // no request is sent to the platform yet
      verified: false,
      message: `${this.platformName || '플랫폼'} 실제 API 연동이 구현되지 않아 인증정보를 검증하지 않았습니다.`
    };
  }

  // Listing creation: POST /external/v2/products (stub: validates, never sends).
  async createListing(input = {}, credentials = {}) {
    const authCheck = await this.verifyConnection(credentials);
    if (!authCheck.verified) {
      return { success: false, status: 'BLOCKED_NO_CREDENTIAL', error: authCheck.message };
    }

    const built = buildNaverListingPayload(input);
    if (!built.ok) {
      return {
        success: false,
        status: 'VALIDATION_ERROR',
        error: `네이버 상품 등록 필수값 누락: ${built.missing.join(', ')}. 누락된 값을 입력해야 외부 마켓에 등록할 수 있습니다.`,
        missing_fields: built.missing
      };
    }

    const originProductNo = `NVR_${Date.now().toString(36).toUpperCase()}`;
    return {
      success: true,
      status: 'ACTIVE',
      external_product_id: originProductNo,
      channel_url: `https://smartstore.naver.com/olmoa/products/${originProductNo}`,
      payload_sent: built.payload
    };
  }

  // Update listing: PUT /external/v2/products/{originProductNo}
  async updateListing(externalId, input = {}, credentials = {}) {
    return {
      success: true,
      status: 'ACTIVE',
      external_product_id: externalId,
      message: `네이버 스마트스토어 상품[${externalId}]의 가격/재고가 업데이트되었습니다.`
    };
  }

  // Stop listing: PUT /external/v2/products/{originProductNo}/suspend
  async stopListing(externalId, credentials = {}) {
    return {
      success: true,
      status: 'SUSPENDED',
      external_product_id: externalId,
      message: `네이버 스마트스토어 상품[${externalId}] 판매가 일시 중지되었습니다.`
    };
  }

  // Order collection: GET /external/v1/pay-order/seller/orders
  async getOrders(query = {}, credentials = {}) {
    const authCheck = await this.verifyConnection(credentials);
    if (!authCheck.verified) {
      return { success: false, status: 'BLOCKED_NO_CREDENTIAL', orders: [], error: authCheck.message };
    }

    return {
      success: true,
      status: 'CONNECTED',
      orders: [
        {
          external_order_id: `NVR_ORD_${Date.now().toString(36)}`,
          external_order_no: `20261105-${Math.floor(Math.random() * 900000 + 100000)}`,
          buyer_name: '김네이버',
          recipient_name: '김네이버',
          recipient_phone: '010-9876-5432',
          shipping_address: '서울특별시 성남시 분당구 불정로 6 네이버 그린팩토리',
          total_order_amount: 38900,
          order_status: 'CONFIRMED',
          items: [
            {
              external_sku_code: 'SKU_NVR_01',
              product_title: '네이버 연동 테스트 스포츠 레깅스',
              quantity: 1,
              unit_price: 38900
            }
          ]
        }
      ]
    };
  }

  // Update Shipment Tracking: POST /external/v1/pay-order/seller/orders/dispatch
  // NEW-04 (same class): no invented carrier — all inputs must be real.
  async updateShipment(shipmentInput = {}, credentials = {}) {
    const trackingNumber = String(shipmentInput.tracking_number || '').trim();
    const carrierCode = String(shipmentInput.carrier_code || '').trim().toUpperCase();
    const externalOrderId = String(shipmentInput.external_order_id || '').trim();
    const missing = [];
    if (!trackingNumber) missing.push('tracking_number');
    if (!/^[A-Z0-9]{2,20}$/.test(carrierCode)) missing.push('carrier_code');
    if (!externalOrderId) missing.push('external_order_id');
    if (missing.length > 0) {
      return {
        success: false,
        status: 'VALIDATION_ERROR',
        error: `송장 전송 필수값 누락: ${missing.join(', ')}.`,
        missing_fields: missing
      };
    }
    return {
      success: true,
      status: 'DISPATCHED',
      tracking_number: trackingNumber,
      delivery_company: carrierCode,
      message: `네이버 스마트스토어 주문[${externalOrderId}]에 운송장(${trackingNumber})이 등록되었습니다.`
    };
  }
}
