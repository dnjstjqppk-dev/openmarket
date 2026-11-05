// apps/cloudflare-gateway/src/services/crawler/crawler-service.js
// Orchestrates URL product crawler, multi-adapter extraction, option matrix synthesis, and quality auditing.

import { validateProductUrl } from './url-validator.js';
import { sanitizeHtml } from './html-sanitizer.js';
import { extractJsonLd } from './adapters/json-ld-adapter.js';
import { extractMetaOg } from './adapters/meta-og-adapter.js';
import { extractShopify } from './adapters/shopify-adapter.js';
import { generateVariantCombinations } from './option-extractor.js';
import { convertToKrw, calculateRetailPrice } from './pricing-calculator.js';

export async function crawlAndExtractProduct({ url, htmlOverride = null, pricingRule = {} }) {
  // 1. URL Validation & SSRF Check
  const urlCheck = validateProductUrl(url);
  if (!urlCheck.valid) {
    return {
      success: false,
      error_code: 'SSRF_OR_INVALID_URL',
      error: urlCheck.error
    };
  }

  // 2. Fetch Page HTML (or use htmlOverride for sandbox/testing)
  let html = htmlOverride;
  if (!html) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 8000);
      const res = await fetch(urlCheck.url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; OLMOA-SupplierBot/3.0; +https://olmoa.com/bot)',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7'
        },
        signal: controller.signal
      });
      clearTimeout(timeoutId);

      if (!res.ok) {
        return {
          success: false,
          error_code: 'HTTP_FETCH_FAILED',
          error: `원격 서버 응답 오류 (HTTP ${res.status} ${res.statusText})`
        };
      }
      html = await res.text();
    } catch (e) {
      return {
        success: false,
        error_code: 'NETWORK_TIMEOUT_OR_BLOCKED',
        error: `상품 페이지 접속 실패: ${e.message}`
      };
    }
  }

  // 3. Multi-Adapter Extraction Pipeline
  let extracted = extractShopify(html) || extractJsonLd(html) || extractMetaOg(html);

  if (!extracted || (!extracted.title && (!extracted.images || extracted.images.length === 0))) {
    return {
      success: false,
      error_code: 'METADATA_EXTRACTION_FAILED',
      error: '상품 메타데이터(JSON-LD, OpenGraph, Shopify)를 분석할 수 없는 페이지입니다.'
    };
  }

  // 4. Sanitize Description HTML
  const sanitizedDesc = sanitizeHtml(extracted.description || '');

  // 5. Price & Currency Normalization
  const rawPrice = Number(extracted.price || 0);
  const rawCurrency = String(extracted.currency || 'KRW').toUpperCase();
  const costKrw = convertToKrw(rawPrice, rawCurrency);

  // 6. Apply Pricing Rule / Margin Calculation
  const retailEstimate = calculateRetailPrice({
    wholesaleCostKrw: costKrw,
    marginBps: pricingRule.margin_bps || 2000,
    fixedAddAmount: pricingRule.fixed_add_amount || 0,
    minimumMarginAmount: pricingRule.minimum_margin_amount || 3000,
    roundingUnit: pricingRule.rounding_unit || 100
  });

  // 7. Option Matrix & Variants Synthesis
  const baseSku = `IMP_${urlCheck.domain.replace(/[^a-zA-Z0-9]/g, '').slice(0, 6).toUpperCase()}_${Date.now().toString(36).slice(-4).toUpperCase()}`;
  const variants = generateVariantCombinations({
    baseSkuPrefix: baseSku,
    basePrice: retailEstimate.sale_price,
    options: extracted.options || [],
    knownVariants: extracted.known_variants || []
  });

  // 8. Quality Score Calculation (0 ~ 100)
  let qualityScore = 0;
  const missingFields = [];

  if (extracted.title && extracted.title.length >= 8) qualityScore += 25;
  else missingFields.push('상품명(8자 이상)');

  if (extracted.images && extracted.images.length > 0) {
    qualityScore += 20;
    if (extracted.images.length >= 3) qualityScore += 10;
  } else missingFields.push('대표 이미지');

  if (sanitizedDesc && sanitizedDesc.length >= 30) qualityScore += 20;
  else missingFields.push('상세 설명(30자 이상)');

  if (costKrw > 0) qualityScore += 15;
  else missingFields.push('공급 원가');

  if (variants.length > 0) qualityScore += 10;
  else missingFields.push('판매 옵션 조합');

  const finalScore = Math.min(100, qualityScore);

  // 9. Structured Import Preview
  const importPreview = {
    source_url: urlCheck.url,
    domain: urlCheck.domain,
    adapter_used: extracted.source_type,
    quality_score: finalScore,
    is_ready_for_publish: finalScore >= 60 && costKrw > 0,
    missing_fields: missingFields,

    product: {
      title: extracted.title,
      brand: extracted.brand || 'GLB SUPPLIER',
      model_name: extracted.model || '',
      origin_language: rawCurrency === 'KRW' ? 'ko' : 'en',
      thumbnail_url: extracted.images[0] || 'https://images.unsplash.com/photo-1505740420928-5e560c06d30e',
      gallery_images: extracted.images,
      description_html: sanitizedDesc || '<p>공식 공급업체 직출고 검증 정품 상품입니다.</p>',
      hs_code: '6109.10',
      country_origin: 'KR',
      warehouse_location: 'INCHEON_FBO',
      custody_type: 'SEMI_MANAGED'
    },

    pricing: {
      raw_source_price: rawPrice,
      raw_currency: rawCurrency,
      wholesale_cost_krw: costKrw,
      calculated_sale_price: retailEstimate.sale_price,
      calculated_original_price: retailEstimate.original_price,
      projected_margin_krw: retailEstimate.margin_amount,
      projected_margin_pct: retailEstimate.margin_percentage,
      rounding_unit: retailEstimate.rounding_unit
    },

    options: extracted.options || [],
    variants
  };

  return {
    success: true,
    data: importPreview
  };
}
