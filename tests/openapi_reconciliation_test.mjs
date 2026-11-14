// tests/openapi_reconciliation_test.mjs
// Guards docs/openapi against implementation drift: every documented path must
// resolve to a live gateway route, and the six retired stale paths must stay
// out of the docs (and keep answering 404). Doc-driven: the path/method table
// is parsed from docs/openapi/openapi.yaml + docs/openapi/paths/*.yaml, then
// probed against a real gateway harness. See P1 OpenAPI reconcilation (2026-11-07).
//
// Auth discriminator: guarded routes run requireAuth AFTER the prefix match, so an
// unauthenticated probe answers 401 when the prefix is served at all. That proves
// documented routes exist (test 1), but dead sub-paths under /partner and /admin
// need an authenticated probe to reach the 404 fall-through (test 2).

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGateway, createRunner } from './lib/harness.mjs';

const t = createRunner('OpenAPI Reconciliation');
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

// The documented contract surface. Any docs edit that adds/removes a path must
// update this allowlist in the same commit.
const EXPECTED = [
  // [path-template, method, unauthenticated expectation]
  ['/api/v1/auth/login', 'POST', 400],
  ['/api/v1/auth/register', 'POST', 400],
  ['/api/v1/auth/me', 'GET', 401],
  ['/api/v1/payments/config', 'GET', 200],
  ['/api/v1/payments/confirm', 'POST', 401],
  ['/api/v1/orders/quote', 'POST', 401],
  ['/api/v1/orders', 'GET', 401],
  ['/api/v1/orders/{id}', 'GET', 401],
  ['/api/v1/orders/{id}/cancel', 'POST', 401],
  ['/api/v1/orders/{id}/sub-orders/{subId}/cancel', 'POST', 401],
  ['/api/v1/orders/{id}/confirm', 'POST', 401],
  ['/api/v1/orders/{id}/tracking', 'GET', 401],
  ['/api/v1/orders/{id}/claims', 'POST', 401],
  ['/api/v1/channels/suppliers', 'GET', 401],
  ['/api/v1/channels/carriers', 'GET', 401],
  ['/api/v1/partner/orders', 'GET', 401],
  ['/api/v1/partner/metrics', 'GET', 401],
  ['/api/v1/products', 'GET', 200],
  ['/api/v1/products/{id}', 'GET', 200],
  ['/api/v1/orders/checkout', 'POST', 401],
  ['/api/v1/campaigns/lightning', 'GET', 200],
  ['/api/v1/search/autocomplete', 'GET', 200],
  ['/api/v1/search/log', 'POST', 200],
  ['/api/v1/partner/products', 'POST', 401],
  ['/api/v1/partner/products/bulk', 'POST', 401],
  ['/api/v1/partner/orders/{id}/shipment', 'PUT', 401],
  ['/api/v1/partner/orders/bulk-shipment', 'POST', 401],
  ['/api/v1/partner/settlements', 'GET', 401],
  ['/api/v1/partner/tax-invoices', 'GET', 401],
  ['/api/v1/storage/upload', 'POST', 401],
  ['/api/v1/admin/partners/{id}/verify', 'PUT', 401],
  ['/api/v1/admin/users/{id}/reset-password', 'POST', 401],
  ['/api/v1/admin/finance/payouts', 'GET', 401],
  ['/api/v1/admin/finance/payouts', 'POST', 401],
  ['/api/v1/auth/profile', 'PUT', 401],
  ['/api/v1/auth/privacy/export', 'GET', 401],
  ['/api/v1/auth/withdraw/precheck', 'GET', 401],
  ['/api/v1/auth/withdraw', 'POST', 401],
  ['/api/v1/auth/logout-all', 'POST', 401],
  ['/api/v1/auth/forgot-password', 'POST', 400],
  ['/api/v1/auth/reset-password', 'POST', 400],
  ['/api/v1/auth/send-verification', 'POST', 401],
  ['/api/v1/auth/verify-email', 'POST', 400],
  ['/api/v1/auth/social-login', 'POST', 501],
  ['/api/v1/auth/social/kakao/start', 'GET', 501],
  ['/api/v1/auth/social/kakao/callback', 'GET', 501],
  ['/api/v1/auth/social/kakao/exchange', 'POST', 400],
  ['/api/v1/auth/2fa/setup', 'POST', 401],
  ['/api/v1/auth/2fa/enable', 'POST', 401],
  ['/api/v1/categories', 'GET', 200],
  ['/api/v1/categories/{slug}', 'GET', 200],
  ['/api/v1/products/{id}/buy-box', 'GET', 200],
  ['/api/v1/partners/{id}/store', 'GET', 200],
  ['/api/v1/products/{id}/live-activity', 'GET', 200],
  ['/api/v1/search/visual-similarity', 'POST', 501],
  ['/api/v1/deals/lightning', 'GET', 410],
  ['/api/v1/products/{id}/reviews', 'GET', 200],
  ['/api/v1/products/{id}/reviews', 'POST', 401],
  ['/api/v1/products/{id}/qna', 'GET', 200],
  ['/api/v1/products/{id}/qna', 'POST', 401],
  ['/api/v1/products/{id}/view', 'POST', 401],
  ['/api/v1/recommendations/related', 'GET', 400],
  ['/api/v1/recommendations/for-you', 'GET', 200],
  ['/api/v1/recommendations/cart-bundle', 'GET', 400],
  ['/api/v1/shipping/remote-zones', 'GET', 200],
  ['/api/v1/admin/shipping/remote-zones', 'GET', 401],
  ['/api/v1/admin/shipping/remote-zones', 'PUT', 401],
  ['/api/v1/admin/shipping/remote-zones/{prefix}', 'DELETE', 401],
  ['/api/v1/customs/validate-pccc', 'POST', 401],
  ['/api/v1/fx/rates', 'GET', 200],
  ['/api/v1/customs/estimate-duty', 'POST', 200],
  ['/api/v1/fx/convert', 'POST', 200],
  ['/api/v1/logistics/carriers', 'GET', 200],
  ['/api/v1/logistics/tracking/{subId}', 'GET', 401],
  ['/api/v1/logistics/milestone-webhook', 'POST', 503],
  ['/api/v1/channels/platforms', 'GET', 200],
  ['/api/v1/channels/sales-channels', 'GET', 200],
  ['/api/v1/channels/credentials', 'GET', 401],
  ['/api/v1/channels/credentials', 'POST', 401],
  ['/api/v1/channels/credentials/{id}/verify', 'POST', 401],
  ['/api/v1/channels/pricing/calculate', 'POST', 400],
  ['/api/v1/channels/listings/publish', 'POST', 401],
  ['/api/v1/channels/listings', 'GET', 401],
  ['/api/v1/channels/orders/sync', 'POST', 401],
  ['/api/v1/channels/orders', 'GET', 401],
  ['/api/v1/channels/orders/{id}/dispatch-po', 'POST', 401],
  ['/api/v1/channels/orders/{id}/fulfill', 'POST', 401],
  ['/api/v1/channels/webhooks/{platform}', 'POST', 501],
  ['/api/v1/orders/cron/auto-confirm', 'POST', 401],
  ['/api/v1/orders/cron/expire', 'POST', 401],
  ['/api/v1/orders/{id}/commercial-invoice', 'GET', 401],
  ['/api/v1/orders/{id}/late-delivery-claim', 'POST', 401],
  ['/api/v1/payments/webhook', 'POST', 503],
  ['/api/v1/partner/profile', 'GET', 401],
  ['/api/v1/partner/profile', 'PUT', 401],
  ['/api/v1/partner/products', 'GET', 401],
  ['/api/v1/partner/products/{id}', 'PUT', 401],
  ['/api/v1/partner/products/{id}/price', 'PUT', 401],
  ['/api/v1/partner/products/{id}/stock', 'PUT', 401],
  ['/api/v1/partner/orders/{id}/prepare', 'POST', 401],
  ['/api/v1/partner/qna', 'GET', 401],
  ['/api/v1/partner/qna/{id}/answer', 'POST', 401],
  ['/api/v1/partner/returns', 'GET', 401],
  ['/api/v1/partner/returns/{id}/reship', 'POST', 401],
  ['/api/v1/partner/returns/{id}', 'PUT', 401],
  ['/api/v1/coupons', 'GET', 200],
  ['/api/v1/coupons/claim', 'POST', 401],
  ['/api/v1/credits', 'GET', 401],
  ['/api/v1/wishlist', 'GET', 401],
  ['/api/v1/wishlist', 'POST', 401],
  ['/api/v1/cart', 'GET', 401],
  ['/api/v1/cart', 'PUT', 401],
  ['/api/v1/support/faq', 'GET', 200],
  ['/api/v1/support/inquiries', 'GET', 401],
  ['/api/v1/support/inquiries', 'POST', 401],
  ['/api/v1/banners', 'GET', 200],
  ['/api/v1/addresses', 'GET', 401],
  ['/api/v1/addresses', 'POST', 401],
  ['/api/v1/addresses/{id}/default', 'PUT', 401],
  ['/api/v1/addresses/{id}', 'DELETE', 401],
  ['/api/v1/notifications', 'GET', 401],
  ['/api/v1/notifications/dispatch', 'POST', 401],
  ['/api/v1/notifications/read-all', 'PUT', 401],
  ['/api/v1/notifications/{id}/read', 'PUT', 401],
  ['/api/v1/push/tokens', 'POST', 401],
  ['/api/v1/push/tokens', 'DELETE', 401],
  ['/api/v1/admin/push/broadcast', 'POST', 401],
  ['/api/v1/admin/push/stats', 'GET', 401],
  ['/api/v1/admin/dashboard', 'GET', 401],
  ['/api/v1/admin/reviews', 'GET', 401],
  ['/api/v1/admin/reviews/{id}', 'DELETE', 401],
  ['/api/v1/admin/users', 'GET', 401],
  ['/api/v1/admin/privacy/access-log', 'GET', 401],
  ['/api/v1/admin/audit-log', 'GET', 401],
  ['/api/v1/admin/inquiries', 'GET', 401],
  ['/api/v1/admin/inquiries/{id}/reply', 'POST', 401],
  ['/api/v1/admin/partners', 'GET', 401],
  ['/api/v1/admin/products', 'GET', 401],
  ['/api/v1/admin/products/{id}/status', 'PUT', 401],
  ['/api/v1/admin/products/{id}/review', 'POST', 401],
  ['/api/v1/admin/partners/{id}/payout-account', 'POST', 401],
  ['/api/v1/admin/orders', 'GET', 401],
  ['/api/v1/admin/ledger', 'GET', 401],
  ['/api/v1/admin/settlements/{id}/approve', 'POST', 401],
  ['/api/v1/admin/claims', 'GET', 401],
  ['/api/v1/admin/claims/{id}', 'PUT', 401],
  ['/api/v1/admin/banners', 'GET', 401],
  ['/api/v1/admin/banners', 'POST', 401],
  ['/api/v1/admin/banners/{id}', 'PUT', 401],
  ['/api/v1/admin/banners/{id}', 'DELETE', 401],
  ['/api/v1/admin/notifications', 'GET', 401],
  ['/api/v1/admin/notifications', 'POST', 401],
  ['/api/v1/admin/coupons', 'GET', 401],
  ['/api/v1/admin/coupons', 'POST', 401],
  ['/api/v1/admin/coupons/{id}', 'DELETE', 401],
  ['/api/v1/admin/categories', 'GET', 401],
  ['/api/v1/admin/categories', 'POST', 401],
  ['/api/v1/admin/categories/{id}', 'DELETE', 401],
  ['/api/v1/admin/admin-users', 'GET', 401],
  ['/api/v1/admin/admin-users', 'POST', 401],
  ['/api/v1/admin/admin-users/{id}', 'PUT', 401],
  ['/api/v1/finance/cash-receipts/request', 'POST', 401],
  ['/api/v1/finance/cash-receipts', 'GET', 401],
  ['/api/v1/finance/cash-receipts/{id}/cancel', 'POST', 401],
  ['/api/v1/finance/cash-receipts/{id}', 'GET', 401],
  ['/api/v1/finance/tax-invoices', 'GET', 401],
  ['/api/v1/admin/finance/cash-receipts/{id}/issue', 'POST', 401],
  ['/api/v1/admin/finance/cash-receipts/{id}/fail', 'POST', 401],
  ['/api/v1/admin/finance/cash-receipts/{id}/cancel-record', 'POST', 401],
  ['/api/v1/admin/finance/sales-report', 'GET', 401],
  ['/api/v1/admin/finance/tax-invoices', 'POST', 401],
  ['/api/v1/admin/finance/tax-invoices/{id}/issue', 'POST', 401],
  ['/api/v1/admin/finance/tax-invoices/{id}/fail', 'POST', 401],
  ['/api/v1/admin/reconciliation', 'GET', 401],
  ['/api/v1/admin/finance/reconciliation-runs', 'GET', 401],
  ['/api/v1/admin/finance/reserve-holds', 'GET', 401],
  ['/api/v1/admin/finance/trial-balance', 'GET', 401],
  ['/api/v1/admin/finance/journal', 'GET', 401],
  ['/api/v1/admin/finance/payouts/{id}/transferred', 'POST', 401],
  ['/api/v1/admin/orders/{id}/refund', 'POST', 401],
  ['/api/v1/admin/sub-orders/{id}/delivered', 'POST', 401],
  ['/api/v1/business-info', 'GET', 200],
  ['/api/v1/admin/business-entities', 'GET', 401],
  ['/api/v1/admin/business-entities', 'POST', 401],
  ['/api/v1/admin/business-entities/{id}', 'PUT', 401],
  ['/api/v1/admin/business-entities/{id}/obligations', 'GET', 401],
  ['/api/v1/admin/business-entities/{id}/events', 'GET', 401],
  ['/api/v1/admin/business-entities/{id}/activate', 'POST', 401],
  ['/api/v1/admin/suppliers', 'GET', 401],
  ['/api/v1/admin/suppliers', 'POST', 401],
  ['/api/v1/admin/suppliers/{id}/mappings', 'GET', 401],
  ['/api/v1/admin/suppliers/{id}', 'PUT', 401],
  ['/api/v1/admin/supplier-mappings', 'POST', 401],
  ['/api/v1/admin/purchase-orders', 'GET', 401],
  ['/api/v1/admin/purchase-orders/{id}/status', 'PUT', 401],
  ['/api/v1/admin/partners/{id}/sales-model', 'PUT', 401],
  ['/api/v1/supplier-orders', 'POST', 401],
  ['/api/v1/supplier-orders', 'GET', 401],
  ['/api/v1/admin/supplier-orders', 'GET', 401],
  ['/api/v1/supplier-orders/{id}/respond', 'POST', 401],
  ['/api/v1/supplier-orders/{id}/dispatch', 'POST', 401],
  ['/api/v1/sync/supplier-inventory', 'POST', 401],
  ['/api/v1/integrations/health', 'GET', 401],
  ['/api/v1/admin/sync/logs', 'GET', 401],
  ['/api/v1/sync/logs', 'GET', 401],
  ['/api/v1/auth/refresh', 'POST', 400],
  ['/api/v1/integrations/pricescanner/feed', 'GET', 401],
  ['/api/v1/integrations/selbym/status', 'GET', 200],
  ['/api/v1/admin/logistics/consolidate', 'POST', 401],
  ['/api/v1/imports/crawl', 'POST', 401],
  ['/api/v1/imports/jobs', 'GET', 401],
  ['/api/v1/imports/{id}/ai-enhance', 'POST', 401],
  ['/api/v1/imports/{id}', 'GET', 401],
  ['/api/v1/imports/{id}/publish', 'POST', 401],
  ['/api/v1/imports/bulk', 'POST', 401],
  ['/api/v1/admin/imports/jobs', 'GET', 401],
  ['/api/v1/partner/sample-qc', 'GET', 401],
  ['/api/v1/partner/sample-qc', 'POST', 401],
  ['/api/v1/admin/sample-qc', 'GET', 401],
  ['/api/v1/admin/sample-qc/{id}/inspect', 'POST', 401],
  ['/api/v1/ipr/report', 'POST', 401],
  ['/api/v1/admin/ipr-reports', 'GET', 401],
  ['/api/v1/admin/feature-flags', 'GET', 401],
  ['/api/v1/admin/feature-flags/{key}/toggle', 'POST', 401],
  ['/api/v1/feature-flags/public', 'GET', 200],
  ['/api/v1/bidding/campaigns', 'GET', 200],
  ['/api/v1/bidding/campaigns', 'POST', 401],
  ['/api/v1/bidding/my-bids', 'GET', 401],
  ['/api/v1/bidding/campaigns/{id}', 'GET', 404],
  ['/api/v1/bidding/campaigns/{id}/bids', 'POST', 401],
  ['/api/v1/admin/bidding/campaigns/{id}/award', 'POST', 401],
  ['/api/v1/pricing/negotiations', 'GET', 404],
  ['/api/v1/admin/pricing/negotiations', 'POST', 401],
  ['/api/v1/partner/pricing/negotiations/{id}/respond', 'POST', 401],
  ['/api/v1/onboarding/validate-business', 'POST', 400],
  ['/api/v1/partner-applications', 'POST', 400],
  ['/api/v1/partner/application', 'GET', 401],
  ['/api/v1/partner/application/documents', 'POST', 401],
  ['/api/v1/partner/application/submit', 'POST', 401],
  ['/api/v1/admin/partner-applications', 'GET', 401],
  ['/api/v1/admin/partner-applications/{id}/review', 'POST', 401],
  ['/api/v1/admin/control-tower', 'GET', 401],
  ['/api/v1/admin/fds/overview', 'GET', 401],
  ['/api/v1/admin/fds/evaluate', 'POST', 401],
  ['/api/v1/admin/fds/reviews', 'GET', 401],
  ['/api/v1/admin/fds/reviews/{id}/clear', 'POST', 401],
  ['/api/v1/admin/fds/reviews/{id}/fraud', 'POST', 401],
  ['/api/v1/admin/fds/prohibited-hs', 'GET', 401],
  ['/api/v1/admin/fds/prohibited-hs', 'POST', 401],
  ['/api/v1/admin/fds/prohibited-hs/{id}', 'DELETE', 401],
  ['/api/v1/admin/disputes', 'GET', 401],
  ['/api/v1/admin/disputes/{id}/arbitrate', 'POST', 401],
  ['/api/v1/storage/file/{fileKey}', 'GET', 404],
  ['/api/v1/client-errors', 'POST', 400],
  // 2-9 buyer
  ['/api/v1/coupons/best', 'POST', 401],
  ['/api/v1/reviews/{id}/helpful', 'POST', 401],
  ['/api/v1/reviews/{id}/report', 'POST', 401],
  ['/api/v1/stores/{partnerId}/follow', 'POST', 401],
  ['/api/v1/stores/{partnerId}/follow', 'DELETE', 401],
  ['/api/v1/me/followed-stores', 'GET', 401],
  ['/api/v1/me/recently-viewed', 'GET', 401],
  ['/api/v1/me/recently-viewed/merge', 'POST', 401],
  ['/api/v1/me/recently-viewed/{productId}', 'DELETE', 401],
  ['/api/v1/restock-subscriptions', 'POST', 401],
  ['/api/v1/restock-subscriptions', 'DELETE', 401],
  ['/api/v1/products/facets', 'GET', 200],
  ['/api/v1/products/{id}/coupons', 'GET', 200],
  ['/api/v1/products/{id}/price-history', 'GET', 200],
  ['/api/v1/exhibitions', 'GET', 200],
  ['/api/v1/exhibitions/{id}', 'GET', 404],
  ['/api/v1/search/trending', 'GET', 200],
  // 2-9 partner
  ['/api/v1/partner/dashboard/pipeline', 'GET', 401],
  ['/api/v1/partner/orders/{id}/contact', 'GET', 401],
  ['/api/v1/partner/orders/confirm', 'PUT', 401],
  ['/api/v1/partner/orders/{id}/delay-notice', 'PUT', 401],
  ['/api/v1/partner/shipping-policies', 'GET', 401],
  ['/api/v1/partner/shipping-policies', 'POST', 401],
  ['/api/v1/partner/shipping-policies/{id}', 'PUT', 401],
  ['/api/v1/partner/shipping-policies/{id}', 'DELETE', 401],
  ['/api/v1/partner/products/bulk-update', 'PUT', 401],
  ['/api/v1/partner/coupons', 'GET', 401],
  ['/api/v1/partner/coupons', 'POST', 401],
  ['/api/v1/partner/coupons/{id}', 'PUT', 401],
  ['/api/v1/partner/flash-sales', 'GET', 401],
  ['/api/v1/partner/flash-sales/{id}/apply', 'POST', 401],
  ['/api/v1/partner/payout-requests', 'GET', 401],
  ['/api/v1/partner/payout-requests', 'POST', 401],
  ['/api/v1/partner/payout-requests/{id}/cancel', 'POST', 401],
  ['/api/v1/partner/store-profile', 'GET', 401],
  ['/api/v1/partner/store-profile', 'PUT', 401],
  ['/api/v1/partner/reviews/{id}/reply', 'PUT', 401],
  ['/api/v1/partner/reviews/{id}/reply', 'DELETE', 401],
  ['/api/v1/partner/reviews/{id}/report', 'POST', 401],
  ['/api/v1/partner/penalties', 'GET', 401],
  ['/api/v1/partner/penalties/{id}/appeal', 'POST', 401],
  ['/api/v1/partner/returns/{id}/pickup', 'PUT', 401],
  ['/api/v1/partner/returns/{id}/inspect', 'PUT', 401],
  // 2-9 admin
  ['/api/v1/admin/notice-templates', 'GET', 401],
  ['/api/v1/admin/notice-templates', 'POST', 401],
  ['/api/v1/admin/notice-templates/{id}', 'PUT', 401],
  ['/api/v1/admin/platform-policies', 'GET', 401],
  ['/api/v1/admin/platform-policies', 'PUT', 401],
  ['/api/v1/admin/flash-sales', 'GET', 401],
  ['/api/v1/admin/flash-sales', 'POST', 401],
  ['/api/v1/admin/flash-sales/{id}', 'PUT', 401],
  ['/api/v1/admin/flash-sales/{id}/items', 'POST', 401],
  ['/api/v1/admin/flash-sales/{id}/items/{itemId}', 'PUT', 401],
  ['/api/v1/admin/exhibitions', 'GET', 401],
  ['/api/v1/admin/exhibitions', 'POST', 401],
  ['/api/v1/admin/exhibitions/{id}', 'PUT', 401],
  ['/api/v1/admin/coupons/{id}', 'PUT', 401],
  ['/api/v1/admin/coupons/{id}/suspend', 'PUT', 401],
  ['/api/v1/admin/categories/{id}', 'PUT', 401],
  ['/api/v1/admin/payout-requests', 'GET', 401],
  ['/api/v1/admin/payout-requests/{id}', 'PUT', 401],
  ['/api/v1/admin/penalty-rules', 'GET', 401],
  ['/api/v1/admin/penalty-rules', 'PUT', 401],
  ['/api/v1/admin/partners/{id}/penalties', 'POST', 401],
  ['/api/v1/admin/penalties/{id}', 'PUT', 401],
  ['/api/v1/admin/grade-policies', 'GET', 401],
  ['/api/v1/admin/grade-policies', 'PUT', 401],
  ['/api/v1/admin/grades/compute', 'POST', 401],
  ['/api/v1/admin/review-reports', 'GET', 401],
  ['/api/v1/admin/reviews/{id}/visibility', 'PUT', 401],
];

