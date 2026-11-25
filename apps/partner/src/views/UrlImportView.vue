<script setup lang="ts">
import { ArrowUpRight, Bot, Check, CircleAlert, CircleCheck, CloudDownload, Layers, Link, LoaderCircle, RotateCw, Search, ShieldCheck, TriangleAlert, WandSparkles, X, Zap } from 'lucide-vue-next'
import { ref, onMounted, computed } from 'vue';
import { API_BASE, getPartnerHeaders } from '../config';
import { stripToSafeHtml } from '../utils/stripHtml';
import { GTIN_EXEMPT_OPTIONS, isValidGtin } from '../utils/gtin';
import { userErrorMessage } from '@olmoa/ui';

// Quick-fill presets are a development aid and hidden in production builds.
const isDev = (import.meta as any).env?.DEV === true;

interface Variant {
  variant_code: string;
  option_values: Record<string, string>;
  option_summary: string;
  original_price: number;
  price: number;
  stock_quantity: number;
  stock_status: string;
}

interface CrawlResult {
  job_id: string;
  source_url: string;
  domain: string;
  adapter_used: string;
  quality_score: number;
  quality_checks: Record<string, boolean>;
  product: {
    title: string;
    description_html: string;
    brand: string;
    thumbnail_url: string;
    images: string[];
    raw_price: number;
    currency: string;
  };
  options: Array<{ name: string; values: string[] }>;
  variants: Variant[];
  pricing: {
    source_currency: string;
    source_price: number;
    wholesale_cost_krw: number;
    margin_bps: number;
    calculated_sale_price: number;
    calculated_original_price: number;
    rounding_unit: number;
    estimated_margin_krw: number;
  };
}

interface ImportJob {
  id: string;
  source_url: string;
  domain: string;
  status: string;
  quality_score: number;
  published_product_id?: string;
  published_title?: string;
  created_at: string;
}

interface AiEnhancement {
  original_title: string;
  translated_title: string;
  enhanced_summary: string;
  bullets: string[];
  provider: string;
  live_external_api_status: string;
  note: string;
}

interface BulkResultItem {
  job_id: string;
  url: string;
  status: string;
  quality_score: number;
  title: string | null;
  error: string | null;
}

interface BulkResponse {
  total_requested: number;
  successful: number;
  failed: number;
  data: BulkResultItem[];
}

// Mode & Form state
const activeMode = ref<'single' | 'bulk'>('single');
const urlInput = ref('');
const bulkUrlsInput = ref('');
const targetMargin = ref(25); // 25%
// P2-T05: the default category is the first loaded row — never a fixed id.
// Until categories load, the selects show a disabled loading/failed option.
const selectedCategory = ref('');
const categories = ref<any[]>([]);
const categoriesFailed = ref(false);
const loadCategories = async () => {
  categoriesFailed.value = false;
  try {
    const res = await fetch(`${API_BASE}/api/v1/categories`);
    const json = await res.json().catch(() => null);
    if (res.ok && json?.success && Array.isArray(json.data) && json.data.length) {
      categories.value = json.data;
      if (!categories.value.some((c: any) => c.id === selectedCategory.value)) {
        selectedCategory.value = categories.value[0].id;
      }
    } else {
      categoriesFailed.value = true;
    }
  } catch {
    categoriesFailed.value = true;
  }
};
const htmlOverride = ref('');
const isCustomHtml = ref(false);
// 6-11: publish requires the seller-chosen policy (default pre-fills).
const policies = ref<any[]>([]);
const selectedPolicy = ref('');
const loadPolicies = async () => {
  try {
    const res = await fetch(`${API_BASE}/api/v1/partner/shipping-policies`, { headers: getPartnerHeaders() });
    const json = await res.json().catch(() => null);
    if (res.ok && json?.success && Array.isArray(json.data)) {
      policies.value = json.data;
      const def = policies.value.find((p: any) => Number(p.is_default) === 1) || policies.value[0];
      if (def && !selectedPolicy.value) selectedPolicy.value = def.id;
    }
  } catch { /* publish validates */ }
};

// Execution state
const isLoading = ref(false);
const isBulkLoading = ref(false);
const isPublishing = ref(false);
const isAiEnhancing = ref(false);
const isRecalling = ref(false);
const errorMsg = ref('');
const successMsg = ref('');
const historyError = ref('');

// Extracted data
const result = ref<CrawlResult | null>(null);
// Crawl output comes from untrusted third-party pages: strip active content
// before v-html even though the server also sanitizes (C-N01).
const safeDescriptionHtml = computed(() => stripToSafeHtml(result.value?.product.description_html || ''));
const editedTitle = ref('');
const editedSalePrice = ref<number | null>(null);
// 6-12: identifiers for publish (brand required, barcode-or-reason per variant set).
const editedBrand = ref('');
const editedManufacturer = ref('');
const editedModel = ref('');
const editedGtin = ref('');
const editedGtinExempt = ref(false);
const editedExemptReason = ref('');
const editedExemptOther = ref('');
const aiInfo = ref<AiEnhancement | null>(null);
const bulkResult = ref<BulkResponse | null>(null);
const jobsHistory = ref<ImportJob[]>([]);

