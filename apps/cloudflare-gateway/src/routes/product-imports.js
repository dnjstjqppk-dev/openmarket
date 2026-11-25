// apps/cloudflare-gateway/src/routes/product-imports.js
// REST endpoints for URL Product Crawling, Preview, AI Localization, and Automated Catalog Publishing.

import { crawlAndExtractProduct } from '../services/crawler/crawler-service.js';
import { enhanceProductWithAi } from '../services/crawler/ai-translator.js';
import { assertFeatureEnabled, isFeatureEnabled } from '../services/feature-flags.js';
import { requireAuth, requireApprovedPartner, requireAdmin } from '../lib/auth.js';
import { json, readJson, bad, conflict, notFound, str, intParam } from '../lib/http.js';
import { requireOwnPolicy, throwMissingPolicy } from '../lib/shipping-policy.js';
import { requireBrand, validateSkuIdentifiers, findGtinConflicts, gtinConflictWarnings } from '../lib/product-identifiers.js';
import { priceFields, resolveCategory } from './partner.js';
import { sanitizeHtml } from '../services/crawler/html-sanitizer.js';
import { newId } from '../lib/ids.js';

// P2-SEC-02: bulk crawls fan out to at most 5 concurrent fetches under a global
// deadline, with a per-item timeout against one hung origin. The knobs are
// env-tunable for operators (BULK_CRAWL_DEADLINE_MS / BULK_ITEM_TIMEOUT_MS).
export const BULK_CRAWL_CONCURRENCY = 5;
export const BULK_CRAWL_DEADLINE_MS = 60_000;
export const BULK_ITEM_TIMEOUT_MS = 20_000;

/**
 * Run fn over items with at most `limit` in flight. Results keep input order;
 * a throwing fn becomes an {status:'error'} entry, never a lost item.
 */
export async function mapWithConcurrency(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  const workers = new Array(Math.min(Math.max(1, limit), Math.max(items.length, 1))).fill(0).map(async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      try {
        out[i] = { status: 'ok', value: await fn(items[i], i) };
      } catch (e) {
        out[i] = { status: 'error', error: (e && e.message) || String(e) };
      }
    }
  });
  await Promise.all(workers);
  return out;
}