// Retired 2026-11-07: documented paths with no gateway route behind them.
// [path-template, method, token role for the 404 probe (null = unauthenticated)]
const STALE = [
  ['/api/v1/home/sdui', 'GET', null],
  ['/api/v1/flash-sales/stream', 'GET', null],
  ['/api/v1/partner/media/presigned-url', 'POST', 'PARTNER'],
  ['/api/v1/partner/sub-orders/{id}/shipment', 'PATCH', 'PARTNER'],
  ['/api/v1/admin/sdui/layouts', 'PUT', 'ADMIN'],
  ['/api/v1/admin/settlements/execute', 'POST', 'ADMIN']
];

// Minimal parser for this repo's OpenAPI file layout:
// openapi.yaml holds `  /path:` keys each followed by a $ref to a paths/*.yaml
// file; each target file holds `  /path:` anchors with `    method:` operations.
function parseDocumented() {
  const index = read('docs/openapi/openapi.yaml');
  const found = [];
  const lines = index.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const key = lines[i].match(/^  (\/api\/\S+):$/);
    if (!key) continue;
    const ref = (lines[i + 1] || '').match(/\$ref: '\.\/paths\/(\S+\.yaml)#\/paths\/(\S+)'/);
    assert.ok(ref, `openapi.yaml ${key[1]} must $ref a paths/*.yaml file`);
    const target = read(`docs/openapi/paths/${ref[1]}`);
    const anchor = ref[2].replaceAll('~1', '/');
    assert.equal(anchor, key[1], `$ref anchor must equal the path key ${key[1]}`);
    const block = target.split(`\n  ${anchor}:`)[1];
    assert.ok(block, `${ref[1]} must define ${anchor}`);
    const scoped = block.split(/\n  \//)[0];
    const methods = [...scoped.matchAll(/^    (get|post|put|patch|delete):/gm)].map((m) => m[1].toUpperCase());
    assert.ok(methods.length, `${anchor} must declare at least one operation`);
    for (const m of methods) found.push([anchor, m]);
  }
  return found;
}