// Pre-defined sample URLs
const samples = [
  {
    name: 'Shopify 스포츠웨어 (다차원 옵션)',
    url: 'https://demo-activewear.myshopify.com/products/core-seamless-leggings',
    html: `<!DOCTYPE html><html><head>
      <meta property="og:title" content="코어 씸리스 하이웨이스트 레깅스" />
      <meta property="og:description" content="신축성과 통기성이 탁월한 프로 스포츠웨어 레깅스" />
      <meta property="og:image" content="https://example.com/sample/leggings.jpg" />
      <script>var meta = {"product":{"id":78921,"variants":[{"id":101,"title":"Black / S","price":39000,"compare_at_price":49000,"sku":"LEG-BLK-S","available":true},{"id":102,"title":"Black / M","price":39000,"compare_at_price":49000,"sku":"LEG-BLK-M","available":true},{"id":103,"title":"Navy / S","price":39000,"compare_at_price":49000,"sku":"LEG-NVY-S","available":true},{"id":104,"title":"Navy / M","price":39000,"compare_at_price":49000,"sku":"LEG-NVY-M","available":true}]}};</` + `script>
    </head></html>`
  },
  {
    name: 'Schema.org 음향기기 (JSON-LD)',
    url: 'https://sound-factory.com/products/anc-bluetooth-headphones',
    html: `<!DOCTYPE html><html><head>
      <` + `script type="application/ld+json">
      {
        "@context": "https://schema.org/",
        "@type": "Product",
        "name": "하이브리드 액티브 노이즈 캔슬링 무선 헤드폰 H3",
        "image": ["https://example.com/sample/headphones.jpg"],
        "description": "최대 45시간 연속 재생 및 초고음질 무손실 코덱 지원 헤드셋",
        "brand": { "@type": "Brand", "name": "SONIX" },
        "offers": {
          "@type": "Offer",
          "price": "68000",
          "priceCurrency": "KRW",
          "availability": "https://schema.org/InStock"
        }
      }
      </` + `script>
    </head></html>`
  },
  {
    name: '글로벌 오픈마켓 진공청소기 (Meta-OG)',
    url: 'https://factory-direct.co.kr/items/smart-vacuum-cleaner',
    html: `<!DOCTYPE html><html><head>
      <meta property="og:title" content="스마트 저소음 무선 진공 청소기 Pro" />
      <meta property="og:description" content="BLDC 모터 탑재 25000Pa 강력 흡입 청소기" />
      <meta property="og:image" content="https://example.com/sample/vacuum.jpg" />
      <meta property="product:price:amount" content="40000" />
      <meta property="product:price:currency" content="KRW" />
    </head></html>`
  }
];

function applySample(sample: typeof samples[0]) {
  urlInput.value = sample.url;
  htmlOverride.value = sample.html;
  isCustomHtml.value = true;
  errorMsg.value = '';
}

async function loadHistory() {
  historyError.value = '';
  try {
    const res = await fetch(`${API_BASE}/api/v1/imports/jobs`, {
      headers: getPartnerHeaders()
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || '수집 이력을 불러오지 못했습니다.');
    }
    jobsHistory.value = data.data || [];
  } catch (err: any) {
    jobsHistory.value = [];
    historyError.value = userErrorMessage(err, '수집 이력을 불러오는 중 오류가 발생했습니다.');
  }
}

// P1-T15: recall a past analyzed job into the single-item editor so it can
// be re-edited and published — publishing is no longer limited to a job
// that was just crawled in this session.
async function loadJobIntoEditor(jobId: string) {
  if (isRecalling.value) return;
  isRecalling.value = true;
  errorMsg.value = '';
  successMsg.value = '';
  try {
    const res = await fetch(`${API_BASE}/api/v1/imports/${jobId}`, {
      headers: getPartnerHeaders()
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || '수집 결과를 불러오지 못했습니다.');
    }
    const preview = data.data?.preview || {};
    result.value = { job_id: jobId, ...preview } as CrawlResult;
    editedTitle.value = preview?.product?.title || '';
    editedSalePrice.value = preview?.pricing?.calculated_sale_price || null;
    editedBrand.value = preview?.product?.brand || '';
    aiInfo.value = null;
    successMsg.value = `✓ 이전 수집 결과 불러옴 (품질 점수: ${preview?.quality_score ?? '-'}점) — 검수 후 상품 등록을 진행하세요.`;
  } catch (err: any) {
    errorMsg.value = userErrorMessage(err, '수집 결과를 불러오는 중 오류가 발생했습니다.');
  } finally {
    isRecalling.value = false;
  }
}

async function handleCrawl() {
  if (!urlInput.value.trim()) {
    errorMsg.value = '수집할 상품 URL을 입력해 주세요.';
    return;
  }
  errorMsg.value = '';
  successMsg.value = '';
  isLoading.value = true;
  result.value = null;
  aiInfo.value = null;

  try {
    const payload: any = {
      url: urlInput.value.trim(),
      pricing_rule: {
        margin_bps: targetMargin.value * 100, // e.g. 2500 bps
        min_margin_krw: 3000,
        rounding_unit: 100
      }
    };
    if (isCustomHtml.value && htmlOverride.value) {
      payload.html_override = htmlOverride.value;
    }

    const res = await fetch(`${API_BASE}/api/v1/imports/crawl`, {
      method: 'POST',
      headers: getPartnerHeaders(),
      body: JSON.stringify(payload)
    });

    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || '상품 정보 추출에 실패했습니다.');
    }

    result.value = data.data;
    editedTitle.value = data.data.product?.title || '';
    editedSalePrice.value = data.data.pricing?.calculated_sale_price || null;
    editedBrand.value = data.data.product?.brand || '';
    successMsg.value = `✓ 상품 정보 추출 완료! (품질 점수: ${data.data.quality_score}점)`;
    loadHistory();
  } catch (err: any) {
    errorMsg.value = userErrorMessage(err, '요청 처리 중 오류가 발생했습니다.');
  } finally {
    isLoading.value = false;
  }
}

async function handleAiEnhance() {
  if (!result.value?.job_id) return;
  isAiEnhancing.value = true;
  errorMsg.value = '';
  try {
    const res = await fetch(`${API_BASE}/api/v1/imports/${result.value.job_id}/ai-enhance`, {
      method: 'POST',
      headers: getPartnerHeaders(),
      body: JSON.stringify({ targetLang: 'KO' })
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'AI 번역 및 가공에 실패했습니다.');
    }
    aiInfo.value = data.data;
    if (data.data.translated_title) {
      editedTitle.value = data.data.translated_title;
    }
    if (data.data.enhanced_summary && result.value.product) {
      result.value.product.description_html = data.data.enhanced_summary;
    }
    // NEW-02 honesty: only dictionary translation is performed; external
    // GenAI rewriting is not used — never claim AI marketing-copy completion.
    successMsg.value = `✔️ 타이틀 사전식 번역 완료 (${data.data.provider}) · 외부 AI 가공 상태: ${data.data.live_external_api_status} — ${data.data.note || '상세설명은 원문 그대로, 판매자 직접 입력 필요'}`;
  } catch (err: any) {
    errorMsg.value = userErrorMessage(err, 'AI 가공 처리 중 오류가 발생했습니다.');
  } finally {
    isAiEnhancing.value = false;
  }
}

