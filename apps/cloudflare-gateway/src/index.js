// apps/cloudflare-gateway/src/index.js
// OLMOA Edge API Gateway (Cloudflare Worker + D1).

import { buildCorsHeaders, errorResponse, json } from './lib/http.js';
import { emailConfigured } from './lib/email.js';
import { handleAuthRoutes } from './routes/auth.js';
import { handleSocialAuthRoutes } from './routes/social-auth.js';
import { handleCatalogRoutes } from './routes/catalog.js';
import { handleOrderRoutes } from './routes/orders.js';
import { handlePartnerRoutes } from './routes/partner.js';
import { handleAdminRoutes } from './routes/admin.js';
import { handleIntegrationRoutes } from './routes/integrations.js';
import { handleFeatureRoutes } from './routes/features.js';
import { handlePushRoutes } from './routes/push.js';
import { handleRecommendRoutes } from './routes/recommend.js';
import { handleShippingRoutes } from './routes/shipping.js';
import { handleGlobalCustomsAndFxRoutes } from './routes/global-customs-fx.js';
import { handleGlobalLogisticsRoutes } from './routes/global-logistics.js';
import { handleGlobalGovernanceRoutes } from './routes/global-governance.js';
import { handlePaymentRoutes } from './routes/payments.js';
import { handleStorageRoutes } from './routes/storage.js';
import { handleTemuOpsRoutes } from './routes/temu-ops.js';
import { handleBusinessRoutes } from './routes/business.js';
import { handleLegalRoutes } from './routes/legal.js';
import { handleSupplierRoutes } from './routes/suppliers.js';
import { handleSourcingRoutes } from './routes/sourcing.js';
import { handleSourcingOpsRoutes } from './routes/sourcing-ops.js';
import { handleCatalogFullRoutes } from './routes/catalog-full.js';
import { handleChannelPublishRoutes } from './routes/channel-publish.js';
import { handleChannelsOpsRoutes } from './routes/channels-ops.js';
import { handleChannelOrderRoutes } from './routes/channel-orders.js';
import { handleFulfillmentOpsRoutes } from './routes/fulfillment-ops.js';
import { handleSeoRoutes } from './routes/seo.js';
import { handleSeoOpsRoutes } from './routes/seo-ops.js';
import { handleBiddingAndM2cRoutes } from './routes/bidding-m2c.js';
import { handleProductImportRoutes } from './routes/product-imports.js';
import { handleSupplier3plRoutes } from './routes/supplier-3pl.js';
import { handleFeatureFlagRoutes } from './routes/feature-flags.js';
import { handleMultiChannelRoutes } from './routes/multichannel.js';
import { handleFinanceRoutes, reconcileIfDue } from './routes/finance.js';
import { handleOnboardingRoutes } from './routes/onboarding.js';
import { handleAdminSecurityRoutes } from './routes/admin-security.js';
import { handleClientErrorRoutes } from './routes/client-errors.js';
import { expireStaleOrders, autoConfirmDelivered } from './services/orders.js';
import { runPriceDropNotifs, runPurchaseReminds } from './services/reminders.js';
import { purgeExpiredPii } from './services/privacy.js';
import { computeMonthlyGrades } from './services/grading.js';
import { purgeOldSearchHours } from './services/trending.js';
import { runDeltaSync } from './services/channels/delta.js';
import { runRotation } from './services/channels/rotation.js';
import { runChannelPoll } from './services/fulfillment/poll.js';
import { runAutoOrder } from './services/fulfillment/order.js';
import { runInvoiceSync } from './services/fulfillment/invoice.js';
import { drainNotifyOutbox } from './services/fulfillment/notify.js';
import { enforceRateLimit, classify } from './lib/ratelimit.js';
import { authenticate } from './lib/auth.js';

const SERVICE_VERSION = '2.0.0-v3-integrity';

const ROUTERS = [
  handleAdminSecurityRoutes, // /auth/2fa/* and /admin/admin-users before the generic auth/admin routers
  handleAuthRoutes,
  handleSocialAuthRoutes,
  handleOnboardingRoutes, // before partner/admin routers: '/api/v1/partner-applications' shares their prefixes
  handleBusinessRoutes,
  handleLegalRoutes,
  handlePaymentRoutes,
  handleFinanceRoutes,
  handleSupplierRoutes,
  handleSourcingRoutes,
  handleSourcingOpsRoutes,
  handleSupplier3plRoutes,
  handleProductImportRoutes,
  handleFeatureFlagRoutes,
  handleMultiChannelRoutes,
  handleChannelPublishRoutes,
  handleChannelsOpsRoutes,
  handleChannelOrderRoutes,
  handleFulfillmentOpsRoutes,
  handleSeoOpsRoutes,
  handleBiddingAndM2cRoutes,
  handleGlobalCustomsAndFxRoutes,
  handleGlobalLogisticsRoutes,
  handleGlobalGovernanceRoutes,
  handleStorageRoutes,
  handleTemuOpsRoutes,
  handleFeatureRoutes,
  handlePushRoutes,
  handleRecommendRoutes,
  handleShippingRoutes,
  handleCatalogFullRoutes,
  handleCatalogRoutes,
  handleOrderRoutes,
  handlePartnerRoutes,
  handleAdminRoutes,
  handleIntegrationRoutes,
  handleClientErrorRoutes
];