function probePath(template) {
  // Seed-backed ids for public detail routes: bare probes must return the
  // documented live status (usually 200), not a handler 404.
  if (template === '/api/v1/products/{id}' || template.startsWith('/api/v1/products/{id}/')) {
    return template.replace('{id}', 'prod_001');
  }
  if (template === '/api/v1/categories/{slug}') return '/api/v1/categories/womens-clothing';
  if (template === '/api/v1/partners/{id}/store') return '/api/v1/partners/pt_001/store';
  return template.replaceAll('{id}', 'probe-id').replaceAll('{subId}', 'probe-sub')
    .replaceAll('{slug}', 'probe-slug').replaceAll('{platform}', 'probe-id')
    .replaceAll('{key}', 'probe-id').replaceAll('{fileKey}', 'probe-id');
}
async function newGateway() {
  return createGateway({
    seedFiles: ['migrations/dev/seed_local_dev.sql'],
    env: {
      JWT_SECRET: 'e2e-secret-0123456789abcdefghijklmnopqrstu',
      ENVIRONMENT: 'development',
      CONNECTOR_SIMULATION: 'true',
      PAYMENT_MODE: 'sandbox'
    }
  });
}

await t.test('1. every documented path resolves and hits a live route', async () => {
  const documented = parseDocumented();
  assert.deepEqual(
    [...documented].sort(),
    [...EXPECTED].map(([p, m]) => [p, m]).sort(),
    'docs/openapi surface must equal the maintained allowlist'
  );
  const g = await newGateway();
  for (const [path, method, want] of EXPECTED) {
    const r = await g.call(probePath(path), { method });
    assert.equal(r.status, want, `${method} ${path} -> ${want}, got ${r.status}`);
  }
});