async function handleBulkCrawl() {
  const lines = bulkUrlsInput.value
    .split('\n')
    .map(l => l.trim())
    .filter(l => l.length > 0);

  if (lines.length === 0) {
    errorMsg.value = '대량 수집할 URL을 한 줄에 하나씩 입력해 주세요.';
    return;
  }
  if (lines.length > 50) {
    errorMsg.value = '한 번에 최대 50개까지 수집 가능합니다.';
    return;
  }

  errorMsg.value = '';
  successMsg.value = '';
  isBulkLoading.value = true;
  bulkResult.value = null;

  try {
    const payload = {
      urls: lines,
      pricing_rule: {
        margin_bps: targetMargin.value * 100,
        min_margin_krw: 3000,
        rounding_unit: 100
      }
    };

    const res = await fetch(`${API_BASE}/api/v1/imports/bulk`, {
      method: 'POST',
      headers: getPartnerHeaders(),
      body: JSON.stringify(payload)
    });

    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || '대량 상품 수집에 실패했습니다.');
    }

    bulkResult.value = data;
    successMsg.value = `✓ 대량 수집 완료! (요청 ${data.total_requested}개 / 성공 ${data.successful}개 / 실패 ${data.failed}개)`;
    loadHistory();
  } catch (err: any) {
    errorMsg.value = userErrorMessage(err, '대량 수집 처리 중 오류가 발생했습니다.');
  } finally {
    isBulkLoading.value = false;
  }
}

async function handlePublish() {
  if (!result.value) return;
  if (!selectedCategory.value) {
    errorMsg.value = '카테고리를 먼저 불러와 선택해 주세요.';
    return;
  }
  if (!selectedPolicy.value) {
    errorMsg.value = '배송정책을 선택해 주세요. 배송정책이 없으면 먼저 등록해 주세요.';
    return;
  }
  if (!editedBrand.value.trim()) {
    errorMsg.value = '브랜드를 입력해 주세요. 브랜드가 없으면 "노브랜드/자체제작"을 입력해 주세요.';
    return;
  }
  if (!editedGtinExempt.value && !isValidGtin(editedGtin.value)) {
    errorMsg.value = '바코드 형식을 확인해 주세요. 8·12·13·14자리 숫자와 체크디지트가 맞아야 합니다.';
    return;
  }
  if (editedGtinExempt.value && !editedExemptReason.value) {
    errorMsg.value = '바코드 없음 사유를 선택해 주세요.';
    return;
  }
  if (editedGtinExempt.value && editedExemptReason.value === 'OTHER' && !editedExemptOther.value.trim()) {
    errorMsg.value = '기타 사유를 직접 입력해 주세요.';
    return;
  }
  isPublishing.value = true;
  errorMsg.value = '';
  successMsg.value = '';

  try {
    const publishPayload: any = {
      title: editedTitle.value || result.value.product.title,
      sale_price: editedSalePrice.value || result.value.pricing.calculated_sale_price,
      original_price: result.value.pricing.calculated_original_price,
      wholesale_cost: result.value.pricing.wholesale_cost_krw,
      category_id: selectedCategory.value,
      shipping_policy_id: selectedPolicy.value,
      brand: editedBrand.value.trim(),
      manufacturer: editedManufacturer.value.trim() || undefined,
      model_name: editedModel.value.trim() || undefined,
      ...(editedGtinExempt.value
        ? { gtin_exempt_reason: editedExemptReason.value === 'OTHER' ? `OTHER:${editedExemptOther.value.trim()}` : editedExemptReason.value }
        : { gtin: editedGtin.value.replace(/[\s-]/g, '') }),
      thumbnail_url: result.value.product.thumbnail_url,
      description_html: result.value.product.description_html,
      variants: result.value.variants
    };

    const res = await fetch(`${API_BASE}/api/v1/imports/${result.value.job_id}/publish`, {
      method: 'POST',
      headers: getPartnerHeaders(),
      body: JSON.stringify(publishPayload)
    });

    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || '카탈로그 등록에 실패했습니다.');
    }

    successMsg.value = `상품이 심사 대기(DRAFT)로 등록되었습니다. 운영자 승인 후 판매가 시작됩니다. (상품 ID: ${data.product_id}, SKU: ${data.sku_count}개)`;
    loadHistory();
  } catch (err: any) {
    errorMsg.value = userErrorMessage(err, '등록 중 오류가 발생했습니다.');
  } finally {
    isPublishing.value = false;
  }
}

onMounted(() => {
  loadHistory();
  loadCategories();
  loadPolicies();
});
</script>

