// apps/cloudflare-gateway/src/index.js
// OLMOA Edge API Gateway (Cloudflare Worker + D1).

import { buildCorsHeaders, errorResponse, json } from './lib/http.js';
import { handleAuthRoutes } from './routes/auth.js';
import { handleCatalogRoutes } from './routes/catalog.js';
import { handleOrderRoutes } from './routes/orders.js';
import { handlePartnerRoutes } from './routes/partner.js';
import { handleAdminRoutes } from './routes/admin.js';
import { handleIntegrationRoutes } from './routes/integrations.js';
import { handleFeatureRoutes } from './routes/features.js';
import { handleGlobalCustomsAndFxRoutes } from './routes/global-customs-fx.js';
import { handleGlobalLogisticsRoutes } from './routes/global-logistics.js';
import { handleGlobalGovernanceRoutes } from './routes/global-governance.js';
import { handlePaymentRoutes } from './routes/payments.js';
import { handleStorageRoutes } from './routes/storage.js';
import { handleTemuOpsRoutes } from './routes/temu-ops.js';
import { handleBusinessRoutes } from './routes/business.js';
import { handleSupplierRoutes } from './routes/suppliers.js';
import { handleFinanceRoutes } from './routes/finance.js';
import { expireStaleOrders, autoConfirmDelivered } from './services/orders.js';

const SERVICE_VERSION = '2.0.0-v3-integrity';

const ROUTERS = [
  handleAuthRoutes,
  handleBusinessRoutes,
  handlePaymentRoutes,
  handleFinanceRoutes,
  handleSupplierRoutes,
  handleGlobalCustomsAndFxRoutes,
  handleGlobalLogisticsRoutes,
  handleGlobalGovernanceRoutes,
  handleStorageRoutes,
  handleTemuOpsRoutes,
  handleFeatureRoutes,
  handleCatalogRoutes,
  handleOrderRoutes,
  handlePartnerRoutes,
  handleAdminRoutes,
  handleIntegrationRoutes
];

async function health(env, corsHeaders) {
  let db = 'DISCONNECTED';
  let products = 0;
  let operatorConfigured = false;
  try {
    products = await env.DB.prepare("SELECT COUNT(*) AS c FROM products WHERE status = 'ACTIVE'").first('c');
    operatorConfigured = Boolean(await env.DB.prepare("SELECT id FROM business_entities WHERE status = 'ACTIVE' AND role = 'PLATFORM_OPERATOR'").first());
    db = 'CONNECTED_D1';
  } catch {
    db = 'ERROR';
  }
  let payment = 'DISABLED';
  const pm = String(env.PAYMENT_MODE || '').toLowerCase();
  if (pm === 'live' && env.TOSS_SECRET_KEY) payment = String(env.TOSS_SECRET_KEY).startsWith('test_') ? 'TOSS_TEST_KEY' : 'TOSS_LIVE_KEY';
  else if (pm === 'sandbox' && env.ENVIRONMENT !== 'production') payment = 'LOCAL_SIMULATOR';
  return json(corsHeaders, {
    status: db === 'CONNECTED_D1' ? 'UP' : 'DEGRADED',
    brand: 'OLMOA',
    version: SERVICE_VERSION,
    environment: env.ENVIRONMENT || 'unset',
    databaseStatus: db,
    activeProductsInD1: products,
    readiness: {
      auth_configured: typeof env.JWT_SECRET === 'string' && env.JWT_SECRET.length >= 32,
      operator_entity_active: operatorConfigured,
      payment,
      email_delivery: 'NOT_INTEGRATED',
      carrier_tracking_api: 'NOT_INTEGRATED',
      supplier_order_api: 'NOT_INTEGRATED'
    },
    timestamp: new Date().toISOString()
  });
}

export default {
  async fetch(request, env, ctx) {
    const corsHeaders = buildCorsHeaders(request, env);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders });
    const url = new URL(request.url);
    try {
      if (url.pathname === '/health' || url.pathname === '/api/health') return await health(env, corsHeaders);
      if (url.pathname === '/api/version' || url.pathname === '/version') {
        return json(corsHeaders, { service: 'olmoa-api', version: SERVICE_VERSION, commit: env.GIT_COMMIT || 'unset', environment: env.ENVIRONMENT || 'unset' });
      }
      if (url.pathname === '/sitemap.xml') {
        const base = env.PUBLIC_STOREFRONT_URL || 'https://olmoa.com';
        const { results: cats } = await env.DB.prepare('SELECT slug FROM categories WHERE is_active = 1').all();
        const { results: prods } = await env.DB.prepare("SELECT id FROM products WHERE status = 'ACTIVE' AND review_status = 'APPROVED'").all();
        const urls = ['/', '/categories', '/channel/lightning-deals', '/channel/best-sellers', '/coupons', '/support',
          ...cats.map((c) => `/category/${encodeURIComponent(c.slug)}`), ...prods.map((p) => `/product/${encodeURIComponent(p.id)}`)];
        const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u) => `  <url><loc>${base}${u}</loc></url>`).join('\n')}\n</urlset>`;
        return new Response(xml, { headers: { ...corsHeaders, 'Content-Type': 'application/xml; charset=utf-8' } });
      }
      if (!env.DB) return json(corsHeaders, { success: false, error: 'Database binding missing', code: 'DB_NOT_BOUND' }, 503);
      for (const route of ROUTERS) {
        const res = await route(request, url, env, corsHeaders, ctx);
        if (res) return res;
      }
      return json(corsHeaders, { success: false, error: '존재하지 않는 API 경로입니다.', code: 'ROUTE_NOT_FOUND', route: url.pathname }, 404);
    } catch (err) {
      return errorResponse(corsHeaders, err, env);
    }
  },

  // Cron Triggers (configure in wrangler.jsonc "triggers": {"crons": ["*/5 * * * *"]})
  async scheduled(event, env, ctx) {
    ctx.waitUntil((async () => {
      const expired = await expireStaleOrders(env, 200);
      const confirmed = await autoConfirmDelivered(env, 7, 200);
      console.log(JSON.stringify({ level: 'info', job: 'scheduled', cron: event.cron, expired, confirmed }));
    })());
  }
};