await t.test('2. retired stale paths stay out of the docs and answer 404', async () => {
  // Only live path keys count — historical "Retired ..." comments may name them.
  const docs = [
    'docs/openapi/openapi.yaml',
    'docs/openapi/paths/storefront.yaml',
    'docs/openapi/paths/search.yaml',
    'docs/openapi/paths/partner.yaml',
    'docs/openapi/paths/storage.yaml',
    'docs/openapi/paths/admin.yaml',
    'docs/openapi/paths/auth.yaml',
    'docs/openapi/paths/payments.yaml',
    'docs/openapi/paths/orders.yaml',
    'docs/openapi/paths/channels.yaml',
    'docs/openapi/paths/features.yaml',
    'docs/openapi/paths/finance.yaml',
    'docs/openapi/paths/supply.yaml',
    'docs/openapi/paths/sourcing.yaml',
    'docs/openapi/paths/bidding.yaml',
    'docs/openapi/paths/onboarding.yaml',
    'docs/openapi/paths/governance.yaml',
    'docs/openapi/paths/ops.yaml'
  ].map((p) => {
    try { return read(p); } catch { return ''; }
  }).join('\n');
  const liveKeys = new Set([...docs.matchAll(/^  (\/api\/\S+):$/gm)].map((m) => m[1]));
  const g = await newGateway();
  const tokens = {};
  for (const [path, method] of STALE) {
    assert.ok(!liveKeys.has(path), `docs must not document retired ${path} as a live path`);
  }
  async function tokenFor(role) {
    if (!tokens[role]) {
      const email = role === 'ADMIN' ? 'admin@openmarket.com' : 'seller@temu-supply.com';
      const login = await g.call('/api/v1/auth/login', { method: 'POST', body: { email, password: 'DevPass!2026#', role } });
      assert.equal(login.status, 200, `dev seed login for ${role} must succeed`);
      tokens[role] = login.json.token;
    }
    return tokens[role];
  }
  for (const [path, method, role] of STALE) {
    const opts = { method };
    if (role) opts.token = await tokenFor(role);
    const r = await g.call(probePath(path), opts);
    assert.equal(r.status, 404, `${method} ${path} must 404, got ${r.status}`);
  }
});

