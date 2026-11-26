// apps/cloudflare-gateway/src/route-table.js
// Ordered router table with first-segment dispatch.
//
// Why: V8 compiles a function lazily on its first call in each isolate. The
// gateway used to call every router in order until one answered, so the first
// request an isolate served compiled up to ~35 routers (admin.js / partner.js
// are ~2,000-line functions) — 12–22 ms CPU measured in production on routes
// late in the chain (catalog, admin, unknown paths) versus 1–2 ms for early ones.
// Now a request only invokes routers whose `prefixes` could match its first
// path segment after /api/v1/, in the same order as before.
//
// Contract (enforced by tests/route_dispatch_test.mjs):
//   - every '/api/v1/<seg>' literal in a router's file is covered by one of its
//     prefixes (prefix match: 'admin' also covers 'admin-users');
//   - routers only match /api/v1/* paths (everything else is a 404 here; the
//     crawl surface is served by handleSeoRoutes before this table);
//   - the dispatched result equals the old full scan for the whole path corpus.
// Adding a router or a new top-level segment: update its `prefixes` here.

import { handleAdminSecurityRoutes } from './routes/admin-security.js';
import { handleAuthRoutes } from './routes/auth.js';
import { handleSocialAuthRoutes } from './routes/social-auth.js';
import { handleOnboardingRoutes } from './routes/onboarding.js';
import { handleBusinessRoutes } from './routes/business.js';
import { handleLegalRoutes } from './routes/legal.js';
import { handlePaymentRoutes } from './routes/payments.js';
import { handleFinanceRoutes } from './routes/finance.js';
import { handleSupplierRoutes } from './routes/suppliers.js';
import { handleSourcingRoutes } from './routes/sourcing.js';
import { handleSourcingOpsRoutes } from './routes/sourcing-ops.js';
import { handleSupplier3plRoutes } from './routes/supplier-3pl.js';
import { handleProductImportRoutes } from './routes/product-imports.js';
import { handleFeatureFlagRoutes } from './routes/feature-flags.js';
import { handleMultiChannelRoutes } from './routes/multichannel.js';
import { handleChannelPublishRoutes } from './routes/channel-publish.js';
import { handleChannelsOpsRoutes } from './routes/channels-ops.js';
import { handleChannelOrderRoutes } from './routes/channel-orders.js';
import { handleFulfillmentOpsRoutes } from './routes/fulfillment-ops.js';
import { handleSeoOpsRoutes } from './routes/seo-ops.js';
import { handleBiddingAndM2cRoutes } from './routes/bidding-m2c.js';
import { handleGlobalCustomsAndFxRoutes } from './routes/global-customs-fx.js';
import { handleGlobalLogisticsRoutes } from './routes/global-logistics.js';
import { handleGlobalGovernanceRoutes } from './routes/global-governance.js';
import { handleStorageRoutes } from './routes/storage.js';
import { handleTemuOpsRoutes } from './routes/temu-ops.js';
import { handleFeatureRoutes } from './routes/features.js';
import { handlePushRoutes } from './routes/push.js';
import { handleRecommendRoutes } from './routes/recommend.js';
import { handleShippingRoutes } from './routes/shipping.js';
import { handleCatalogFullRoutes } from './routes/catalog-full.js';
import { handleCatalogRoutes } from './routes/catalog.js';
import { handleOrderRoutes } from './routes/orders.js';
import { handlePartnerRoutes } from './routes/partner.js';
import { handleAdminRoutes } from './routes/admin.js';
import { handleIntegrationRoutes } from './routes/integrations.js';
import { handleClientErrorRoutes } from './routes/client-errors.js';
import { handleTranslationRoutes } from './routes/translations.js';

export const API_PREFIX = '/api/v1/';