async function health(env, corsHeaders) {
  let db = 'DISCONNECTED';
  let products = 0;
  let operatorConfigured = false;
  // NEW-16: applied schema level (null on databases predating the ledger).
  let schemaVersion = null;
  let migrationsApplied = null;
  try {
    products = await env.DB.prepare("SELECT COUNT(*) AS c FROM products WHERE status = 'ACTIVE'").first('c');
    operatorConfigured = Boolean(await env.DB.prepare("SELECT id FROM business_entities WHERE status = 'ACTIVE' AND role = 'PLATFORM_OPERATOR'").first());
    db = 'CONNECTED_D1';
  } catch {
    db = 'ERROR';
  }
  if (db === 'CONNECTED_D1') {
    try {
      schemaVersion = await env.DB.prepare('SELECT MAX(version) AS v FROM schema_migrations').first('v');
      migrationsApplied = Number(await env.DB.prepare('SELECT COUNT(*) AS c FROM schema_migrations').first('c')) || 0;
    } catch {
      schemaVersion = null;
      migrationsApplied = null;
    }
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
    schemaVersion,
    migrationsApplied,
    readiness: {
      auth_configured: typeof env.JWT_SECRET === 'string' && env.JWT_SECRET.length >= 32,
      operator_entity_active: operatorConfigured,
      payment,
      email_delivery: emailConfigured(env) ? 'RESEND' : 'NOT_INTEGRATED',
      // H-4: binding presence only — whether the olmoa-media bucket itself
      // exists in the account is a human deploy check, not probed here.
      media_storage: (env.STORAGE_BUCKET || env.R2 || env.BUCKET) ? 'R2_BOUND' : 'D1_FALLBACK',
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
      // Phase 4-6: public crawl surface (sitemaps/robots/llms.txt) served
      // pre-ratelimit like /health — crawlers must not eat the API budget.
      if (request.method === 'GET') {
        const seo = await handleSeoRoutes(request, url, env, corsHeaders);
        if (seo) return seo;
      }
      if (!env.DB) return json(corsHeaders, { success: false, error: 'Database binding missing', code: 'DB_NOT_BOUND' }, 503);
      // O12: rate limits before any work. Writes are keyed by the verified user (shared mobile-carrier IPs stay usable).
      const bucket = classify(request.method, url.pathname);
      let userKey = null;
      let loginEmail = null;
      if (bucket === 'RL_WRITE') userKey = (await authenticate(request, env).catch(() => null))?.userId || null;
      if (bucket === 'RL_AUTH' && url.pathname === '/api/v1/auth/login' && request.method === 'POST') {
        loginEmail = await request.clone().json().then((b) => (b && typeof b.email === 'string' ? b.email.slice(0, 254) : null)).catch(() => null);
      }
      await enforceRateLimit(request, env, { userKey, loginEmail });
      for (const route of ROUTERS) {
        const res = await route(request, url, env, corsHeaders, ctx);
        if (res) return res;
      }
      return json(corsHeaders, { success: false, error: '존재하지 않는 API 경로입니다.', code: 'ROUTE_NOT_FOUND', route: url.pathname }, 404);
    } catch (err) {
      return errorResponse(corsHeaders, err, env, { request, ctx });
    }
  },

  // Cron Triggers (configure in wrangler.jsonc "triggers": {"crons": ["*/5 * * * *"]})
  async scheduled(event, env, ctx) {
    ctx.waitUntil((async () => {
      const expired = await expireStaleOrders(env, 200);
      // 5-9 (K-06, K-09): reminders run before auto-confirm so the confirm
      // reminder always lands before the automatic confirmation it warns of.
      let reminders = 'SKIPPED';
      try {
        const pd = await runPriceDropNotifs(env);
        const pr = await runPurchaseReminds(env);
        reminders = `drops:${pd.bundled}/${pd.users},confirm:${pr.confirm},review:${pr.review}`;
      } catch (e) {
        reminders = 'ERROR';
        console.error(JSON.stringify({ level: 'error', job: 'reminders', error: String(e && e.message || e) }));
      }
      const confirmed = await autoConfirmDelivered(env, 7, 200);
      // O19: hourly reconciliation with persisted result + alert (ALERT_WEBHOOK_URL) on any failed check.
      let reconciliation = 'NOT_DUE';
      try {
        const r = await reconcileIfDue(env, Number(env.RECONCILE_INTERVAL_MINUTES) || 60);
        if (r) reconciliation = r.ok ? 'OK' : `FAILED:${r.alert_status}`;
      } catch (e) {
        reconciliation = 'ERROR';
        console.error(JSON.stringify({ level: 'error', job: 'reconciliation', error: String(e && e.message || e) }));
      }
      // O10: destroy withdrawn members' PII whose legal retention period ended (once per hour: first tick of the hour).
      let purged = null;
      if (new Date(event.scheduledTime || Date.now()).getUTCMinutes() < 5) {
        try {
          purged = await purgeExpiredPii(env, 500);
        } catch (e) {
          console.error(JSON.stringify({ level: 'error', job: 'pii_purge', error: String(e && e.message || e) }));
        }
      }
      // 2-7: monthly seller grading for the previous month (first tick of the 1st UTC).
      let grading = 'NOT_DUE';
      try {
        const nowD = new Date(event.scheduledTime || Date.now());
        if (nowD.getUTCDate() === 1 && nowD.getUTCHours() === 0 && nowD.getUTCMinutes() < 5) {
          const prev = new Date(Date.UTC(nowD.getUTCFullYear(), nowD.getUTCMonth() - 1, 1));
          const ym = `${prev.getUTCFullYear()}-${String(prev.getUTCMonth() + 1).padStart(2, '0')}`;
          grading = `${ym}:${await computeMonthlyGrades(env, ym)}`;
        }
      } catch (e) {
        grading = 'ERROR';
        console.error(JSON.stringify({ level: 'error', job: 'grading', error: String(e && e.message || e) }));
      }
      // 2-8: drop hourly search rows older than 7 days (first tick of 03:00 UTC).
      let searchPurged = 'NOT_DUE';
      try {
        const nowH = new Date(event.scheduledTime || Date.now());
        if (nowH.getUTCHours() === 3 && nowH.getUTCMinutes() < 5) {
          searchPurged = await purgeOldSearchHours(env);
        }
      } catch (e) {
        searchPurged = 'ERROR';
        console.error(JSON.stringify({ level: 'error', job: 'search_purge', error: String(e && e.message || e) }));
      }
      // Phase 2: 15-minute channel delta sync (every :00/:15/:30/:45 tick).
      let delta = 'NOT_DUE';
      try {
        const nowM = new Date(event.scheduledTime || Date.now());
        if (nowM.getUTCMinutes() % 15 < 5) {
          const r = await runDeltaSync(env, {});
          delta = `checked:${r.checked},synced:${r.synced},failed:${r.failed.length}`;
        }
      } catch (e) {
        delta = 'ERROR';
        console.error(JSON.stringify({ level: 'error', job: 'delta_sync', error: String(e && e.message || e) }));
      }
      // Phase 2: 30-day idle rotation batch (first tick of 04:00 UTC).
      let rotation = 'NOT_DUE';
      try {
        const nowR = new Date(event.scheduledTime || Date.now());
        if (nowR.getUTCHours() === 4 && nowR.getUTCMinutes() < 5) {
          const r = await runRotation(env, {});
          rotation = `scanned:${r.scanned},rotated:${r.rotated}`;
        }
      } catch (e) {
        rotation = 'ERROR';
        console.error(JSON.stringify({ level: 'error', job: 'rotation', error: String(e && e.message || e) }));
      }
      // Phase 3: unmanned fulfillment wave — channel poll, auto-PO dispatch,
      // invoice collection with channel push-back, notify drain (every tick).
      let fulfill = 'NOT_DUE';
      try {
        const poll = await runChannelPoll(env, {});
        const auto = await runAutoOrder(env, {});
        const inv = await runInvoiceSync(env, {});
        const out = await drainNotifyOutbox(env, {});
        fulfill = `poll:${poll.created}/${poll.checked},po:${auto.sent}/${auto.checked},inv:${inv.shipped}/${inv.checked},ntf:${out.sent}`;
      } catch (e) {
        fulfill = 'ERROR';
        console.error(JSON.stringify({ level: 'error', job: 'fulfillment', error: String(e && e.message || e) }));
      }
      console.log(JSON.stringify({ level: 'info', job: 'scheduled', cron: event.cron, expired, reminders, confirmed, reconciliation, purged, grading, searchPurged, delta, rotation, fulfill }));
    })());
  }
};
