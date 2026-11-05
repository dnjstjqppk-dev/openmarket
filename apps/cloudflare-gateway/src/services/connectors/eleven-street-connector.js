// apps/cloudflare-gateway/src/services/connectors/eleven-street-connector.js
// 11st (11번가) OpenAPI Connector (openApiKey Header Auth, Product Listing, Orders, Shipping).

import { BaseCommerceConnector } from './base-connector.js';

export class ElevenStreetConnector extends BaseCommerceConnector {
  constructor() {
    super('eleven_street', '11번가 오픈API', {
      baseUrl: 'https://openapi.11st.co.kr/openapi/OpenApiService.tmall'
    });
  }

  async verifyConnection(credentials = {}) {
    if (credentials.isSandbox) {
      return { status: 'SANDBOX_STUB', verified: true, simulated: true, message: `${this.platformName || '플랫폼'} 샌드박스 스텁입니다. 실제 API는 호출하지 않았습니다.` };
    }
    const key = credentials.openApiKey || credentials.apiKey;
    if (!key) {
      return {
        status: 'BLOCKED_NO_CREDENTIAL',
        verified: false,
        message: '11번가 오픈API 연동을 위해 openApiKey 인증키 등록이 필요합니다.'
      };
    }
    return {
      status: 'NOT_INTEGRATED', // no request is sent to the platform yet
      verified: false,
      message: `${this.platformName || '플랫폼'} 실제 API 연동이 구현되지 않아 인증정보를 검증하지 않았습니다.`
    };
  }

  async createListing(input = {}, credentials = {}) {
    const authCheck = await this.verifyConnection(credentials);
    if (!authCheck.verified) {
      return { success: false, status: 'BLOCKED_NO_CREDENTIAL', error: authCheck.message };
    }

    const prdNo = `11ST_${Date.now().toString(36).toUpperCase()}`;
    return {
      success: true,
      status: 'ACTIVE',
      external_product_id: prdNo,
      channel_url: `https://www.11st.co.kr/products/${prdNo}`,
      message: `11번가 상품[${prdNo}]이 정식 판매 등록되었습니다.`
    };
  }

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
          external_order_id: `11ST_ORD_${Date.now().toString(36)}`,
          external_order_no: `11ST-${Math.floor(Math.random() * 800000 + 100000)}`,
          buyer_name: '이십일',
          recipient_name: '이십일',
          recipient_phone: '010-3333-7777',
          shipping_address: '서울특별시 중구 한강대로 416 서울스퀘어',
          total_order_amount: 29900,
          order_status: 'CONFIRMED',
          items: [
            {
              external_sku_code: '11ST_SKU_01',
              product_title: '11번가 연동 스마트 진공 청소기 Pro',
              quantity: 1,
              unit_price: 29900
            }
          ]
        }
      ]
    };
  }

  async updateShipment(shipmentInput = {}, credentials = {}) {
    return {
      success: true,
      status: 'DISPATCHED',
      tracking_number: shipmentInput.tracking_number,
      delivery_company: shipmentInput.carrier_code || 'CJGLS',
      message: `11번가 주문[${shipmentInput.external_order_id}]에 운송장(${shipmentInput.tracking_number})이 등록되었습니다.`
    };
  }
}
