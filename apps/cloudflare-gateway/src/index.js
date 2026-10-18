// apps/cloudflare-gateway/src/index.js
// OLMOA Enterprise Edge Gateway: D1 Cloud SQL Database Router

import { handleCatalogRoutes } from './routes/catalog.js';
import { handleOrderRoutes } from './routes/orders.js';
import { handlePartnerRoutes } from './routes/partner.js';
import { handleAdminRoutes } from './routes/admin.js';
import { handleIntegrationRoutes } from './routes/integrations.js';
import { handleFeatureRoutes } from './routes/features.js';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Idempotency-Key, X-Partner-Id, X-Customer-Id, X-Integration-Key, X-Admin-Secret',
  'Content-Type': 'application/json; charset=utf-8'
};

export default {
  async fetch(request, env, ctx) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    const url = new URL(request.url);

    // 1. Health & Status
    if (url.pathname === '/health' || url.pathname === '/api/health') {
      let dbStatus = 'DISCONNECTED';
      let productCount = 0;
      let categoryCount = 0;
      if (env && env.DB) {
        try {
          const pRes = await env.DB.prepare('SELECT COUNT(*) as cnt FROM products').first();
          const cRes = await env.DB.prepare('SELECT COUNT(*) as cnt FROM categories WHERE parent_id IS NULL').first();
          dbStatus = 'CONNECTED_D1';
          productCount = pRes ? pRes.cnt : 0;
          categoryCount = cRes ? cRes.cnt : 0;
        } catch (e) {
          dbStatus = 'ERROR: ' + e.message;
        }
      }

      return new Response(JSON.stringify({
        status: 'UP',
        brand: 'OLMOA',
        koreanBrand: '올모아',
        tagline: '내가 찾는 모든 것, 여기.',
        databaseEngine: 'Cloudflare D1 SQL',
        databaseStatus: dbStatus,
        activeRootCategories: categoryCount,
        activeProductsInD1: productCount,
        timestamp: new Date().toISOString()
      }), { headers: corsHeaders });
    }

    // 2. Go Backend proxying (when external backend is configured)
    if (env && env.GO_BACKEND_URL) {
      const targetUrl = new URL(url.pathname + url.search, env.GO_BACKEND_URL);
      try {
        const proxyReq = new Request(targetUrl, request);
        return await fetch(proxyReq);
      } catch (err) {
        return new Response(JSON.stringify({ error: 'Go Backend unreachable', detail: String(err) }), { 
          status: 502, 
          headers: corsHeaders 
        });
      }
    }

    // 3. Direct D1 Relational Engine
    if (env && env.DB) {
      try {
        // Extended Features: Autocomplete, Flash Sales, Reviews, Coupons & FAQ
        const featureRes = await handleFeatureRoutes(request, url, env, corsHeaders);
        if (featureRes) return featureRes;

        // Catalog: Categories, Products & Search
        const catalogRes = await handleCatalogRoutes(request, url, env, corsHeaders);
        if (catalogRes) return catalogRes;

        // Orders: Checkout & History
        const orderRes = await handleOrderRoutes(request, url, env, corsHeaders);
        if (orderRes) return orderRes;

        // Partner: Merchant Product & Shipment Fulfillment
        const partnerRes = await handlePartnerRoutes(request, url, env, corsHeaders);
        if (partnerRes) return partnerRes;

        // Admin: Metrics, Verification & Audit
        const adminRes = await handleAdminRoutes(request, url, env, corsHeaders);
        if (adminRes) return adminRes;

        // External Integrations: PriceScanner & Selbym
        const integrationRes = await handleIntegrationRoutes(request, url, env, corsHeaders);
        if (integrationRes) return integrationRes;

      } catch (dbErr) {
        return new Response(JSON.stringify({ 
          error: 'D1 Query Execution Failed', 
          details: dbErr.message 
        }), { status: 500, headers: corsHeaders });
      }
    }

    // 4. Default Gateway Response
    return new Response(JSON.stringify({
      gateway: 'OLMOA Edge Gateway',
      route: url.pathname,
      brand: 'OLMOA',
      databaseStatus: 'Cloudflare D1 Relational Engine Active',
      status: 'ROUTING_ACTIVE'
    }), { status: 200, headers: corsHeaders });
  }
};
