<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { API_BASE, getPartnerHeaders } from '../config';

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
const selectedCategory = ref('cat_e_audio');
const htmlOverride = ref('');
const isCustomHtml = ref(false);

// Execution state
const isLoading = ref(false);
const isBulkLoading = ref(false);
const isPublishing = ref(false);
const isAiEnhancing = ref(false);
const errorMsg = ref('');
const successMsg = ref('');

// Extracted data
const result = ref<CrawlResult | null>(null);
const editedTitle = ref('');
const editedSalePrice = ref<number | null>(null);
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
      <meta property="og:image" content="https://images.unsplash.com/photo-1506629082955-511b1aa562c8" />
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
        "image": ["https://images.unsplash.com/photo-1505740420928-5e560c06d30e"],
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
      <meta property="og:image" content="https://images.unsplash.com/photo-1558317374-067fb5f30001" />
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
  try {
    const res = await fetch(`${API_BASE}/api/v1/imports/jobs`, {
      headers: getPartnerHeaders()
    });
    if (res.ok) {
      const data = await res.json();
      jobsHistory.value = data.data || [];
    }
  } catch (err) {
    console.error('Failed to load import jobs history:', err);
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
    successMsg.value = `✓ 상품 정보 추출 완료! (품질 점수: ${data.data.quality_score}점)`;
    loadHistory();
  } catch (err: any) {
    errorMsg.value = err.message || '요청 처리 중 오류가 발생했습니다.';
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
    successMsg.value = `✨ AI 한국어 번역 및 마케팅 가공 완료! (${data.data.provider})`;
  } catch (err: any) {
    errorMsg.value = err.message || 'AI 가공 처리 중 오류가 발생했습니다.';
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
    errorMsg.value = err.message || '대량 수집 처리 중 오류가 발생했습니다.';
  } finally {
    isBulkLoading.value = false;
  }
}

