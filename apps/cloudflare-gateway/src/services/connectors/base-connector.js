// apps/cloudflare-gateway/src/services/connectors/base-connector.js
// Standardized CommerceConnector Base Architecture for Global OpenMarkets, B2B Suppliers, and 3PL Logistics.

export class BaseCommerceConnector {
  constructor(platformId, platformName, options = {}) {
    this.platformId = platformId;
    this.platformName = platformName;
    this.options = options;
    // true only for a connector that performs the real platform API call (see simulation.js). None does yet.
    this.isLive = false;
  }

  // 1. Authentication & Verification
  async authenticate(credentials) {
    throw new Error(`${this.platformName}: authenticate() not implemented.`);
  }

  async verifyConnection(credentials) {
    if (!credentials || (!credentials.apiKey && !credentials.accessToken && !credentials.secretKey)) {
      return {
        status: 'BLOCKED_NO_CREDENTIAL',
        verified: false,
        message: `[${this.platformName}] 정식 API 인증정보(API Key/Secret 또는 OAuth 토큰)가 등록되지 않았습니다.`
      };
    }
    // No request is made to the platform, so nothing can be claimed as verified.
    return {
      status: 'NOT_INTEGRATED',
      verified: false,
      message: `[${this.platformName}] 실제 API 연동이 구현되지 않아 인증정보를 검증하지 않았습니다.`
    };
  }

  // 2. Catalog Ingestion (MODEL A)
  async getProducts(query = {}) {
    return {
      success: false,
      status: 'NOT_SUPPORTED',
      message: `${this.platformName} 플랫폼은 공개 상품 목록 조회를 지원하지 않습니다.`
    };
  }

  async getProductDetail(externalId) {
    return {
      success: false,
      status: 'NOT_SUPPORTED',
      message: `${this.platformName} 플랫폼은 개별 상품 상세 조회를 지원하지 않습니다.`
    };
  }

  async getInventory(skus = []) {
    return {
      success: false,
      status: 'NOT_SUPPORTED',
      message: `${this.platformName} 플랫폼은 재고 조회를 지원하지 않습니다.`
    };
  }

  async getPrices(skus = []) {
    return {
      success: false,
      status: 'NOT_SUPPORTED',
      message: `${this.platformName} 플랫폼은 가격 조회를 지원하지 않습니다.`
    };
  }

  // 3. Multi-Channel Listing Distribution (MODEL B)
  async createListing(listingInput) {
    return {
      success: false,
      status: 'NOT_SUPPORTED',
      message: `${this.platformName} 플랫폼은 외부 상품 등록 API를 지원하지 않습니다.`
    };
  }

  async updateListing(externalId, listingInput) {
    return {
      success: false,
      status: 'NOT_SUPPORTED',
      message: `${this.platformName} 플랫폼은 상품 수정 API를 지원하지 않습니다.`
    };
  }

  async stopListing(externalId) {
    return {
      success: false,
      status: 'NOT_SUPPORTED',
      message: `${this.platformName} 플랫폼은 판매 중지 API를 지원하지 않습니다.`
    };
  }

  // 4. Order Ingestion & Management (MODEL B)
  async getOrders(query = {}) {
    return {
      success: false,
      status: 'NOT_SUPPORTED',
      orders: [],
      message: `${this.platformName} 플랫폼은 주문 수집 API를 지원하지 않습니다.`
    };
  }

  async getOrderDetail(orderId) {
    return {
      success: false,
      status: 'NOT_SUPPORTED',
      message: `${this.platformName} 플랫폼은 주문 상세 조회를 지원하지 않습니다.`
    };
  }

  // 5. Supplier PO Dispatch (MODEL A & MODEL C)
  async createSupplierOrder(poInput) {
    return {
      success: false,
      status: 'NOT_SUPPORTED',
      message: `${this.platformName} 플랫폼은 공급업체 자동 발주 API를 지원하지 않습니다.`
    };
  }

  async cancelSupplierOrder(supplierOrderId) {
    return {
      success: false,
      status: 'NOT_SUPPORTED',
      message: `${this.platformName} 플랫폼은 공급업체 발주 취소를 지원하지 않습니다.`
    };
  }

  // 6. Fulfillment & 3PL Logistics (MODEL C)
  async updateShipment(shipmentInput) {
    return {
      success: false,
      status: 'NOT_SUPPORTED',
      message: `${this.platformName} 플랫폼은 배송 송장 등록 API를 지원하지 않습니다.`
    };
  }

  async getReturns(query = {}) {
    return {
      success: false,
      status: 'NOT_SUPPORTED',
      returns: [],
      message: `${this.platformName} 플랫폼은 반품 조회 API를 지원하지 않습니다.`
    };
  }

  async getSettlements(query = {}) {
    return {
      success: false,
      status: 'NOT_SUPPORTED',
      settlements: [],
      message: `${this.platformName} 플랫폼은 정산내역 조회 API를 지원하지 않습니다.`
    };
  }
}