export async function handleProductImportRoutes(request, url, env, corsHeaders) {
  const p = url.pathname;
  if (!p.startsWith('/api/v1/imports') && !p.startsWith('/api/v1/admin/imports')) return null;

  // 1. Single URL Crawl & Analyze (POST /api/v1/imports/crawl)
  if (p === '/api/v1/imports/crawl' && request.method === 'POST') {
    const caller = await requireApprovedPartner(request, env);
    await assertFeatureEnabled(env, 'url_crawler');

    const body = await readJson(request);
    const targetUrl = String(body.url || '').trim();
    // P2-SEC-01: the custom-HTML path (partner "직접 입력" box) persists
    // caller-supplied markup — cap it well below the 1MB body limit. The URL
    // itself is still SSRF-validated inside crawlAndExtractProduct.
    let htmlOverride = null;
    if (body.html_override !== undefined && body.html_override !== null && body.html_override !== '') {
      if (typeof body.html_override !== 'string') throw bad('INVALID_HTML_OVERRIDE', '직접 입력 HTML 형식이 올바르지 않습니다.');
      if (body.html_override.length > 512 * 1024) throw bad('HTML_OVERRIDE_TOO_LARGE', '직접 입력 HTML은 512KB 이하만 가능합니다.');
      htmlOverride = body.html_override;
    }
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

    // Prepare batch statements
    const stmts = [
      env.DB.prepare(`
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
      )
    ];

    // Ingest images into product_import_assets
    const images = Array.isArray(preview.product?.images) ? preview.product.images : [preview.product?.thumbnail_url].filter(Boolean);
    for (const imgUrl of images.slice(0, 10)) {
      const assetId = newId('ast');
      stmts.push(env.DB.prepare(`
        INSERT INTO product_import_assets (
          id, import_job_id, original_url, media_type, status, created_at
        ) VALUES (?, ?, ?, 'IMAGE', 'DISCOVERED', CURRENT_TIMESTAMP)
      `).bind(assetId, jobId, imgUrl));
    }

    await env.DB.batch(stmts);

    preview.job_id = jobId;

    return json(corsHeaders, {
      success: true,
      job_id: jobId,
      data: preview
    }, 201);
  }

  // 2. Partner Import Jobs List (GET /api/v1/imports/jobs) - Placed before /:id to prevent route collision
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

  // 2b. T15: single import job with its preview (GET /api/v1/imports/:id).
  // Powers per-row "불러오기" so bulk/history jobs are not dead ends.
  const jobDetailM = p.match(/^\/api\/v1\/imports\/([^/]+)$/);
  if (jobDetailM && request.method === 'GET') {
    const caller = await requireApprovedPartner(request, env);
    const job = await env.DB.prepare(
      'SELECT * FROM product_import_jobs WHERE id = ? AND partner_id = ?'
    ).bind(jobDetailM[1], caller.partner.id).first();
    if (!job) throw notFound('수집 작업을 찾을 수 없습니다.');
    let preview = {};
    try { preview = JSON.parse(job.preview_data_json || job.extracted_data_json || '{}'); } catch { preview = {}; }
    return json(corsHeaders, { success: true, data: { ...job, preview } });
  }

  // 3. AI Localization & Enhancement (POST /api/v1/imports/:id/ai-enhance)
  const aiM = p.match(/^\/api\/v1\/imports\/([^/]+)\/ai-enhance$/);
  if (aiM && request.method === 'POST') {
    const caller = await requireApprovedPartner(request, env);
    await assertFeatureEnabled(env, 'ai_translation');

    const job = await env.DB.prepare(`
      SELECT * FROM product_import_jobs WHERE id = ? AND partner_id = ?
    `).bind(aiM[1], caller.partner.id).first();

    if (!job) throw notFound('수집 작업을 찾을 수 없습니다.');

    let preview = {};
    try { preview = JSON.parse(job.preview_data_json || job.extracted_data_json || '{}'); } catch {}

    const aiResult = await enhanceProductWithAi(preview.product || {}, { targetLang: 'KO', env });
    const enhancementId = newId('aie');

    // Update job preview with translated title and summary
    if (preview.product) {
      preview.product.title = aiResult.translated_title;
      preview.product.description_html = aiResult.enhanced_summary;
      // NEW-02: only a real external call (COMPLETED) may claim AI enhancement.
      preview.ai_enhanced = aiResult.live_external_api_status === 'COMPLETED';
      preview.ai_bullets = aiResult.bullets;
    }

    await env.DB.batch([
      env.DB.prepare(`
        INSERT INTO ai_product_enhancements (
          id, import_job_id, source_language, target_language, original_title,
          translated_title, enhanced_summary, bullets_json, provider, status, created_at
        ) VALUES (?, ?, 'EN', 'KO', ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      `).bind(
        enhancementId, job.id, aiResult.original_title, aiResult.translated_title,
        aiResult.enhanced_summary, JSON.stringify(aiResult.bullets), aiResult.provider, aiResult.live_external_api_status
      ),
      env.DB.prepare(`
        UPDATE product_import_jobs
        SET preview_data_json = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).bind(JSON.stringify(preview), job.id)
    ]);

    return json(corsHeaders, {
      success: true,
      job_id: job.id,
      data: {
        ...aiResult,
        updated_preview: preview
      }
    });
  }

  // 4. Get Import Job Details (GET /api/v1/imports/:id)
  const jobM = p.match(/^\/api\/v1\/imports\/([^/]+)$/);
  if (jobM && jobM[1] !== 'jobs' && request.method === 'GET') {
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

  // 5. Publish Crawled Product to Catalog (POST /api/v1/imports/:id/publish)
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

    // Same contract as seller registration: validated fields, operator review.
    // No invented prices, categories, thumbnails or "verified genuine" copy.
    const merged = {
      title: body.title ?? preview.product?.title,
      sale_price: body.sale_price ?? preview.pricing?.calculated_sale_price,
      original_price: body.original_price ?? preview.pricing?.calculated_original_price,
      category_id: body.category_id,
      category_slug: body.category_slug,
      thumbnail_url: body.thumbnail_url ?? preview.product?.thumbnail_url,
      description_html: body.description_html ?? preview.product?.description_html
    };
    const title = str(merged.title, { field: '상품명', max: 200, required: true });
    const { sale: salePrice, orig: originalPrice } = priceFields(merged);
    const categoryId = await resolveCategory(env, merged);
    const thumbUrl = str(merged.thumbnail_url, { field: '대표 이미지', max: 500, required: true });
    if (!/^https:\/\//.test(thumbUrl) && !thumbUrl.startsWith('/api/v1/storage/file/')) throw bad('INVALID_IMAGE_URL', '이미지는 https URL 또는 업로드 파일이어야 합니다.');
    const descHtml = sanitizeHtml(str(merged.description_html, { max: 200000 }) || `<p>${title}</p>`);
    // 6-12: brand is required (the 'GLB IMPORT' invention is retired); manufacturer/model optional.
    const brand = requireBrand(body.brand ?? preview.product?.brand);
    const manufacturer = str(body.manufacturer ?? preview.product?.manufacturer, { max: 100 }) || null;
    const modelName = str(body.model_name ?? preview.product?.model_name, { max: 100 }) || null;
    const wholesaleCost = intParam(body.wholesale_cost ?? preview.pricing?.wholesale_cost_krw ?? Math.round(salePrice * 0.7), { min: 0, max: 100_000_000, field: '공급원가' });
    // 6-11: URL imports choose the seller policy at publish time (never null).
    if (body.shipping_policy_id === undefined || body.shipping_policy_id === null || String(body.shipping_policy_id).trim() === '') {
      await throwMissingPolicy(env, caller.partner.id);
    }
    const shipTplId = (await requireOwnPolicy(env, caller.partner.id, String(body.shipping_policy_id).trim())).id;

    const prodId = newId('prod');
    let variants = Array.isArray(body.variants) && body.variants.length > 0 ? body.variants : (preview.variants || []);
    if (variants.length === 0) {
      variants = [{ option_values: { 옵션: '기본' }, price: salePrice, original_price: originalPrice, stock_quantity: 0 }];
    }
    // 6-12: each variant needs its barcode-or-reason (top-level pair covers variants without their own).
    const variantIds = variants.map((v, i) => validateSkuIdentifiers({
      gtin: v?.gtin ?? body.gtin,
      gtin_exempt_reason: v?.gtin_exempt_reason ?? body.gtin_exempt_reason
    }, { where: `옵션 ${i + 1}` }));

    const stmts = [];

    // 1. Insert into products (DRAFT/PENDING: an operator reviews before sale)
    stmts.push(env.DB.prepare(`
      INSERT INTO products (
        id, partner_id, category_id, title, thumbnail_url,
        description_html, lowest_sale_price, lowest_original_price,
        status, review_status, supply_model, target_margin_bps, shipping_policy_id,
        brand, manufacturer, model_name, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'DRAFT', 'PENDING', 'FULLY_MANAGED', 2000, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `).bind(
      prodId, caller.partner.id, categoryId, title, thumbUrl, descHtml, salePrice, originalPrice, shipTplId,
      brand, manufacturer, modelName
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

    // 3. Insert SKUs (validated; stock defaults to 0, never invented)
    for (let idx = 0; idx < variants.length; idx++) {
      const v = variants[idx] || {};
      const skuId = newId('sku');
      const skuCode = str(v.variant_code, { max: 60 }) || `${prodId}_SKU_${idx + 1}`;
      const vPrice = intParam(v.price ?? salePrice, { min: 0, max: 100_000_000, field: '옵션 판매가' });
      const vOriginal = intParam(v.original_price ?? originalPrice, { min: vPrice, max: 100_000_000, field: '옵션 정상가' });
      const vStock = intParam(v.stock_quantity ?? 0, { min: 0, max: 1_000_000, field: '옵션 재고' });
      const optJson = JSON.stringify(v.option_values || { Option: v.option_summary || 'Standard' });

      stmts.push(env.DB.prepare(`
        INSERT INTO product_skus (
          id, product_id, sku_code, option_combination_json, original_price, sale_price,
          wholesale_supply_price, stock_quantity, safety_stock, status, gtin, gtin_exempt_reason, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 5, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      `).bind(
        skuId, prodId, skuCode, optJson, vOriginal, vPrice, wholesaleCost, vStock, vStock > 0 ? 'IN_STOCK' : 'OUT_OF_STOCK',
        variantIds[idx].gtin, variantIds[idx].exempt
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

    // 5. Update import job status and assets
    stmts.push(env.DB.prepare(`
      UPDATE product_import_jobs
      SET status = 'PUBLISHED', published_product_id = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).bind(prodId, job.id));

    stmts.push(env.DB.prepare(`
      UPDATE product_import_assets
      SET product_id = ?
      WHERE import_job_id = ?
    `).bind(prodId, job.id));

    const gtinWarnings = gtinConflictWarnings(await findGtinConflicts(env, variantIds.map((v) => v.gtin), null));
    try {
      await env.DB.batch(stmts);
    } catch (e) {
      if (String(e.message).includes('UNIQUE')) throw conflict('SKU_CODE_TAKEN', '이미 사용 중인 SKU 코드입니다.');
      throw e;
    }

    return json(corsHeaders, {
      success: true,
      product_id: prodId,
      sku_count: variants.length,
      status: 'DRAFT',
      review_status: 'PENDING',
      warnings: gtinWarnings,
      message: '수집 상품이 등록되었습니다. 운영자 심사 승인 후 판매가 시작됩니다.'
    }, 201);
  }

  // 6. Bulk URL Crawl Batch (POST /api/v1/imports/bulk)
  if (p === '/api/v1/imports/bulk' && request.method === 'POST') {
    const caller = await requireApprovedPartner(request, env);
    await assertFeatureEnabled(env, 'bulk_crawler');

    const body = await readJson(request);
    const urls = Array.isArray(body.urls) ? body.urls.map(String).filter((u) => u.trim()) : [];

    if (urls.length === 0) throw bad('URLS_REQUIRED', '수집할 상품 URL 배열을 입력해 주세요.');
    if (urls.length > 50) throw bad('BATCH_LIMIT_EXCEEDED', '한 번에 최대 50개까지 수집 가능합니다.');

    const deadlineMs = Number(env.BULK_CRAWL_DEADLINE_MS) > 0 ? Number(env.BULK_CRAWL_DEADLINE_MS) : BULK_CRAWL_DEADLINE_MS;
    const itemTimeoutMs = Number(env.BULK_ITEM_TIMEOUT_MS) > 0 ? Number(env.BULK_ITEM_TIMEOUT_MS) : BULK_ITEM_TIMEOUT_MS;
    const deadline = Date.now() + deadlineMs;
    const crawlOne = (u) => {
      if (Date.now() > deadline) {
        return Promise.resolve({ success: false, error: 'BULK_DEADLINE_EXCEEDED: 전체 수집 제한 시간을 초과했습니다.', error_code: 'BULK_DEADLINE_EXCEEDED', data: null });
      }
      return new Promise((resolve) => {
        const timer = setTimeout(() => resolve({ success: false, error: '수집 시간 초과로 건너뛰었습니다.', error_code: 'BULK_ITEM_TIMEOUT', data: null }), itemTimeoutMs);
        crawlAndExtractProduct({ url: u, pricingRule: body.pricing_rule || {} }).then(
          (r) => { clearTimeout(timer); resolve(r); },
          (e) => { clearTimeout(timer); resolve({ success: false, error: (e && e.message) || String(e), error_code: 'CRAWL_FAILED', data: null }); }
        );
      });
    };
    const settled = await mapWithConcurrency(urls, BULK_CRAWL_CONCURRENCY, crawlOne);
    const batchResults = [];
    for (let ui = 0; ui < urls.length; ui++) {
      const u = urls[ui];
      const entry = settled[ui];
      const res = entry.status === 'ok' ? entry.value : { success: false, error: entry.error, error_code: 'CRAWL_FAILED', data: null };
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

  // 7. Admin All Import Jobs Monitoring (GET /api/v1/admin/imports/jobs)
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