// Order is significant and unchanged from the original ROUTERS list.
export const ROUTE_TABLE = [
  // /auth/2fa/* and /admin/admin-users before the generic auth/admin routers
  { file: 'admin-security', handler: handleAdminSecurityRoutes, prefixes: ['admin', 'auth'] },
  { file: 'auth', handler: handleAuthRoutes, prefixes: ['auth'] },
  { file: 'social-auth', handler: handleSocialAuthRoutes, prefixes: ['auth'] },
  // before partner/admin routers: '/api/v1/partner-applications' shares their prefixes
  // 2026-11-27: seller translations + public localized slug (before partner/catalog claim the prefixes)
  { file: 'translations', handler: handleTranslationRoutes, prefixes: ['partner', 'products'] },
  { file: 'onboarding', handler: handleOnboardingRoutes, prefixes: ['admin', 'onboarding', 'partner'] },
  { file: 'business', handler: handleBusinessRoutes, prefixes: ['admin', 'business-info'] },
  { file: 'legal', handler: handleLegalRoutes, prefixes: ['legal'] },
  { file: 'payments', handler: handlePaymentRoutes, prefixes: ['payments'] },
  { file: 'finance', handler: handleFinanceRoutes, prefixes: ['admin', 'finance'] },
  { file: 'suppliers', handler: handleSupplierRoutes, prefixes: ['admin', 'orders'] },
  { file: 'sourcing', handler: handleSourcingRoutes, prefixes: ['admin'] },
  { file: 'sourcing-ops', handler: handleSourcingOpsRoutes, prefixes: ['admin'] },
  { file: 'supplier-3pl', handler: handleSupplier3plRoutes, prefixes: ['admin', 'integrations', 'supplier-orders', 'sync'] },
  { file: 'product-imports', handler: handleProductImportRoutes, prefixes: ['admin', 'imports', 'storage'] },
  { file: 'feature-flags', handler: handleFeatureFlagRoutes, prefixes: ['admin', 'feature-flags'] },
  { file: 'multichannel', handler: handleMultiChannelRoutes, prefixes: ['channels'] },
  { file: 'channel-publish', handler: handleChannelPublishRoutes, prefixes: ['admin'] },
  { file: 'channels-ops', handler: handleChannelsOpsRoutes, prefixes: ['admin'] },
  { file: 'channel-orders', handler: handleChannelOrderRoutes, prefixes: ['admin'] },
  { file: 'fulfillment-ops', handler: handleFulfillmentOpsRoutes, prefixes: ['admin'] },
  { file: 'seo-ops', handler: handleSeoOpsRoutes, prefixes: ['admin'] },
  { file: 'bidding-m2c', handler: handleBiddingAndM2cRoutes, prefixes: ['admin', 'bidding', 'partner', 'pricing'] },
  { file: 'global-customs-fx', handler: handleGlobalCustomsAndFxRoutes, prefixes: ['admin', 'customs', 'fx', 'orders'] },
  { file: 'global-logistics', handler: handleGlobalLogisticsRoutes, prefixes: ['logistics'] },
  { file: 'global-governance', handler: handleGlobalGovernanceRoutes, prefixes: ['admin'] },
  { file: 'storage', handler: handleStorageRoutes, prefixes: ['storage'] },
  { file: 'temu-ops', handler: handleTemuOpsRoutes, prefixes: ['admin', 'ipr', 'orders', 'partner', 'products'] },
  {
    file: 'features',
    handler: handleFeatureRoutes,
    prefixes: ['addresses', 'banners', 'campaigns', 'cart', 'coupons', 'credits', 'me', 'notifications', 'products',
      'restock-subscriptions', 'reviews', 'search', 'stores', 'support', 'wishlist']
  },
  { file: 'push', handler: handlePushRoutes, prefixes: ['admin', 'push'] },
  { file: 'recommend', handler: handleRecommendRoutes, prefixes: ['products', 'recommendations'] },
  { file: 'shipping', handler: handleShippingRoutes, prefixes: ['admin', 'shipping'] },
  { file: 'catalog-full', handler: handleCatalogFullRoutes, prefixes: ['catalog'] },
  {
    file: 'catalog',
    handler: handleCatalogRoutes,
    prefixes: ['campaigns', 'categories', 'deals', 'exhibitions', 'partners', 'products', 'search']
  },
  { file: 'orders', handler: handleOrderRoutes, prefixes: ['orders'] },
  { file: 'partner', handler: handlePartnerRoutes, prefixes: ['partner', 'storage'] },
  { file: 'admin', handler: handleAdminRoutes, prefixes: ['admin'] },
  { file: 'integrations', handler: handleIntegrationRoutes, prefixes: ['integrations'] },
  { file: 'client-errors', handler: handleClientErrorRoutes, prefixes: ['client-errors'] }
];

const cache = new Map();

/** Routers that may answer `pathname`, in table order (empty outside /api/v1/). */
export function routersFor(pathname) {
  if (!pathname.startsWith(API_PREFIX)) return [];
  const seg = pathname.slice(API_PREFIX.length).split('/', 1)[0];
  let list = cache.get(seg);
  if (!list) {
    list = ROUTE_TABLE.filter((r) => r.prefixes.some((p) => seg.startsWith(p))).map((r) => r.handler);
    // Unbounded segments come from the client; cache only known-useful keys.
    if (list.length && cache.size < 256) cache.set(seg, list);
  }
  return list;
}
