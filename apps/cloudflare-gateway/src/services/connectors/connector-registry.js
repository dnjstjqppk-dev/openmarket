// apps/cloudflare-gateway/src/services/connectors/connector-registry.js
// Central Registry and Factory for all Global OpenMarket Connectors, B2B Suppliers, and Logistics Providers.

import { NaverCommerceConnector } from './naver-connector.js';
import { CoupangWingConnector } from './coupang-connector.js';
import { ElevenStreetConnector } from './eleven-street-connector.js';
import { AmazonSpApiConnector } from './amazon-sp-connector.js';
import { DomesticB2BSupplierConnector } from './domestic-b2b-connector.js';
import { Global3plLogisticsConnector } from './logistics-3pl-connector.js';
import { BaseCommerceConnector } from './base-connector.js';

class GenericOpenMarketConnector extends BaseCommerceConnector {
  constructor(platformId, platformName) {
    super(platformId, platformName);
  }
}

export class ConnectorRegistry {
  constructor() {
    this.connectors = new Map();

    // Register specialized connectors
    this.register('naver_smartstore', new NaverCommerceConnector());
    this.register('coupang_wing', new CoupangWingConnector());
    this.register('eleven_street', new ElevenStreetConnector());
    this.register('amazon_sp_api', new AmazonSpApiConnector());
    this.register('domeggook_domeme', new DomesticB2BSupplierConnector('domeggook_domeme', '도매꾹/도매매 B2B 공급망'));
    this.register('onchannel_b2b', new DomesticB2BSupplierConnector('onchannel_b2b', '온채널 위탁배송 B2B'));
    this.register('ownerclan_b2b', new DomesticB2BSupplierConnector('ownerclan_b2b', '오너클랜 B2B 공급망'));
    this.register('3pl_logistics', new Global3plLogisticsConnector());

    // Register generic connectors for other verified platforms
    const others = [
      ['gmarket_auction', 'G마켓/옥션 ESM 2.0'],
      ['lotte_on', '롯데온 오픈API'],
      ['ssg_com', 'SSG.COM 파트너API'],
      ['ebay_rest', 'eBay REST APIs'],
      ['aliexpress_open', 'AliExpress Open Platform'],
      ['temu_partner', 'Temu Partner Portal'],
      ['shopee_v2', 'Shopee Open Platform API v2'],
      ['lazada_open', 'Lazada Open Platform'],
      ['walmart_marketplace', 'Walmart Marketplace API'],
      ['tiktok_shop', 'TikTok Shop Partner API'],
      ['alibaba_1688', '1688 / Alibaba B2B Sourcing']
    ];

    for (const [id, name] of others) {
      this.register(id, new GenericOpenMarketConnector(id, name));
    }
  }

  register(platformId, connector) {
    this.connectors.set(platformId, connector);
  }

  get(platformId) {
    const conn = this.connectors.get(platformId);
    if (!conn) {
      return new GenericOpenMarketConnector(platformId, `플랫폼(${platformId})`);
    }
    return conn;
  }

  listRegisteredPlatforms() {
    return Array.from(this.connectors.keys());
  }
}

export const registry = new ConnectorRegistry();