<template>
  <div class="max-w-7xl mx-auto px-4 py-8 space-y-8">
    <!-- Header Hero Banner -->
    <div class="rounded-2xl border border-line bg-surface p-6 sm:p-8 shadow-xl relative overflow-hidden">
      <div class="relative z-10 space-y-2">
        <div class="inline-flex items-center gap-2 bg-primary-soft text-primary-soft-ink border border-line px-3 py-1 rounded-full text-xs font-semibold">
          <CloudDownload class="h-4 w-4 text-primary" aria-hidden="true" />
          <span>URL 수집 & 위탁판매 등록</span>
        </div>
        <h1 class="text-2xl sm:text-3xl font-bold tracking-tight text-ink">URL 기반 상품 자동 수집 & 3PL 위탁판매 등록</h1>
        <p class="text-sm sm:text-base text-ink-muted max-w-3xl leading-relaxed">
          외부 공급업체, 글로벌 쇼핑몰의 상품 링크 하나로 메타데이터, 다차원 옵션(색상×사이즈), 고해상도 이미지를 자동 수집합니다.
          자동 마진 계산기와 SSRF 차단, AI 한국어 번역을 거쳐 정식 카탈로그에 판매 상품으로 등록하세요.
        </p>
      </div>
    </div>

    <!-- Alert Messages -->
    <div v-if="errorMsg" class="p-4 bg-danger-soft border border-line text-danger rounded-xl flex items-center gap-3">
      <TriangleAlert class="h-4 w-4 text-danger text-lg flex-shrink-0" aria-hidden="true" />
      <span class="text-sm font-medium">{{ errorMsg }}</span>
    </div>
    <div v-if="successMsg" class="p-4 bg-success-soft border border-line text-success rounded-xl flex items-center gap-3">
      <CircleCheck class="h-4 w-4 text-success text-lg flex-shrink-0" aria-hidden="true" />
      <span class="text-sm font-medium">{{ successMsg }}</span>
    </div>

    <!-- Mode Selector Tabs -->
    <div class="flex items-center gap-2 border-b border-line pb-2">
      <button
        @click="activeMode = 'single'"
        type="button"
        class="px-5 py-2.5 rounded-xl font-bold text-sm transition flex items-center gap-2 cursor-pointer"
        :class="activeMode === 'single' ? 'bg-secondary text-secondary-on shadow' : 'bg-surface text-ink-muted hover:bg-surface-2 border border-line'"
      >
        <Link class="h-4 w-4" aria-hidden="true" />
        <span>단일 URL 정밀 수집 (Single Mode)</span>
      </button>
      <button
        @click="activeMode = 'bulk'"
        type="button"
        class="px-5 py-2.5 rounded-xl font-bold text-sm transition flex items-center gap-2 cursor-pointer"
        :class="activeMode === 'bulk' ? 'bg-secondary text-secondary-on shadow' : 'bg-surface text-ink-muted hover:bg-surface-2 border border-line'"
      >
        <Layers class="h-4 w-4" aria-hidden="true" />
        <span>대량 URL 일괄 수집 (Bulk Mode)</span>
      </button>
    </div>

    <!-- TAB 1: Single URL Mode -->
    <div v-if="activeMode === 'single'" class="space-y-6">
      <div class="bg-surface rounded-2xl shadow-sm border border-line p-6 space-y-6">
        <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-line-divider pb-4">
          <div>
            <h2 class="text-lg font-bold text-ink">1. 상품 URL 입력 및 마진율 설정</h2>
            <p class="text-xs text-ink-muted">지원 프로토콜: HTTP/HTTPS (Shopify, Schema.org, OpenGraph 자동 감지)</p>
          </div>
          <div class="flex items-center gap-2 text-xs text-ink-muted bg-surface-2 px-3 py-1.5 rounded-lg border border-line">
            <ShieldCheck class="h-4 w-4 text-success" aria-hidden="true" />
            <span>SSRF 사설 IP 및 Cloud Metadata 접근 100% 원천 차단</span>
          </div>
        </div>

        <!-- Quick Fill Sample Presets (dev only) -->
        <div v-if="isDev" class="space-y-2">
          <span class="text-xs font-semibold text-ink-muted">빠른 테스트 샘플 URL 프리셋:</span>
          <div class="flex flex-wrap gap-2">
            <button
              v-for="(s, idx) in samples"
              :key="idx"
              type="button"
              @click="applySample(s)"
              class="text-xs bg-surface-2 hover:bg-primary-soft hover:text-primary-soft-ink text-ink-muted px-3 py-1.5 rounded-lg border border-line transition font-medium cursor-pointer"
            >
              ⚡ {{ s.name }}
            </button>
          </div>
        </div>

        <!-- URL Input Field -->
        <div class="space-y-2">
          <label class="block text-xs font-bold text-ink-muted uppercase tracking-wider">수집 대상 상품 URL</label>
          <div class="flex gap-2">
            <div class="relative flex-1">
              <span class="absolute inset-y-0 left-0 pl-3.5 flex items-center text-ink-subtle">
                <Link class="h-4 w-4" aria-hidden="true" />
              </span>
              <input
                v-model="urlInput"
                type="url"
                placeholder="수집할 공급사 상품 페이지 URL을 입력하세요"
                class="w-full pl-10 pr-4 py-2.5 text-sm rounded-xl border border-line bg-surface text-ink focus:outline-none focus:ring-2 focus:ring-primary font-mono"
              />
            </div>
            <button
              @click="handleCrawl"
              :disabled="isLoading"
              class="px-6 py-2.5 bg-primary hover:bg-primary-hover disabled:bg-surface-3 disabled:text-ink-subtle text-primary-on text-sm font-bold rounded-xl shadow transition flex items-center gap-2 cursor-pointer"
            >
              <LoaderCircle v-if="isLoading" class="h-4 w-4 animate-spin" aria-hidden="true" />
              <Search v-else class="h-4 w-4" aria-hidden="true" />
              <span>{{ isLoading ? '수집 및 분석 중...' : '상품 수집' }}</span>
            </button>
          </div>
        </div>

        <!-- Pricing & Category Parameters -->
        <div class="grid grid-cols-1 md:grid-cols-2 gap-6 pt-2">
          <!-- Margin Slider -->
          <div class="space-y-2 bg-surface-2 p-4 rounded-xl border border-line">
            <div class="flex justify-between items-center text-xs">
              <span class="font-bold text-ink-muted">판매 목표 마진율 (Markup %)</span>
              <span class="font-extrabold text-primary text-base font-mono">{{ targetMargin }}%</span>
            </div>
            <input
              v-model.number="targetMargin"
              type="range"
              min="10"
              max="60"
              step="5"
              class="w-full accent-primary cursor-pointer"
            />
            <div class="flex justify-between text-[11px] text-ink-subtle font-mono">
              <span>10% (박리다매)</span>
              <span>25% (추천 기본값)</span>
              <span>60% (고마진 프리미엄)</span>
            </div>
          </div>

          <!-- Target Category -->
          <div class="space-y-2 bg-surface-2 p-4 rounded-xl border border-line">
            <label class="block text-xs font-bold text-ink-muted">등록 기본 카테고리</label>
            <select
              v-model="selectedCategory"
              class="w-full py-2.5 px-3 text-sm rounded-lg border border-line bg-surface text-ink focus:outline-none focus:ring-2 focus:ring-primary font-medium"
            >
              <option v-for="c in categories" :key="c.id" :value="c.id">{{ c.name }}</option>
              <option v-if="!categories.length" value="" disabled>{{ categoriesFailed ? '카테고리를 불러오지 못했습니다' : '카테고리 불러오는 중…' }}</option>
            </select>
            <p class="text-[11px] text-ink-muted">수집된 상품이 카탈로그에 노출될 1차 상위 카테고리입니다.</p>
          </div>
        </div>
      </div>

      <!-- Live Extraction Preview Card -->
      <div v-if="result" class="bg-surface rounded-2xl shadow-sm border border-line p-6 space-y-6">
        <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-line-divider pb-4">
          <div class="space-y-1">
            <div class="flex items-center gap-2">
              <span class="text-xs bg-primary-soft text-primary-soft-ink font-bold px-2.5 py-0.5 rounded-full font-mono uppercase">
                {{ result.adapter_used }}
              </span>
              <span class="text-xs text-ink-muted font-mono">{{ result.domain }}</span>
            </div>
            <h2 class="text-xl font-bold text-ink">2. 수집 결과 검증 및 판매 등록 승인</h2>
          </div>

          <div class="flex items-center gap-3">
            <!-- AI Translation Button -->
            <button
              @click="handleAiEnhance"
              :disabled="isAiEnhancing"
              class="px-4 py-2 bg-primary hover:bg-primary-hover text-primary-on rounded-xl text-xs font-bold shadow transition flex items-center gap-2 cursor-pointer disabled:opacity-50"
            >
              <LoaderCircle v-if="isAiEnhancing" class="h-4 w-4 animate-spin" aria-hidden="true" />
              <WandSparkles v-else class="h-4 w-4" aria-hidden="true" />
              <span>{{ isAiEnhancing ? 'AI 번역 중...' : 'AI 한국어 자동 번역' }}</span>
            </button>

            <!-- Quality Score Meter -->
            <div class="flex items-center gap-3 bg-surface-2 border border-line px-4 py-2 rounded-xl">
              <div class="text-right">
                <div class="text-[11px] text-ink-muted font-semibold">데이터 품질 지수</div>
                <div class="text-xs font-bold" :class="result.quality_score >= 80 ? 'text-success' : 'text-warning'">
                  {{ result.quality_score >= 80 ? '상용 등록 적격' : '보완 권장' }}
                </div>
              </div>
              <div
                class="w-12 h-12 rounded-full flex items-center justify-center font-black text-lg border-2"
                :class="result.quality_score >= 80 ? 'border-success text-success bg-success-soft' : 'border-warning text-warning bg-warning-soft'"
              >
                {{ result.quality_score }}
              </div>
            </div>
          </div>
        </div>

        <!-- AI Enhancement Result Banner -->
        <div v-if="aiInfo" class="p-4 bg-primary-soft border border-line rounded-xl space-y-2">
          <div class="flex items-center justify-between">
            <span class="text-xs font-bold text-primary-soft-ink flex items-center gap-1.5">
              <Bot class="h-4 w-4 text-primary" aria-hidden="true" />
              AI 번역 적용 완료
            </span>
            <span class="text-[11px] px-2 py-0.5 rounded-full font-mono font-semibold bg-surface-2 text-ink-muted border border-line">
              Provider: {{ aiInfo.provider }}
            </span>
          </div>
          <div v-if="aiInfo.bullets?.length" class="space-y-1 pt-1">
            <div class="text-[11px] font-bold text-ink-muted">핵심 마케팅 셀링 포인트 (Bullets):</div>
            <ul class="text-xs text-ink-muted space-y-0.5 list-disc list-inside">
              <li v-for="(b, i) in aiInfo.bullets" :key="i">{{ b }}</li>
            </ul>
          </div>
        </div>

        <!-- Quality Checks Badges -->
        <div class="flex flex-wrap gap-2 text-xs">
          <span
            v-for="(pass, key) in result.quality_checks"
            :key="key"
            class="px-2.5 py-1 rounded-md font-mono text-[11px] flex items-center gap-1.5"
            :class="pass ? 'bg-success-soft text-success border border-line' : 'bg-surface-2 text-ink-subtle border border-line line-through'"
          >
            <Check v-if="pass" class="h-4 w-4 text-success" aria-hidden="true" /><X v-else class="h-4 w-4 text-ink-subtle" aria-hidden="true" />
            {{ key }}
          </span>
        </div>

        <!-- Product Meta Details Grid -->
        <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <!-- Thumbnail & Images Gallery -->
          <div class="space-y-3">
            <div class="aspect-square bg-surface-2 rounded-xl overflow-hidden border border-line relative group">
              <img
                :src="result.product.thumbnail_url"
                alt="Thumbnail"
                class="w-full h-full object-cover"
              />
              <span class="absolute top-2 left-2 bg-overlay/60 text-white text-[10px] font-bold px-2 py-0.5 rounded">
                메인 대표 썸네일
              </span>
            </div>
            <div v-if="result.product.images?.length > 1" class="flex gap-2 overflow-x-auto pb-1">
              <img
                v-for="(img, idx) in result.product.images.slice(0, 5)"
                :key="idx"
                :src="img"
                class="w-14 h-14 object-cover rounded-lg border border-line flex-shrink-0"
              />
            </div>
          </div>

          <!-- Editable Information & Pricing -->
          <div class="lg:col-span-2 space-y-4">
            <!-- Editable Title -->
            <div class="space-y-1.5">
              <div class="flex items-center justify-between">
                <label class="block text-xs font-bold text-ink-muted">판매 상품명 (수정 가능)</label>
                <span v-if="aiInfo" class="text-[10px] text-primary-soft-ink font-bold bg-primary-soft px-2 py-0.5 rounded border border-line">
                  AI 번역 적용됨
                </span>
              </div>
              <input
                v-model="editedTitle"
                type="text"
                class="w-full px-3.5 py-2 text-sm font-semibold rounded-lg border border-line bg-surface text-ink focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>

            <!-- Pricing Matrix Box -->
            <div class="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-primary-soft p-4 rounded-xl border border-line">
              <div>
                <div class="text-[11px] text-ink-muted font-sans">공급 도매가</div>
                <div class="text-base font-bold font-mono text-ink">
                  ₩{{ result.pricing.wholesale_cost_krw.toLocaleString() }}
                </div>
                <div class="text-[10px] text-ink-subtle">{{ result.product.raw_price }} {{ result.product.currency }}</div>
              </div>

              <div>
                <div class="text-[11px] text-ink-muted font-sans">목표 마진율</div>
                <div class="text-base font-bold font-mono text-primary">
                  +{{ (result.pricing.margin_bps / 100).toFixed(1) }}%
                </div>
                <div class="text-[10px] text-ink-subtle">100원 단위 올림</div>
              </div>

              <div>
                <div class="text-[11px] text-ink-muted font-sans">계산 판매가</div>
                <div class="text-base font-extrabold font-mono text-success">
                  ₩{{ (editedSalePrice || result.pricing.calculated_sale_price).toLocaleString() }}
                </div>
                <div class="text-[10px] text-ink-subtle">정상가 ₩{{ result.pricing.calculated_original_price.toLocaleString() }}</div>
              </div>

              <div>
                <div class="text-[11px] text-ink-muted font-sans">건당 예상 이익</div>
                <div class="text-base font-bold font-mono text-primary">
                  ₩{{ (result.pricing.estimated_margin_krw).toLocaleString() }}
                </div>
                <div class="text-[10px] text-success font-semibold">순이익 보장</div>
              </div>
            </div>

            <!-- Identifiers (6-12) -->
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 rounded-xl border border-line bg-surface-2 p-4">
              <label class="space-y-1 text-xs font-bold text-ink">브랜드 *
                <input v-model="editedBrand" type="text" maxlength="100" class="h-10 w-full rounded-lg border border-line bg-surface px-3 font-normal text-ink" />
              </label>
              <label class="space-y-1 text-xs font-bold text-ink">제조사
                <input v-model="editedManufacturer" type="text" maxlength="100" class="h-10 w-full rounded-lg border border-line bg-surface px-3 font-normal text-ink" />
              </label>
              <label class="space-y-1 text-xs font-bold text-ink">모델명
                <input v-model="editedModel" type="text" maxlength="100" class="h-10 w-full rounded-lg border border-line bg-surface px-3 font-normal text-ink" />
              </label>
              <div class="space-y-1 text-xs font-bold text-ink">
                <label class="block space-y-1">바코드(GTIN) *
                  <input v-model="editedGtin" :disabled="editedGtinExempt" type="text" inputmode="numeric" maxlength="18" placeholder="8·12·13·14자리" class="h-10 w-full rounded-lg border border-line bg-surface px-3 font-mono font-normal text-ink disabled:opacity-50" />
                </label>
                <label class="flex items-center gap-1.5 font-normal text-ink-muted">
                  <input v-model="editedGtinExempt" type="checkbox" class="h-4 w-4" /> 바코드가 없는 상품
                </label>
                <div v-if="editedGtinExempt" class="flex gap-2">
                  <select v-model="editedExemptReason" class="h-10 rounded-lg border border-line bg-surface px-2 font-normal text-ink">
                    <option value="" disabled>사유 선택</option>
                    <option v-for="o in GTIN_EXEMPT_OPTIONS" :key="o.value" :value="o.value">{{ o.label }}</option>
                  </select>
                  <input v-if="editedExemptReason === 'OTHER'" v-model="editedExemptOther" type="text" maxlength="100" placeholder="사유 직접 입력" class="h-10 flex-1 rounded-lg border border-line bg-surface px-3 font-normal text-ink" />
                </div>
              </div>
            </div>

            <!-- Description Preview -->
            <div class="space-y-1">
              <label class="block text-xs font-bold text-ink-muted">상세 설명 요약 (XSS 소독 완료)</label>
              <div
                class="p-3 bg-surface-2 rounded-lg border border-line text-xs text-ink-muted max-h-32 overflow-y-auto leading-relaxed prose prose-sm"
                v-html="safeDescriptionHtml"
              ></div>
            </div>
          </div>
        </div>

        <!-- Multi-dimensional Option Matrix Table -->
        <div class="space-y-3 pt-2">
          <div class="flex items-center justify-between">
            <h3 class="text-sm font-bold text-ink flex items-center gap-2">
              <span>다차원 옵션 매트릭스 (카르테시안 결합)</span>
              <span class="text-xs bg-surface-2 text-ink-muted px-2 py-0.5 rounded font-mono">
                총 {{ result.variants.length }}개 SKU 조합
              </span>
            </h3>
            <span class="text-[11px] text-warning bg-warning-soft border border-line px-2 py-0.5 rounded">
              ⚠️ 미확인 재고는 안전을 위해 UNKNOWN으로 표기됩니다.
            </span>
          </div>

          <div class="overflow-x-auto border border-line rounded-xl">
            <table class="w-full text-xs text-left">
              <thead class="bg-surface-2 text-ink-muted font-bold border-b border-line">
                <tr>
                  <th class="px-3 py-2.5">옵션 조합</th>
                  <th class="px-3 py-2.5">SKU 코드</th>
                  <th class="px-3 py-2.5 text-right">공급원가</th>
                  <th class="px-3 py-2.5 text-right">최종 판매가</th>
                  <th class="px-3 py-2.5 text-center">초기 재고</th>
                  <th class="px-3 py-2.5 text-center">재고 신뢰도</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-line-divider font-mono">
                <tr v-for="(v, idx) in result.variants" :key="idx" class="hover:bg-surface-2">
                  <td class="px-3 py-2 font-sans font-medium text-ink">{{ v.option_summary }}</td>
                  <td class="px-3 py-2 text-ink-muted">{{ v.variant_code }}</td>
                  <td class="px-3 py-2 text-right text-ink-muted">₩{{ (result.pricing.wholesale_cost_krw).toLocaleString() }}</td>
                  <td class="px-3 py-2 text-right font-bold text-ink">₩{{ (v.price || result.pricing.calculated_sale_price).toLocaleString() }}</td>
                  <td class="px-3 py-2 text-center text-ink-muted">{{ v.stock_quantity }}개</td>
                  <td class="px-3 py-2 text-center">
                    <span
                      class="text-[10px] px-2 py-0.5 rounded-full font-bold"
                      :class="v.stock_status === 'IN_STOCK' ? 'bg-success-soft text-success' : 'bg-surface-2 text-ink-muted'"
                    >
                      {{ v.stock_status }}
                    </span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <!-- Action Footer -->
        <div class="flex flex-col sm:flex-row items-center justify-end gap-3 pt-4 border-t border-line-divider">
          <label class="flex w-full sm:w-auto items-center gap-2 text-xs font-bold text-ink">배송정책 (필수)
            <select v-model="selectedPolicy" class="h-10 rounded-lg border border-line bg-surface px-2 text-ink">
              <option value="" disabled>배송정책 선택</option>
              <option v-for="p in policies" :key="p.id" :value="p.id">{{ p.name }}{{ Number(p.is_default) === 1 ? ' (기본)' : '' }}</option>
            </select>
          </label>
          <button
            @click="result = null; aiInfo = null"
            class="w-full sm:w-auto px-4 py-2.5 text-ink-muted hover:text-ink text-xs font-bold transition cursor-pointer"
          >
            취소하고 다시 입력
          </button>
          <button
            @click="handlePublish"
            :disabled="isPublishing"
            class="w-full sm:w-auto px-6 py-2.5 bg-success disabled:bg-surface-3 disabled:text-ink-subtle text-primary-on text-sm font-bold rounded-xl shadow-lg transition flex items-center justify-center gap-2 cursor-pointer"
          >
            <LoaderCircle v-if="isPublishing" class="h-4 w-4 animate-spin" aria-hidden="true" />
            <Check v-else class="h-4 w-4" aria-hidden="true" />
            <span>{{ isPublishing ? '카탈로그 등록 중...' : '공식 판매 승인 및 카탈로그 등록' }}</span>
          </button>
        </div>
      </div>
    </div>

    <!-- TAB 2: Bulk URLs Mode -->
    <div v-else-if="activeMode === 'bulk'" class="space-y-6">
      <div class="bg-surface rounded-2xl shadow-sm border border-line p-6 space-y-6">
        <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-line-divider pb-4">
          <div>
            <h2 class="text-lg font-bold text-ink">대량 URL 일괄 수집 엔진</h2>
            <p class="text-xs text-ink-muted">한 번에 최대 50개의 외부 상품 링크를 일괄 크롤링하고 수집 작업을 큐잉합니다.</p>
          </div>
          <span class="text-xs bg-primary-soft text-primary-soft-ink border border-line px-3 py-1.5 rounded-lg font-semibold flex items-center gap-1.5">
            <Zap class="h-4 w-4" aria-hidden="true" />
            <span>Feature Flag: bulk_crawler</span>
          </span>
        </div>

        <!-- Bulk URL Textarea -->
        <div class="space-y-2">
          <div class="flex justify-between items-center text-xs font-bold text-ink-muted">
            <span>상품 URL 목록 (줄바꿈으로 구분)</span>
            <span class="text-ink-subtle font-mono">최대 50개</span>
          </div>
          <textarea
            v-model="bulkUrlsInput"
            rows="6"
            placeholder="상품 URL 목록을 줄바꿈으로 구분해 입력하세요 (최대 50개)"
            class="w-full p-3 text-xs font-mono rounded-xl border border-line bg-surface text-ink focus:outline-none focus:ring-2 focus:ring-primary leading-relaxed"
          ></textarea>
        </div>

        <!-- Margin & Category for Bulk -->
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div class="space-y-1 bg-surface-2 p-3 rounded-xl border border-line">
            <div class="flex justify-between text-xs font-bold text-ink-muted">
              <span>일괄 적용 마진율:</span>
              <span class="text-primary font-mono">{{ targetMargin }}%</span>
            </div>
            <input
              v-model.number="targetMargin"
              type="range"
              min="10"
              max="60"
              step="5"
              class="w-full accent-primary cursor-pointer"
            />
          </div>
          <div class="space-y-1 bg-surface-2 p-3 rounded-xl border border-line">
            <label class="block text-xs font-bold text-ink-muted">일괄 카테고리</label>
            <select
              v-model="selectedCategory"
              class="w-full py-2 px-3 text-xs rounded-lg border border-line bg-surface text-ink focus:outline-none focus:ring-2 focus:ring-primary font-medium"
            >
              <option v-for="c in categories" :key="c.id" :value="c.id">{{ c.name }}</option>
              <option v-if="!categories.length" value="" disabled>{{ categoriesFailed ? '카테고리를 불러오지 못했습니다' : '카테고리 불러오는 중…' }}</option>
            </select>
            <button v-if="categoriesFailed" @click="loadCategories" class="mt-1 text-[11px] font-bold text-primary hover:underline">다시 불러오기</button>
          </div>
        </div>

        <!-- Execution Button -->
        <div class="flex justify-end pt-2">
          <button
            @click="handleBulkCrawl"
            :disabled="isBulkLoading"
            class="px-6 py-2.5 bg-primary hover:bg-primary-hover disabled:bg-surface-3 disabled:text-ink-subtle text-primary-on text-sm font-bold rounded-xl shadow transition flex items-center gap-2 cursor-pointer"
          >
            <LoaderCircle v-if="isBulkLoading" class="h-4 w-4 animate-spin" aria-hidden="true" />
            <Layers v-else class="h-4 w-4" aria-hidden="true" />
            <span>{{ isBulkLoading ? '대량 일괄 수집 중...' : '대량 수집 실행' }}</span>
          </button>
        </div>
      </div>

      <!-- Bulk Execution Results Table -->
      <div v-if="bulkResult" class="bg-surface rounded-2xl shadow-sm border border-line p-6 space-y-4">
        <div class="flex items-center justify-between border-b border-line-divider pb-3">
          <div>
            <h3 class="text-base font-bold text-ink">대량 수집 실행 결과 요약</h3>
            <p class="text-xs text-ink-muted">배치 작업으로 생성된 개별 수집 작업 내역입니다.</p>
          </div>
          <div class="flex items-center gap-2">
            <span class="text-xs bg-surface-2 text-ink-muted px-2.5 py-1 rounded-lg font-bold">
              총 {{ bulkResult.total_requested }}건
            </span>
            <span class="text-xs bg-success-soft text-success px-2.5 py-1 rounded-lg font-bold">
              성공 {{ bulkResult.successful }}건
            </span>
            <span v-if="bulkResult.failed > 0" class="text-xs bg-danger-soft text-danger px-2.5 py-1 rounded-lg font-bold">
              실패 {{ bulkResult.failed }}건
            </span>
          </div>
        </div>

        <div class="overflow-x-auto">
          <table class="w-full text-xs text-left">
            <thead class="bg-surface-2 text-ink-muted font-bold border-b border-line">
              <tr>
                <th class="px-3 py-2">수집 URL</th>
                <th class="px-3 py-2 text-center">상태</th>
                <th class="px-3 py-2 text-center">품질 점수</th>
                <th class="px-3 py-2">추출 상품명 / 에러</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-line-divider font-mono">
              <tr v-for="(item, idx) in bulkResult.data" :key="idx" class="hover:bg-surface-2">
                <td class="px-3 py-2 text-ink-muted max-w-xs truncate" :title="item.url">
                  {{ item.url }}
                </td>
                <td class="px-3 py-2 text-center font-sans">
                  <span
                    class="px-2 py-0.5 rounded-full text-[10px] font-bold"
                    :class="item.status === 'ANALYZED' ? 'bg-success-soft text-success' : 'bg-danger-soft text-danger'"
                  >
                    {{ item.status }}
                  </span>
                </td>
                <td class="px-3 py-2 text-center font-bold" :class="item.quality_score >= 80 ? 'text-success' : 'text-warning'">
                  {{ item.quality_score }}점
                </td>
                <td class="px-3 py-2 font-sans text-ink max-w-sm truncate">
                  <span v-if="item.title">{{ item.title }}</span>
                  <span v-else-if="item.error" class="text-danger text-xs">{{ item.error }}</span>
                  <span v-else class="text-ink-subtle">-</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <!-- Recent Import Jobs Table -->
    <div class="bg-surface rounded-2xl shadow-sm border border-line p-6 space-y-4">
      <div class="flex items-center justify-between border-b border-line-divider pb-3">
        <div>
          <h2 class="text-base font-bold text-ink">최근 URL 수집 및 등록 이력</h2>
          <p class="text-xs text-ink-muted">최근 실행된 수집 작업의 상태 및 품질 지수를 확인합니다.</p>
        </div>
        <button
          @click="loadHistory"
          class="text-xs text-primary hover:underline font-medium flex items-center gap-1 cursor-pointer"
        >
          <RotateCw class="h-4 w-4" aria-hidden="true" /> 새로고침
        </button>
      </div>

      <div v-if="historyError" class="bg-danger-soft border border-line text-danger rounded-xl px-4 py-3 text-xs font-medium flex items-center gap-2">
        <CircleAlert class="h-4 w-4" aria-hidden="true" />
        <span>{{ historyError }}</span>
        <button @click="loadHistory" class="ml-auto font-bold underline hover:underline cursor-pointer">다시 시도</button>
      </div>

      <div class="overflow-x-auto">
        <table class="w-full text-xs text-left">
          <thead class="bg-surface-2 text-ink-muted font-bold border-b border-line">
            <tr>
              <th class="px-3 py-2.5">수집 도메인</th>
              <th class="px-3 py-2.5">출처 URL</th>
              <th class="px-3 py-2.5 text-center">품질 점수</th>
              <th class="px-3 py-2.5 text-center">진행 상태</th>
              <th class="px-3 py-2.5">등록 상품명</th>
              <th class="px-3 py-2.5 text-right">수집 일시</th>
              <th class="px-3 py-2.5 text-center">작업</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-line-divider">
            <tr v-if="jobsHistory.length === 0">
              <td colspan="7" class="px-3 py-8 text-center text-ink-subtle">
                아직 수집된 상품 이력이 없습니다. 상단에서 URL을 입력해 첫 상품을 수집해 보세요.
              </td>
            </tr>
            <tr v-for="job in jobsHistory" :key="job.id" class="hover:bg-surface-2 font-mono">
              <td class="px-3 py-2.5 font-bold text-ink-muted">{{ job.domain }}</td>
              <td class="px-3 py-2.5 text-ink-muted max-w-xs truncate" :title="job.source_url">
                <a :href="job.source_url" target="_blank" class="hover:underline flex items-center gap-1">
                  <span>{{ job.source_url }}</span>
                  <ArrowUpRight class="h-4 w-4 text-[9px]" aria-hidden="true" />
                </a>
              </td>
              <td class="px-3 py-2.5 text-center">
                <span
                  class="px-2 py-0.5 rounded font-bold text-[10px]"
                  :class="job.quality_score >= 80 ? 'bg-success-soft text-success' : 'bg-warning-soft text-warning'"
                >
                  {{ job.quality_score }}점
                </span>
              </td>
              <td class="px-3 py-2.5 text-center font-sans">
                <span
                  class="px-2 py-0.5 rounded-full text-[10px] font-bold"
                  :class="{
                    'bg-success-soft text-success': job.status === 'PUBLISHED',
                    'bg-primary-soft text-primary-soft-ink': job.status === 'ANALYZED' || job.status === 'EXTRACTED',
                    'bg-surface-2 text-ink-muted': job.status === 'PENDING',
                    'bg-danger-soft text-danger': job.status === 'FAILED'
                  }"
                >
                  {{ job.status }}
                </span>
              </td>
              <td class="px-3 py-2.5 font-sans font-medium text-ink max-w-xs truncate">
                {{ job.published_title || '-' }}
              </td>
              <td class="px-3 py-2.5 text-right text-ink-subtle text-[11px]">
                {{ job.created_at ? new Date(job.created_at).toLocaleDateString() : '-' }}
              </td>
              <td class="px-3 py-2.5 text-center font-sans">
                <span v-if="job.status === 'PUBLISHED'" class="text-success font-bold">등록됨</span>
                <span v-else-if="job.status === 'FAILED'" class="text-danger font-bold">실패</span>
                <span v-else-if="job.status === 'PENDING'" class="text-ink-subtle">수집 중</span>
                <button
                  v-else
                  @click="loadJobIntoEditor(job.id)"
                  :disabled="isRecalling"
                  class="px-2.5 py-1 rounded-lg bg-primary text-primary-on font-bold hover:bg-primary-hover disabled:opacity-50 cursor-pointer"
                >
                  {{ isRecalling ? '불러오는 중…' : '불러오기' }}
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</template>