async function handlePublish() {
  if (!result.value) return;
  isPublishing.value = true;
  errorMsg.value = '';
  successMsg.value = '';

  try {
    const publishPayload = {
      title: editedTitle.value || result.value.product.title,
      sale_price: editedSalePrice.value || result.value.pricing.calculated_sale_price,
      original_price: result.value.pricing.calculated_original_price,
      wholesale_cost: result.value.pricing.wholesale_cost_krw,
      category_id: selectedCategory.value,
      thumbnail_url: result.value.product.thumbnail_url,
      description_html: result.value.product.description_html,
      brand: result.value.product.brand,
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

    successMsg.value = `🎉 상품이 카탈로그에 공식 판매 등록되었습니다! (상품 ID: ${data.product_id}, SKU: ${data.sku_count}개)`;
    loadHistory();
  } catch (err: any) {
    errorMsg.value = err.message || '등록 중 오류가 발생했습니다.';
  } finally {
    isPublishing.value = false;
  }
}

onMounted(() => {
  loadHistory();
});
</script>

<template>
  <div class="max-w-7xl mx-auto px-4 py-8 space-y-8">
    <!-- Header Hero Banner -->
    <div class="bg-gradient-to-r from-indigo-950 via-slate-900 to-indigo-900 rounded-2xl p-6 sm:p-8 text-white shadow-xl relative overflow-hidden">
      <div class="relative z-10 space-y-2">
        <div class="inline-flex items-center gap-2 bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 px-3 py-1 rounded-full text-xs font-semibold">
          <i class="fa-solid fa-cloud-arrow-down text-emerald-400"></i>
          <span>GLOBAL URL CRAWLER & 3PL SYSTEM</span>
        </div>
        <h1 class="text-2xl sm:text-3xl font-extrabold tracking-tight">URL 기반 상품 자동 수집 & 3PL 위탁판매 등록</h1>
        <p class="text-sm sm:text-base text-slate-300 max-w-3xl leading-relaxed">
          외부 공급업체, 글로벌 쇼핑몰의 상품 링크 하나로 메타데이터, 다차원 옵션(색상×사이즈), 고해상도 이미지를 자동 수집합니다.
          자동 마진 계산기와 SSRF 차단 엔진, AI 한국어 번역 가공기를 통해 안전하고 신속하게 정식 카탈로그에 판매 상품으로 등록하세요.
        </p>
      </div>
      <div class="absolute -right-8 -bottom-8 opacity-10 text-white text-9xl pointer-events-none">
        <i class="fa-solid fa-globe"></i>
      </div>
    </div>

    <!-- Alert Messages -->
    <div v-if="errorMsg" class="p-4 bg-rose-50 border border-rose-200 text-rose-800 rounded-xl flex items-center gap-3">
      <i class="fa-solid fa-triangle-exclamation text-rose-500 text-lg flex-shrink-0"></i>
      <span class="text-sm font-medium">{{ errorMsg }}</span>
    </div>
    <div v-if="successMsg" class="p-4 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-xl flex items-center gap-3">
      <i class="fa-solid fa-circle-check text-emerald-500 text-lg flex-shrink-0"></i>
      <span class="text-sm font-medium">{{ successMsg }}</span>
    </div>

    <!-- Mode Selector Tabs -->
    <div class="flex items-center gap-2 border-b border-slate-200 pb-2">
      <button
        @click="activeMode = 'single'"
        type="button"
        class="px-5 py-2.5 rounded-xl font-bold text-sm transition flex items-center gap-2 cursor-pointer"
        :class="activeMode === 'single' ? 'bg-indigo-600 text-white shadow' : 'bg-white text-slate-600 hover:bg-slate-100 border border-slate-200'"
      >
        <i class="fa-solid fa-link"></i>
        <span>단일 URL 정밀 수집 (Single Mode)</span>
      </button>
      <button
        @click="activeMode = 'bulk'"
        type="button"
        class="px-5 py-2.5 rounded-xl font-bold text-sm transition flex items-center gap-2 cursor-pointer"
        :class="activeMode === 'bulk' ? 'bg-indigo-600 text-white shadow' : 'bg-white text-slate-600 hover:bg-slate-100 border border-slate-200'"
      >
        <i class="fa-solid fa-layer-group"></i>
        <span>대량 URL 일괄 수집 (Bulk Mode)</span>
      </button>
    </div>

    <!-- TAB 1: Single URL Mode -->
    <div v-if="activeMode === 'single'" class="space-y-6">
      <div class="bg-white rounded-2xl shadow-sm border border-slate-200 p-6 space-y-6">
        <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100 pb-4">
          <div>
            <h2 class="text-lg font-bold text-slate-900">1. 상품 URL 입력 및 마진율 설정</h2>
            <p class="text-xs text-slate-500">지원 프로토콜: HTTP/HTTPS (Shopify, Schema.org, OpenGraph 자동 감지)</p>
          </div>
          <div class="flex items-center gap-2 text-xs text-slate-600 bg-slate-50 px-3 py-1.5 rounded-lg border border-slate-200">
            <i class="fa-solid fa-shield-halved text-emerald-500"></i>
            <span>SSRF 사설 IP 및 Cloud Metadata 접근 100% 원천 차단</span>
          </div>
        </div>

        <!-- Quick Fill Sample Presets -->
        <div class="space-y-2">
          <span class="text-xs font-semibold text-slate-600">빠른 테스트 샘플 URL 프리셋:</span>
          <div class="flex flex-wrap gap-2">
            <button
              v-for="(s, idx) in samples"
              :key="idx"
              type="button"
              @click="applySample(s)"
              class="text-xs bg-slate-100 hover:bg-indigo-50 hover:text-indigo-700 hover:border-indigo-200 text-slate-700 px-3 py-1.5 rounded-lg border border-slate-200 transition font-medium cursor-pointer"
            >
              ⚡ {{ s.name }}
            </button>
          </div>
        </div>

        <!-- URL Input Field -->
        <div class="space-y-2">
          <label class="block text-xs font-bold text-slate-700 uppercase tracking-wider">수집 대상 상품 URL</label>
          <div class="flex gap-2">
            <div class="relative flex-1">
              <span class="absolute inset-y-0 left-0 pl-3.5 flex items-center text-slate-400">
                <i class="fa-solid fa-link"></i>
              </span>
              <input
                v-model="urlInput"
                type="url"
                placeholder="https://example-supplier.com/products/item-12345"
                class="w-full pl-10 pr-4 py-2.5 text-sm rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-indigo-500 font-mono"
              />
            </div>
            <button
              @click="handleCrawl"
              :disabled="isLoading"
              class="px-6 py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-400 text-white text-sm font-bold rounded-xl shadow transition flex items-center gap-2 cursor-pointer"
            >
              <i v-if="isLoading" class="fa-solid fa-spinner fa-spin"></i>
              <i v-else class="fa-solid fa-magnifying-glass"></i>
              <span>{{ isLoading ? '수집 및 분석 중...' : '상품 수집' }}</span>
            </button>
          </div>
        </div>

        <!-- Pricing & Category Parameters -->
        <div class="grid grid-cols-1 md:grid-cols-2 gap-6 pt-2">
          <!-- Margin Slider -->
          <div class="space-y-2 bg-slate-50 p-4 rounded-xl border border-slate-200">
            <div class="flex justify-between items-center text-xs">
              <span class="font-bold text-slate-700">판매 목표 마진율 (Markup %)</span>
              <span class="font-extrabold text-indigo-600 text-base font-mono">{{ targetMargin }}%</span>
            </div>
            <input
              v-model.number="targetMargin"
              type="range"
              min="10"
              max="60"
              step="5"
              class="w-full accent-indigo-600 cursor-pointer"
            />
            <div class="flex justify-between text-[11px] text-slate-400 font-mono">
              <span>10% (박리다매)</span>
              <span>25% (추천 기본값)</span>
              <span>60% (고마진 프리미엄)</span>
            </div>
          </div>

          <!-- Target Category -->
          <div class="space-y-2 bg-slate-50 p-4 rounded-xl border border-slate-200">
            <label class="block text-xs font-bold text-slate-700">등록 기본 카테고리</label>
            <select
              v-model="selectedCategory"
              class="w-full py-2.5 px-3 text-sm rounded-lg border border-slate-300 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500 font-medium"
            >
              <option value="cat_e_audio">디지털/가전 &gt; 음향기기 (헤드폰/스피커)</option>
              <option value="cat_f_men">패션의류 &gt; 남성의류</option>
              <option value="cat_f_women">패션의류 &gt; 여성의류</option>
              <option value="cat_f_shoes">신발 &gt; 스포츠/스니커즈</option>
              <option value="cat_l_kitchen">생활/주방 &gt; 주방가전/청소</option>
              <option value="cat_s_outdoor">스포츠/레저 &gt; 캠핑/아웃도어</option>
            </select>
            <p class="text-[11px] text-slate-500">수집된 상품이 카탈로그에 노출될 1차 상위 카테고리입니다.</p>
          </div>
        </div>
      </div>

      <!-- Live Extraction Preview Card -->
      <div v-if="result" class="bg-white rounded-2xl shadow-sm border border-slate-200 p-6 space-y-6">
        <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-100 pb-4">
          <div class="space-y-1">
            <div class="flex items-center gap-2">
              <span class="text-xs bg-indigo-100 text-indigo-700 font-bold px-2.5 py-0.5 rounded-full font-mono uppercase">
                {{ result.adapter_used }}
              </span>
              <span class="text-xs text-slate-500 font-mono">{{ result.domain }}</span>
            </div>
            <h2 class="text-xl font-bold text-slate-900">2. 수집 결과 검증 및 판매 등록 승인</h2>
          </div>

          <div class="flex items-center gap-3">
            <!-- AI Translation Button -->
            <button
              @click="handleAiEnhance"
              :disabled="isAiEnhancing"
              class="px-4 py-2 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700 text-white rounded-xl text-xs font-bold shadow transition flex items-center gap-2 cursor-pointer disabled:opacity-50"
            >
              <i v-if="isAiEnhancing" class="fa-solid fa-spinner fa-spin"></i>
              <i v-else class="fa-solid fa-wand-magic-sparkles text-amber-300"></i>
              <span>{{ isAiEnhancing ? 'AI 번역·가공 중...' : '✨ AI 한국어 자동 번역 및 마케팅 가공' }}</span>
            </button>

            <!-- Quality Score Meter -->
            <div class="flex items-center gap-3 bg-slate-50 border border-slate-200 px-4 py-2 rounded-xl">
              <div class="text-right">
                <div class="text-[11px] text-slate-500 font-semibold">데이터 품질 지수</div>
                <div class="text-xs font-bold" :class="result.quality_score >= 80 ? 'text-emerald-600' : 'text-amber-600'">
                  {{ result.quality_score >= 80 ? '상용 등록 적격' : '보완 권장' }}
                </div>
              </div>
              <div
                class="w-12 h-12 rounded-full flex items-center justify-center font-black text-lg border-2"
                :class="result.quality_score >= 80 ? 'border-emerald-500 text-emerald-600 bg-emerald-50' : 'border-amber-500 text-amber-600 bg-amber-50'"
              >
                {{ result.quality_score }}
              </div>
            </div>
          </div>
        </div>

        <!-- AI Enhancement Result Banner -->
        <div v-if="aiInfo" class="p-4 bg-gradient-to-r from-purple-50 to-indigo-50 border border-purple-200 rounded-xl space-y-2">
          <div class="flex items-center justify-between">
            <span class="text-xs font-bold text-purple-900 flex items-center gap-1.5">
              <i class="fa-solid fa-robot text-purple-600"></i>
              AI 마케팅 로컬라이제이션 완료
            </span>
            <span class="text-[11px] px-2 py-0.5 rounded-full font-mono font-semibold bg-purple-100 text-purple-800 border border-purple-200">
              Provider: {{ aiInfo.provider }}
            </span>
          </div>
          <div v-if="aiInfo.bullets?.length" class="space-y-1 pt-1">
            <div class="text-[11px] font-bold text-slate-700">핵심 마케팅 셀링 포인트 (Bullets):</div>
            <ul class="text-xs text-slate-700 space-y-0.5 list-disc list-inside">
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
            :class="pass ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-slate-100 text-slate-400 border border-slate-200 line-through'"
          >
            <i :class="pass ? 'fa-solid fa-check text-emerald-500' : 'fa-solid fa-xmark text-slate-400'"></i>
            {{ key }}
          </span>
        </div>

        <!-- Product Meta Details Grid -->
        <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <!-- Thumbnail & Images Gallery -->
          <div class="space-y-3">
            <div class="aspect-square bg-slate-100 rounded-xl overflow-hidden border border-slate-200 relative group">
              <img
                :src="result.product.thumbnail_url"
                alt="Thumbnail"
                class="w-full h-full object-cover"
              />
              <span class="absolute top-2 left-2 bg-black/60 text-white text-[10px] font-bold px-2 py-0.5 rounded">
                메인 대표 썸네일
              </span>
            </div>
            <div v-if="result.product.images?.length > 1" class="flex gap-2 overflow-x-auto pb-1">
              <img
                v-for="(img, idx) in result.product.images.slice(0, 5)"
                :key="idx"
                :src="img"
                class="w-14 h-14 object-cover rounded-lg border border-slate-200 flex-shrink-0"
              />
            </div>
          </div>

          <!-- Editable Information & Pricing -->
          <div class="lg:col-span-2 space-y-4">
            <!-- Editable Title -->
            <div class="space-y-1.5">
              <div class="flex items-center justify-between">
                <label class="block text-xs font-bold text-slate-700">판매 상품명 (수정 가능)</label>
                <span v-if="aiInfo" class="text-[10px] text-purple-600 font-bold bg-purple-50 px-2 py-0.5 rounded border border-purple-200">
                  AI 번역 적용됨
                </span>
              </div>
              <input
                v-model="editedTitle"
                type="text"
                class="w-full px-3.5 py-2 text-sm font-semibold rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>

            <!-- Pricing Matrix Box -->
            <div class="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-indigo-50/50 p-4 rounded-xl border border-indigo-100">
              <div>
                <div class="text-[11px] text-slate-500">공급 도매가</div>
                <div class="text-base font-bold font-mono text-slate-800">
                  ₩{{ result.pricing.wholesale_cost_krw.toLocaleString() }}
                </div>
                <div class="text-[10px] text-slate-400">{{ result.product.raw_price }} {{ result.product.currency }}</div>
              </div>

              <div>
                <div class="text-[11px] text-slate-500">목표 마진율</div>
                <div class="text-base font-bold font-mono text-indigo-600">
                  +{{ (result.pricing.margin_bps / 100).toFixed(1) }}%
                </div>
                <div class="text-[10px] text-slate-400">100원 단위 올림</div>
              </div>

              <div>
                <div class="text-[11px] text-slate-500">계산 판매가</div>
                <div class="text-base font-extrabold font-mono text-emerald-600">
                  ₩{{ (editedSalePrice || result.pricing.calculated_sale_price).toLocaleString() }}
                </div>
                <div class="text-[10px] text-slate-400">정상가 ₩{{ result.pricing.calculated_original_price.toLocaleString() }}</div>
              </div>

              <div>
                <div class="text-[11px] text-slate-500">건당 예상 이익</div>
                <div class="text-base font-bold font-mono text-indigo-700">
                  ₩{{ (result.pricing.estimated_margin_krw).toLocaleString() }}
                </div>
                <div class="text-[10px] text-emerald-600 font-semibold">순이익 보장</div>
              </div>
            </div>

            <!-- Description Preview -->
            <div class="space-y-1">
              <label class="block text-xs font-bold text-slate-700">상세 설명 요약 (XSS 소독 완료)</label>
              <div
                class="p-3 bg-slate-50 rounded-lg border border-slate-200 text-xs text-slate-700 max-h-32 overflow-y-auto leading-relaxed prose prose-sm"
                v-html="result.product.description_html"
              ></div>
            </div>
          </div>
        </div>

        <!-- Multi-dimensional Option Matrix Table -->
        <div class="space-y-3 pt-2">
          <div class="flex items-center justify-between">
            <h3 class="text-sm font-bold text-slate-900 flex items-center gap-2">
              <span>다차원 옵션 매트릭스 (카르테시안 결합)</span>
              <span class="text-xs bg-slate-100 text-slate-600 px-2 py-0.5 rounded font-mono">
                총 {{ result.variants.length }}개 SKU 조합
              </span>
            </h3>
            <span class="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded">
              ⚠️ 미확인 재고는 안전을 위해 UNKNOWN으로 표기됩니다.
            </span>
          </div>

          <div class="overflow-x-auto border border-slate-200 rounded-xl">
            <table class="w-full text-xs text-left">
              <thead class="bg-slate-50 text-slate-600 font-bold border-b border-slate-200">
                <tr>
                  <th class="px-3 py-2.5">옵션 조합</th>
                  <th class="px-3 py-2.5">SKU 코드</th>
                  <th class="px-3 py-2.5 text-right">공급원가</th>
                  <th class="px-3 py-2.5 text-right">최종 판매가</th>
                  <th class="px-3 py-2.5 text-center">초기 재고</th>
                  <th class="px-3 py-2.5 text-center">재고 신뢰도</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-slate-100 font-mono">
                <tr v-for="(v, idx) in result.variants" :key="idx" class="hover:bg-slate-50">
                  <td class="px-3 py-2 font-sans font-medium text-slate-800">{{ v.option_summary }}</td>
                  <td class="px-3 py-2 text-slate-500">{{ v.variant_code }}</td>
                  <td class="px-3 py-2 text-right text-slate-600">₩{{ (result.pricing.wholesale_cost_krw).toLocaleString() }}</td>
                  <td class="px-3 py-2 text-right font-bold text-slate-900">₩{{ (v.price || result.pricing.calculated_sale_price).toLocaleString() }}</td>
                  <td class="px-3 py-2 text-center text-slate-700">{{ v.stock_quantity }}개</td>
                  <td class="px-3 py-2 text-center">
                    <span
                      class="text-[10px] px-2 py-0.5 rounded-full font-bold"
                      :class="v.stock_status === 'IN_STOCK' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600'"
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
        <div class="flex flex-col sm:flex-row items-center justify-end gap-3 pt-4 border-t border-slate-100">
          <button
            @click="result = null; aiInfo = null"
            class="w-full sm:w-auto px-4 py-2.5 text-slate-600 hover:text-slate-800 text-xs font-bold transition cursor-pointer"
          >
            취소하고 다시 입력
          </button>
          <button
            @click="handlePublish"
            :disabled="isPublishing"
            class="w-full sm:w-auto px-6 py-2.5 bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-400 text-white text-sm font-bold rounded-xl shadow-lg transition flex items-center justify-center gap-2 cursor-pointer"
          >
            <i v-if="isPublishing" class="fa-solid fa-spinner fa-spin"></i>
            <i v-else class="fa-solid fa-check"></i>
            <span>{{ isPublishing ? '카탈로그 등록 중...' : '공식 판매 승인 및 카탈로그 등록' }}</span>
          </button>
        </div>
      </div>
    </div>

    <!-- TAB 2: Bulk URLs Mode -->
    <div v-else-if="activeMode === 'bulk'" class="space-y-6">
      <div class="bg-white rounded-2xl shadow-sm border border-slate-200 p-6 space-y-6">
        <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100 pb-4">
          <div>
            <h2 class="text-lg font-bold text-slate-900">대량 URL 일괄 수집 엔진</h2>
            <p class="text-xs text-slate-500">한 번에 최대 50개의 외부 상품 링크를 일괄 크롤링하고 수집 작업을 큐잉합니다.</p>
          </div>
          <span class="text-xs bg-indigo-50 text-indigo-700 border border-indigo-200 px-3 py-1.5 rounded-lg font-semibold flex items-center gap-1.5">
            <i class="fa-solid fa-bolt"></i>
            <span>Feature Flag: bulk_crawler</span>
          </span>
        </div>

        <!-- Bulk URL Textarea -->
        <div class="space-y-2">
          <div class="flex justify-between items-center text-xs font-bold text-slate-700">
            <span>상품 URL 목록 (줄바꿈으로 구분)</span>
            <span class="text-slate-400 font-mono">최대 50개</span>
          </div>
          <textarea
            v-model="bulkUrlsInput"
            rows="6"
            placeholder="https://example-supplier.com/product/12345
https://another-shop.com/items/67890
https://demo-activewear.myshopify.com/products/sample"
            class="w-full p-3 text-xs font-mono rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-indigo-500 leading-relaxed"
          ></textarea>
        </div>

        <!-- Margin & Category for Bulk -->
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div class="space-y-1 bg-slate-50 p-3 rounded-xl border border-slate-200">
            <div class="flex justify-between text-xs font-bold text-slate-700">
              <span>일괄 적용 마진율:</span>
              <span class="text-indigo-600 font-mono">{{ targetMargin }}%</span>
            </div>
            <input
              v-model.number="targetMargin"
              type="range"
              min="10"
              max="60"
              step="5"
              class="w-full accent-indigo-600 cursor-pointer"
            />
          </div>
          <div class="space-y-1 bg-slate-50 p-3 rounded-xl border border-slate-200">
            <label class="block text-xs font-bold text-slate-700">일괄 카테고리</label>
            <select
              v-model="selectedCategory"
              class="w-full py-2 px-3 text-xs rounded-lg border border-slate-300 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500 font-medium"
            >
              <option value="cat_e_audio">디지털/가전 &gt; 음향기기</option>
              <option value="cat_f_men">패션의류 &gt; 남성의류</option>
              <option value="cat_f_women">패션의류 &gt; 여성의류</option>
              <option value="cat_l_kitchen">생활/주방 &gt; 주방가전/청소</option>
            </select>
          </div>
        </div>

        <!-- Execution Button -->
        <div class="flex justify-end pt-2">
          <button
            @click="handleBulkCrawl"
            :disabled="isBulkLoading"
            class="px-6 py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-400 text-white text-sm font-bold rounded-xl shadow transition flex items-center gap-2 cursor-pointer"
          >
            <i v-if="isBulkLoading" class="fa-solid fa-spinner fa-spin"></i>
            <i v-else class="fa-solid fa-layer-group"></i>
            <span>{{ isBulkLoading ? '대량 일괄 수집 중...' : '대량 수집 실행' }}</span>
          </button>
        </div>
      </div>

      <!-- Bulk Execution Results Table -->
      <div v-if="bulkResult" class="bg-white rounded-2xl shadow-sm border border-slate-200 p-6 space-y-4">
        <div class="flex items-center justify-between border-b border-slate-100 pb-3">
          <div>
            <h3 class="text-base font-bold text-slate-900">대량 수집 실행 결과 요약</h3>
            <p class="text-xs text-slate-500">배치 작업으로 생성된 개별 수집 작업 내역입니다.</p>
          </div>
          <div class="flex items-center gap-2">
            <span class="text-xs bg-slate-100 text-slate-700 px-2.5 py-1 rounded-lg font-bold">
              총 {{ bulkResult.total_requested }}건
            </span>
            <span class="text-xs bg-emerald-100 text-emerald-800 px-2.5 py-1 rounded-lg font-bold">
              성공 {{ bulkResult.successful }}건
            </span>
            <span v-if="bulkResult.failed > 0" class="text-xs bg-rose-100 text-rose-800 px-2.5 py-1 rounded-lg font-bold">
              실패 {{ bulkResult.failed }}건
            </span>
          </div>
        </div>

        <div class="overflow-x-auto">
          <table class="w-full text-xs text-left">
            <thead class="bg-slate-50 text-slate-600 font-bold border-b border-slate-200">
              <tr>
                <th class="px-3 py-2">수집 URL</th>
                <th class="px-3 py-2 text-center">상태</th>
                <th class="px-3 py-2 text-center">품질 점수</th>
                <th class="px-3 py-2">추출 상품명 / 에러</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-slate-100 font-mono">
              <tr v-for="(item, idx) in bulkResult.data" :key="idx" class="hover:bg-slate-50">
                <td class="px-3 py-2 text-slate-600 max-w-xs truncate" :title="item.url">
                  {{ item.url }}
                </td>
                <td class="px-3 py-2 text-center font-sans">
                  <span
                    class="px-2 py-0.5 rounded-full text-[10px] font-bold"
                    :class="item.status === 'ANALYZED' ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'"
                  >
                    {{ item.status }}
                  </span>
                </td>
                <td class="px-3 py-2 text-center font-bold" :class="item.quality_score >= 80 ? 'text-emerald-600' : 'text-amber-600'">
                  {{ item.quality_score }}점
                </td>
                <td class="px-3 py-2 font-sans text-slate-800 max-w-sm truncate">
                  <span v-if="item.title">{{ item.title }}</span>
                  <span v-else-if="item.error" class="text-rose-600 text-xs">{{ item.error }}</span>
                  <span v-else class="text-slate-400">-</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <!-- Recent Import Jobs Table -->
    <div class="bg-white rounded-2xl shadow-sm border border-slate-200 p-6 space-y-4">
      <div class="flex items-center justify-between border-b border-slate-100 pb-3">
        <div>
          <h2 class="text-base font-bold text-slate-900">최근 URL 수집 및 등록 이력</h2>
          <p class="text-xs text-slate-500">최근 실행된 수집 작업의 상태 및 품질 지수를 확인합니다.</p>
        </div>
        <button
          @click="loadHistory"
          class="text-xs text-indigo-600 hover:text-indigo-800 font-medium flex items-center gap-1 cursor-pointer"
        >
          <i class="fa-solid fa-rotate-right"></i> 새로고침
        </button>
      </div>

      <div class="overflow-x-auto">
        <table class="w-full text-xs text-left">
          <thead class="bg-slate-50 text-slate-600 font-bold border-b border-slate-200">
            <tr>
              <th class="px-3 py-2.5">수집 도메인</th>
              <th class="px-3 py-2.5">출처 URL</th>
              <th class="px-3 py-2.5 text-center">품질 점수</th>
              <th class="px-3 py-2.5 text-center">진행 상태</th>
              <th class="px-3 py-2.5">등록 상품명</th>
              <th class="px-3 py-2.5 text-right">수집 일시</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-slate-100">
            <tr v-if="jobsHistory.length === 0">
              <td colspan="6" class="px-3 py-8 text-center text-slate-400">
                아직 수집된 상품 이력이 없습니다. 상단에서 URL을 입력해 첫 상품을 수집해 보세요.
              </td>
            </tr>
            <tr v-for="job in jobsHistory" :key="job.id" class="hover:bg-slate-50 font-mono">
              <td class="px-3 py-2.5 font-bold text-slate-700">{{ job.domain }}</td>
              <td class="px-3 py-2.5 text-slate-500 max-w-xs truncate" :title="job.source_url">
                <a :href="job.source_url" target="_blank" class="hover:underline flex items-center gap-1">
                  <span>{{ job.source_url }}</span>
                  <i class="fa-solid fa-arrow-up-right-from-square text-[9px]"></i>
                </a>
              </td>
              <td class="px-3 py-2.5 text-center">
                <span
                  class="px-2 py-0.5 rounded font-bold text-[10px]"
                  :class="job.quality_score >= 80 ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'"
                >
                  {{ job.quality_score }}점
                </span>
              </td>
              <td class="px-3 py-2.5 text-center font-sans">
                <span
                  class="px-2 py-0.5 rounded-full text-[10px] font-bold"
                  :class="{
                    'bg-emerald-100 text-emerald-700': job.status === 'PUBLISHED',
                    'bg-indigo-100 text-indigo-700': job.status === 'ANALYZED' || job.status === 'EXTRACTED',
                    'bg-slate-100 text-slate-700': job.status === 'PENDING',
                    'bg-rose-100 text-rose-700': job.status === 'FAILED'
                  }"
                >
                  {{ job.status }}
                </span>
              </td>
              <td class="px-3 py-2.5 font-sans font-medium text-slate-900 max-w-xs truncate">
                {{ job.published_title || '-' }}
              </td>
              <td class="px-3 py-2.5 text-right text-slate-400 text-[11px]">
                {{ job.created_at ? new Date(job.created_at).toLocaleDateString() : '-' }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</template>
