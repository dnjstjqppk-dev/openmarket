// apps/cloudflare-gateway/src/routes/product-imports.js
// REST endpoints for URL Product Crawling, Preview, and Automated Catalog Publishing.

import { crawlAndExtractProduct } from '../services/crawler/crawler-service.js';
import { requireAuth, requireApprovedPartner, requireAdmin } from '../lib/auth.js';
import { json, readJson, bad, notFound } from '../lib/http.js';
import { newId } from '../lib/ids.js';

export async function handleProductImportRoutes(request, url, env, corsHeaders) {
  const p = url.pathname;
  if (!p.startsWith('/api/v1/imports') && !p.startsWith('/api/v1/admin/imports')) return null;

  // 1. Single URL Crawl & Analyze (POST /api/v1/imports/crawl)
  if (p === '/api/v1/imports/crawl' && request.method === 'POST') {
    const caller = await requireApprovedPartner(request, env);
    const body = await readJson(request);
    const targetUrl = String(body.url || '').trim();
    const htmlOverride = body.html_override || null;
    const pricingRule = body.pricing_rule || {};

    if (!targetUrl) throw bad('URL_REQUIRED', '수집할 상품 웹 주소(URL)를 입력해 주세요.');

    const result = await crawlAndExtractProduct({ url: targetUrl, htmlOverride, pricingRule });
    if (!result.success) {
      return json(corsHeaders, {
        success: false,
        error_code: result.error_code,
        error: result.error
      }, 400);
    }

    const preview = result.data;
    const jobId = newId('imp');

    // Record job in database
    await env.DB.prepare(`
      INSERT INTO product_import_jobs (
        id, partner_id, supplier_id, source_url, domain, status, quality_score,
        extracted_data_json, preview_data_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 'ANALYZED', ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `).bind(
      jobId,
      caller.partner.id,
      body.supplier_id || null,
      targetUrl,
      preview.domain,
      preview.quality_score,
      JSON.stringify(preview),
      JSON.stringify(preview)
    ).run();

    return json(corsHeaders, {
      success: true,
      job_id: jobId,
      data: preview
    }, 201);
  }

  // 2. Get Import Job Details (GET /api/v1/imports/:id)
  const jobM = p.match(/^\/api\/v1\/imports\/([^/]+)$/);
  if (jobM && request.method === 'GET') {
    const caller = await requireApprovedPartner(request, env);
    const job = await env.DB.prepare(`
      SELECT * FROM product_import_jobs WHERE id = ? AND partner_id = ?
    `).bind(jobM[1], caller.partner.id).first();

    if (!job) throw notFound('수집 작업을 찾을 수 없습니다.');

    let preview = null;
    try {
      preview = JSON.parse(job.preview_data_json || job.extracted_data_json || '{}');
    } catch {}

    return json(corsHeaders, {
      success: true,
      data: {
        ...job,
        preview
      }
    });
  }

  // 3. Publish Crawled Product to Catalog (POST /api/v1/imports/:id/publish)
  const pubM = p.match(/^\/api\/v1\/imports\/([^/]+)\/publish$/);
  if (pubM && request.method === 'POST') {
    const caller = await requireApprovedPartner(request, env);
    const body = await readJson(request);

    const job = await env.DB.prepare(`
      SELECT * FROM product_import_jobs WHERE id = ? AND partner_id = ?
    `).bind(pubM[1], caller.partner.id).first();

    if (!job) throw notFound('수집 작업을 찾을 수 없습니다.');
    if (job.status === 'PUBLISHED') throw bad('ALREADY_PUBLISHED', '이미 등록 완료된 상품입니다.');

    let preview = {};
    try { preview = JSON.parse(job.preview_data_json || '{}'); } catch {}

    // Allow user overrides or fallback to preview data
    const title = String(body.title || preview.product?.title || '수집 등록 상품').trim();
    const brand = String(body.brand || preview.product?.brand || 'GLB IMPORT').trim();
    const categoryId = String(body.category_id || 'cat_e_audio').trim();
    const salePrice = Number(body.sale_price || preview.pricing?.calculated_sale_price || 19900);
    const originalPrice = Number(body.original_price || preview.pricing?.calculated_original_price || Math.round(salePrice * 1.35));
    const wholesaleCost = Number(body.wholesale_cost || preview.pricing?.wholesale_cost_krw || Math.round(salePrice * 0.7));
    const thumbUrl = String(body.thumbnail_url || preview.product?.thumbnail_url || 'https://images.unsplash.com/photo-1505740420928-5e560c06d30e').trim();
    const descHtml = String(body.description_html || preview.product?.description_html || '<p>공식 공급업체 직출고 검증 정품 상품입니다.</p>');

    const prodId = newId('prod');
    const slug = `${title.toLowerCase().replace(/[^a-z0-9가-힣]/g, '-').slice(0, 30)}-${Date.now().toString(36)}`;
    const variants = Array.isArray(body.variants) && body.variants.length > 0 ? body.variants : (preview.variants || []);

    const stmts = [];

    // 1. Insert into products
    stmts.push(env.DB.prepare(`
      INSERT INTO products (
        id, partner_id, category_id, title, thumbnail_url,
        description_html, lowest_sale_price, lowest_original_price,
        status, review_status, supply_model, target_margin_bps, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE', 'APPROVED', 'FULLY_MANAGED', 2000, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `).bind(
      prodId, caller.partner.id, categoryId, title, thumbUrl, descHtml, salePrice, originalPrice
    ));

    // 2. Insert into source_products
    const spId = newId('sp');
    stmts.push(env.DB.prepare(`
      INSERT INTO source_products (
        id, original_url, domain, supplier_id, title, brand, raw_data_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      ON CONFLICT(original_url) DO UPDATE SET updated_at = CURRENT_TIMESTAMP
    `).bind(
      spId, job.source_url, job.domain, job.supplier_id || null, title, brand, job.extracted_data_json || '{}'
    ));

    // 3. Insert SKUs
    for (let idx = 0; idx < variants.length; idx++) {
      const v = variants[idx];
      const skuId = newId('sku');
      const skuCode = v.variant_code || `${prodId}_SKU_${idx + 1}`;
      const vPrice = Number(v.price || salePrice);
      const vOriginal = Number(v.original_price || originalPrice);
      const vStock = Number(v.stock_quantity || 100);
      const optJson = JSON.stringify(v.option_values || { Option: v.option_summary || 'Standard' });

      stmts.push(env.DB.prepare(`
        INSERT INTO product_skus (
          id, product_id, sku_code, option_combination_json, original_price, sale_price,
          wholesale_supply_price, stock_quantity, safety_stock, status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 5, 'IN_STOCK', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      `).bind(
        skuId, prodId, skuCode, optJson, vOriginal, vPrice, wholesaleCost, vStock
      ));

      // 4. Connect supplier_sku_mappings if supplier exists
      if (job.supplier_id) {
        const ssmId = newId('ssm');
        stmts.push(env.DB.prepare(`
          INSERT INTO supplier_sku_mappings (
            id, sku_id, supplier_id, supplier_sku_code, unit_cost, fulfillment_mode, resale_authorized, is_active
          ) VALUES (?, ?, ?, ?, ?, 'DROP_SHIP', 1, 1)
        `).bind(
          ssmId, skuId, job.supplier_id, skuCode, wholesaleCost
        ));
      }
    }

    // 5. Update import job status
    stmts.push(env.DB.prepare(`
      UPDATE product_import_jobs
      SET status = 'PUBLISHED', published_product_id = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).bind(prodId, job.id));

    await env.DB.batch(stmts);

    return json(corsHeaders, {
      success: true,
      product_id: prodId,
      sku_count: variants.length,
      message: '상품이 카탈로그에 공식 판매 등록되었습니다.'
    });
  }

  // 4. Partner Import Jobs List (GET /api/v1/imports/jobs)
  if (p === '/api/v1/imports/jobs' && request.method === 'GET') {
    const caller = await requireApprovedPartner(request, env);
    const { results } = await env.DB.prepare(`
      SELECT j.id, j.source_url, j.domain, j.status, j.quality_score, j.published_product_id, j.created_at,
             p.title as published_title
      FROM product_import_jobs j
      LEFT JOIN products p ON p.id = j.published_product_id
      WHERE j.partner_id = ?
      ORDER BY j.created_at DESC
      LIMIT 50
    `).bind(caller.partner.id).all();

    return json(corsHeaders, {
      success: true,
      count: results.length,
      data: results
    });
  }

  // 5. Bulk URL Crawl Batch (POST /api/v1/imports/bulk)
  if (p === '/api/v1/imports/bulk' && request.method === 'POST') {
    const caller = await requireApprovedPartner(request, env);
    const body = await readJson(request);
    const urls = Array.isArray(body.urls) ? body.urls.map(String).filter((u) => u.trim()) : [];

    if (urls.length === 0) throw bad('URLS_REQUIRED', '수집할 상품 URL 배열을 입력해 주세요.');
    if (urls.length > 50) throw bad('BATCH_LIMIT_EXCEEDED', '한 번에 최대 50개까지 수집 가능합니다.');

    const batchResults = [];
    for (const u of urls) {
      const res = await crawlAndExtractProduct({ url: u, pricingRule: body.pricing_rule || {} });
      const jobId = newId('imp');
      const domain = res.data?.domain || 'unknown';
      const status = res.success ? 'ANALYZED' : 'FAILED';
      const score = res.data?.quality_score || 0;

      await env.DB.prepare(`
        INSERT INTO product_import_jobs (
          id, partner_id, source_url, domain, status, quality_score,
          extracted_data_json, error_message, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      `).bind(
        jobId, caller.partner.id, u, domain, status, score,
        res.success ? JSON.stringify(res.data) : null,
        res.success ? null : res.error
      ).run();

      batchResults.push({
        job_id: jobId,
        url: u,
        status,
        quality_score: score,
        title: res.data?.product?.title || null,
        error: res.error || null
      });
    }

    return json(corsHeaders, {
      success: true,
      total_requested: urls.length,
      successful: batchResults.filter((r) => r.status === 'ANALYZED').length,
      failed: batchResults.filter((r) => r.status === 'FAILED').length,
      data: batchResults
    }, 201);
  }

  // 6. Admin All Import Jobs Monitoring (GET /api/v1/admin/imports/jobs)
  if (p === '/api/v1/admin/imports/jobs' && request.method === 'GET') {
    await requireAdmin(request, env);
    const { results } = await env.DB.prepare(`
      SELECT j.*, pt.business_name as partner_name, p.title as published_title
      FROM product_import_jobs j
      JOIN partners pt ON pt.id = j.partner_id
      LEFT JOIN products p ON p.id = j.published_product_id
      ORDER BY j.created_at DESC
      LIMIT 100
    `).all();

    return json(corsHeaders, {
      success: true,
      count: results.length,
      data: results
    });
  }

  return null;
}