await t.test('3. documented response shapes match the implementation', async () => {
  const g = await newGateway();
  // Offset pagination (page/per_page), not cursor — see products_pagination_test for depth.
  const list = await g.call('/api/v1/products?per_page=2&page=1');
  assert.equal(list.status, 200);
  assert.equal(list.json.pagination.page, 1);
  assert.equal(list.json.pagination.per_page, 2);
  assert.ok(Number.isInteger(list.json.pagination.total));
  assert.ok(Number.isInteger(list.json.pagination.total_pages));
  // Product detail envelope.
  const detail = await g.call('/api/v1/products/prod_001');
  assert.equal(detail.status, 200);
  assert.ok(Array.isArray(detail.json.data.skus));
  assert.ok(Array.isArray(detail.json.data.attributes));
  assert.ok(Array.isArray(detail.json.data.volume_discounts));
  // Lightning campaign feed (the honest replacement for the retired SSE stream doc).
  const deals = await g.call('/api/v1/campaigns/lightning');
  assert.equal(deals.status, 200);
  assert.ok(Array.isArray(deals.json.items));
  assert.ok(deals.json.data && Array.isArray(deals.json.data.deals));
  // Checkout alias documented alongside /orders/checkout.
  const alias = await g.call('/api/v1/orders', { method: 'POST' });
  assert.equal(alias.status, 401);
  // Payments config shape pins the client payment routing (web + mobile).
  const payCfg = await g.call('/api/v1/payments/config');
  assert.equal(payCfg.status, 200);
  assert.equal(payCfg.json.mode, 'SANDBOX_SIMULATOR');
  assert.equal(payCfg.json.client_key, null);
  // NEW-08: split keys for web (v1 API) vs mobile (widget); null outside TOSS mode.
  assert.equal(payCfg.json.api_client_key, null);
  assert.equal(payCfg.json.widget_client_key, null);
  // Auth rejects empty credentials with a client error, not a crash.
  const emptyLogin = await g.call('/api/v1/auth/login', { method: 'POST', body: {} });
  assert.equal(emptyLogin.status, 400);

  // Wave 2: bare-probe locks — these rows answer differently with a body, so the
  // EXPECTED values above hold only for bodyless probes like test 1.
  const barePricing = await g.call('/api/v1/channels/pricing/calculate', { method: 'POST' });
  assert.equal(barePricing.status, 400);
  assert.equal(barePricing.json.code, 'INVALID_NUMBER');
  const bareClientErr = await g.call('/api/v1/client-errors', { method: 'POST' });
  assert.equal(bareClientErr.status, 400);
  assert.equal(bareClientErr.json.code, 'REQUIRED');
  // Wave 2: 404 rows whose handler envelope differs from ROUTE_NOT_FOUND.
  const campDetail = await g.call('/api/v1/bidding/campaigns/probe-id');
  assert.equal(campDetail.status, 404);
  assert.equal(campDetail.json.code, 'NOT_FOUND');
  const nego = await g.call('/api/v1/pricing/negotiations');
  assert.equal(nego.status, 404);
  assert.equal(nego.json.code, 'NOT_FOUND');
  const fileDl = await g.call('/api/v1/storage/file/probe-id');
  assert.equal(fileDl.status, 404);
  assert.equal(fileDl.json.error, 'File not found in storage');
  // Wave 2: env-dependent rows pinned to the harness env (no KAKAO/webhook secrets).
  const kakaoStart = await g.call('/api/v1/auth/social/kakao/start');
  assert.equal(kakaoStart.status, 501);
  assert.equal(kakaoStart.json.code, 'SOCIAL_LOGIN_NOT_INTEGRATED');
  const gone = await g.call('/api/v1/deals/lightning');
  assert.equal(gone.status, 410);
  assert.equal(gone.json.code, 'GONE');
});

t.finish();
