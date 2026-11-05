<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { API_BASE, getPartnerHeaders } from '../config';

interface Platform {
  id: string;
  name: string;
  country_code: string;
  platform_type: string;
  auth_type: string;
  api_docs_url: string;
  supported_models: string;
  status: string;
}

interface SalesChannel {
  id: string;
  channel_code: string;
  channel_name: string;
  currency: string;
  commission_bps: number;
  platform_name: string;
  country_code: string;
}

interface Credential {
  id: string;
  platform_id: string;
  platform_name: string;
  credential_name: string;
  api_key_masked: string;
  status: string;
  last_verified_at: string;
}

interface ChannelListing {
  id: string;
  sales_channel_id: string;
  channel_name: string;
  product_title: string;
  thumbnail_url: string;
  channel_sale_price: number;
  currency: string;
  status: string;
  external_url?: string;
  created_at: string;
}

interface ChannelOrder {
  id: string;
  external_order_no: string;
  channel_name: string;
  buyer_name: string;
  recipient_name: string;
  shipping_address: string;
  total_order_amount: number;
  currency: string;
  order_status: string;
  collected_at: string;
}

const activeTab = ref<'channels' | 'listings' | 'orders' | 'calculator'>('channels');

// State
const platforms = ref<Platform[]>([]);
const channels = ref<SalesChannel[]>([]);
const credentials = ref<Credential[]>([]);
const listings = ref<ChannelListing[]>([]);
const channelOrders = ref<ChannelOrder[]>([]);

const isLoading = ref(false);
const errorMsg = ref('');
const successMsg = ref('');

// Credential modal form
const showCredModal = ref(false);
const selectedPlatformId = ref('naver_smartstore');
const credAccountName = ref('대표 계정');
const credApiKey = ref('');
const credSecretKey = ref('');
const credVendorId = ref('');
const isSandbox = ref(false);

// Pricing Calculator State
const calcWholesaleCost = ref(25000);
const calcCurrency = ref('KRW');
const calcTargetMargin = ref(25);
const calcChannel = ref('NAVER_SMARTSTORE');
const calcWeightKg = ref(0.6);
const calcIsCrossborder = ref(false);
const calcResult = ref<any>(null);

async function loadData() {
  isLoading.value = true;
  errorMsg.value = '';
  try {
    const headers = getPartnerHeaders();
    // 1. Platforms
    const pRes = await fetch(`${API_BASE}/api/v1/channels/platforms`, { headers });
    if (pRes.ok) platforms.value = (await pRes.json()).data || [];

    // 2. Sales Channels
    const cRes = await fetch(`${API_BASE}/api/v1/channels/sales-channels`, { headers });
    if (cRes.ok) channels.value = (await cRes.json()).data || [];

    // 3. Credentials
    const crRes = await fetch(`${API_BASE}/api/v1/channels/credentials`, { headers });
    if (crRes.ok) credentials.value = (await crRes.json()).data || [];

    // 4. Listings
    const lRes = await fetch(`${API_BASE}/api/v1/channels/listings`, { headers });
    if (lRes.ok) listings.value = (await lRes.json()).data || [];

    // 5. Orders
    const oRes = await fetch(`${API_BASE}/api/v1/channels/orders`, { headers });
    if (oRes.ok) channelOrders.value = (await oRes.json()).data || [];
  } catch (err: any) {
    errorMsg.value = err.message || '데이터 로드 중 오류가 발생했습니다.';
  } finally {
    isLoading.value = false;
  }
}

async function handleSaveCredential() {
  if (!credApiKey.value.trim()) {
    errorMsg.value = 'API Key 또는 Client ID를 입력해 주세요.';
    return;
  }
  try {
    const res = await fetch(`${API_BASE}/api/v1/channels/credentials`, {
      method: 'POST',
      headers: getPartnerHeaders(),
      body: JSON.stringify({
        platform_id: selectedPlatformId.value,
        credential_name: credAccountName.value,
        api_key: credApiKey.value,
        secret_key: credSecretKey.value,
        seller_account_id: credVendorId.value,
        is_sandbox: isSandbox.value
      })
    });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || '계정 연동 저장에 실패했습니다.');

    successMsg.value = data.message || '판매채널 API 계정이 등록되었습니다.';
    showCredModal.value = false;
    credApiKey.value = '';
    credSecretKey.value = '';
    loadData();
  } catch (err: any) {
    errorMsg.value = err.message || '저장 중 오류 발생';
  }
}

async function handleVerify(credId: string) {
  try {
    const res = await fetch(`${API_BASE}/api/v1/channels/credentials/${credId}/verify`, {
      method: 'POST',
      headers: getPartnerHeaders()
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || '연결 검증 실패');
    successMsg.value = data.message || '플랫폼 연결 검증이 완료되었습니다.';
    loadData();
  } catch (err: any) {
    errorMsg.value = err.message || '검증 중 오류 발생';
  }
}

async function handleSyncOrders(channelId: string) {
  try {
    const res = await fetch(`${API_BASE}/api/v1/channels/orders/sync`, {
      method: 'POST',
      headers: getPartnerHeaders(),
      body: JSON.stringify({ sales_channel_id: channelId })
    });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || '주문 수집에 실패했습니다.');
    successMsg.value = data.message || '신규 주문이 동기화되었습니다.';
    loadData();
  } catch (err: any) {
    errorMsg.value = err.message || '주문 동기화 실패';
  }
}

async function handleDispatchPo(orderId: string) {
  try {
    const res = await fetch(`${API_BASE}/api/v1/channels/orders/${orderId}/dispatch-po`, {
      method: 'POST',
      headers: getPartnerHeaders(),
      body: JSON.stringify({ supplier_id: 'domeggook_domeme' })
    });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || '공급사 발주 실패');
    successMsg.value = data.message || '공급업체 발주가 완료되었습니다.';
    loadData();
  } catch (err: any) {
    errorMsg.value = err.message || '발주 중 오류 발생';
  }
}

async function handleFulfill(orderId: string) {
  try {
    const res = await fetch(`${API_BASE}/api/v1/channels/orders/${orderId}/fulfill`, {
      method: 'POST',
      headers: getPartnerHeaders(),
      body: JSON.stringify({ carrier_code: 'CJ_LOGISTICS' })
    });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || '출고 송장 전송 실패');
    successMsg.value = data.message || '3PL 운송장 연동이 완료되었습니다.';
    loadData();
  } catch (err: any) {
    errorMsg.value = err.message || '출고 처리 실패';
  }
}

async function runCalculator() {
  try {
    const res = await fetch(`${API_BASE}/api/v1/channels/pricing/calculate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        wholesale_cost: calcWholesaleCost.value,
        currency: calcCurrency.value,
        target_margin_bps: calcTargetMargin.value * 100,
        channel_code: calcChannel.value,
        weight_kg: calcWeightKg.value,
        is_crossborder: calcIsCrossborder.value
      })
    });
    const data = await res.json();
    if (data.success) {
      calcResult.value = data.data;
    }
  } catch (err) {
    console.error('Failed to calculate pricing:', err);
  }
}

onMounted(() => {
  loadData();
  runCalculator();
});
</script>

<template>
  <div class="max-w-7xl mx-auto px-4 py-8 space-y-8">
    <!-- Header Hero Banner -->
    <div class="bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 rounded-2xl p-6 sm:p-8 text-white shadow-xl relative overflow-hidden">
      <div class="relative z-10 space-y-2">
        <div class="inline-flex items-center gap-2 bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 px-3 py-1 rounded-full text-xs font-semibold">
          <i class="fa-solid fa-network-wired text-cyan-400"></i>
          <span>GLOBAL MULTI-CHANNEL & SUPPLY CHAIN INTEGRATION</span>
        </div>
        <h1 class="text-2xl sm:text-3xl font-extrabold tracking-tight">글로벌 멀티채널 오픈마켓 연동 & 위탁배송 관리</h1>
        <p class="text-sm sm:text-base text-slate-300 max-w-3xl leading-relaxed">
          네이버 스마트스토어, 쿠팡, 11번가, Amazon US 등 전 세계 오픈마켓에 OLMOA 상품을 1-클릭 배포하고,
          외부 마켓 주문 자동 수집부터 B2B 공급사 직발주, 3PL 실시간 송장 연동까지 통합 관리합니다.
        </p>
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

    <!-- Navigation Tabs -->
    <div class="flex items-center gap-2 border-b border-slate-200 pb-2">
      <button
        @click="activeTab = 'channels'"
        type="button"
        class="px-4 py-2.5 rounded-xl font-bold text-xs sm:text-sm transition flex items-center gap-2 cursor-pointer"
        :class="activeTab === 'channels' ? 'bg-indigo-600 text-white shadow' : 'bg-white text-slate-600 hover:bg-slate-100 border border-slate-200'"
      >
        <i class="fa-solid fa-plug"></i>
        <span>판매채널 연결 & 계정 ({{ credentials.length }})</span>
      </button>
      <button
        @click="activeTab = 'listings'"
        type="button"
        class="px-4 py-2.5 rounded-xl font-bold text-xs sm:text-sm transition flex items-center gap-2 cursor-pointer"
        :class="activeTab === 'listings' ? 'bg-indigo-600 text-white shadow' : 'bg-white text-slate-600 hover:bg-slate-100 border border-slate-200'"
      >
        <i class="fa-solid fa-share-nodes"></i>
        <span>채널별 등록 상품 ({{ listings.length }})</span>
      </button>
      <button
        @click="activeTab = 'orders'"
        type="button"
        class="px-4 py-2.5 rounded-xl font-bold text-xs sm:text-sm transition flex items-center gap-2 cursor-pointer"
        :class="activeTab === 'orders' ? 'bg-indigo-600 text-white shadow' : 'bg-white text-slate-600 hover:bg-slate-100 border border-slate-200'"
      >
        <i class="fa-solid fa-cart-shopping"></i>
        <span>외부 채널 주문 & 발주 ({{ channelOrders.length }})</span>
      </button>
      <button
        @click="activeTab = 'calculator'"
        type="button"
        class="px-4 py-2.5 rounded-xl font-bold text-xs sm:text-sm transition flex items-center gap-2 cursor-pointer"
        :class="activeTab === 'calculator' ? 'bg-indigo-600 text-white shadow' : 'bg-white text-slate-600 hover:bg-slate-100 border border-slate-200'"
      >
        <i class="fa-solid fa-calculator"></i>
        <span>글로벌 채널 마진 계산기</span>
      </button>
    </div>

    <!-- TAB 1: Channels & Credentials -->
    <div v-if="activeTab === 'channels'" class="space-y-6">
      <div class="flex items-center justify-between">
        <div>
          <h2 class="text-lg font-bold text-slate-900">연동 가능한 국내외 판매채널 및 B2B 공급망</h2>
          <p class="text-xs text-slate-500">정식 판매자 API 키를 등록하면 채널별 자동 등록과 주문 수집이 활성화됩니다.</p>
        </div>
        <button
          @click="showCredModal = true"
          class="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold shadow flex items-center gap-2 cursor-pointer"
        >
          <i class="fa-solid fa-key"></i>
          <span>새 판매채널 계정 연결</span>
        </button>
      </div>

      <!-- Credentials Cards Grid -->
      <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        <div
          v-for="c in channels"
          :key="c.id"
          class="bg-white rounded-2xl p-5 border border-slate-200 shadow-sm flex flex-col justify-between space-y-4"
        >
          <div class="space-y-2">
            <div class="flex items-center justify-between">
              <span class="text-xs font-bold px-2 py-0.5 rounded-md font-mono" :class="c.country_code === 'KR' ? 'bg-blue-50 text-blue-700' : 'bg-purple-50 text-purple-700'">
                {{ c.country_code }}
              </span>
              <span class="text-xs text-slate-400 font-mono">수수료 {{ (c.commission_bps / 100).toFixed(1) }}%</span>
            </div>
            <h3 class="font-bold text-slate-900 text-base">{{ c.channel_name }}</h3>
            <p class="text-xs text-slate-500">{{ c.platform_name }} 기반 정식 오픈마켓 API</p>
          </div>

          <div class="pt-2 border-t border-slate-100 flex items-center justify-between">
            <button
              @click="handleSyncOrders(c.id)"
              class="text-xs text-indigo-600 hover:text-indigo-800 font-bold flex items-center gap-1 cursor-pointer"
            >
              <i class="fa-solid fa-rotate"></i> 주문 수집 실행
            </button>
            <span class="text-xs bg-emerald-50 text-emerald-700 font-semibold px-2 py-1 rounded">연동 대기중</span>
          </div>
        </div>
      </div>
    </div>

    <!-- TAB 2: Channel Listings -->
    <div v-if="activeTab === 'listings'" class="bg-white rounded-2xl shadow-sm border border-slate-200 p-6 space-y-4">
      <div class="flex items-center justify-between border-b border-slate-100 pb-3">
        <div>
          <h2 class="text-base font-bold text-slate-900">외부 오픈마켓 등록 상품 내역</h2>
          <p class="text-xs text-slate-500">네이버/쿠팡/아마존 등으로 배포된 리스팅 상태를 조회합니다.</p>
        </div>
      </div>

      <div class="overflow-x-auto">
        <table class="w-full text-xs text-left">
          <thead class="bg-slate-50 text-slate-600 font-bold border-b border-slate-200">
            <tr>
              <th class="px-3 py-2.5">판매 채널</th>
              <th class="px-3 py-2.5">상품명</th>
              <th class="px-3 py-2.5 text-right">채널 판매가</th>
              <th class="px-3 py-2.5 text-center">등록 상태</th>
              <th class="px-3 py-2.5">외부 상품 링크</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-slate-100">
            <tr v-if="listings.length === 0">
              <td colspan="5" class="px-3 py-8 text-center text-slate-400">
                아직 외부 오픈마켓에 등록된 상품이 없습니다. 상품 관리 메뉴에서 "외부 채널 배포"를 실행해 보세요.
              </td>
            </tr>
            <tr v-for="l in listings" :key="l.id" class="hover:bg-slate-50">
              <td class="px-3 py-2.5 font-bold text-slate-800">{{ l.channel_name }}</td>
              <td class="px-3 py-2.5 text-slate-700 font-medium">{{ l.product_title }}</td>
              <td class="px-3 py-2.5 text-right font-mono font-bold text-slate-900">₩{{ l.channel_sale_price.toLocaleString() }}</td>
              <td class="px-3 py-2.5 text-center">
                <span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800">
                  {{ l.status }}
                </span>
              </td>
              <td class="px-3 py-2.5 text-indigo-600 font-mono">
                <a v-if="l.external_url" :href="l.external_url" target="_blank" class="hover:underline flex items-center gap-1">
                  <span>바로가기</span>
                  <i class="fa-solid fa-arrow-up-right-from-square text-[9px]"></i>
                </a>
                <span v-else class="text-slate-400">-</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- TAB 3: External Orders & PO Dispatch -->
    <div v-if="activeTab === 'orders'" class="bg-white rounded-2xl shadow-sm border border-slate-200 p-6 space-y-4">
      <div class="flex items-center justify-between border-b border-slate-100 pb-3">
        <div>
          <h2 class="text-base font-bold text-slate-900">외부 판매채널 수집 주문 및 공급사 발주</h2>
          <p class="text-xs text-slate-500">외부 오픈마켓에서 들어온 주문을 B2B 공급사에 1-클릭 위탁 발주하고 3PL로 출고합니다.</p>
        </div>
      </div>

      <div class="overflow-x-auto">
        <table class="w-full text-xs text-left">
          <thead class="bg-slate-50 text-slate-600 font-bold border-b border-slate-200">
            <tr>
              <th class="px-3 py-2.5">외부 주문번호</th>
              <th class="px-3 py-2.5">채널</th>
              <th class="px-3 py-2.5">수령인 / 배송지</th>
              <th class="px-3 py-2.5 text-right">주문금액</th>
              <th class="px-3 py-2.5 text-center">주문 상태</th>
              <th class="px-3 py-2.5 text-center">작업 처리</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-slate-100">
            <tr v-if="channelOrders.length === 0">
              <td colspan="6" class="px-3 py-8 text-center text-slate-400">
                수집된 외부 주문이 없습니다. 판매채널 탭에서 "주문 수집 실행"을 눌러보세요.
              </td>
            </tr>
            <tr v-for="ord in channelOrders" :key="ord.id" class="hover:bg-slate-50">
              <td class="px-3 py-2.5 font-mono font-bold text-slate-800">{{ ord.external_order_no }}</td>
              <td class="px-3 py-2.5 text-slate-600">{{ ord.channel_name }}</td>
              <td class="px-3 py-2.5 text-slate-700">
                <div class="font-medium">{{ ord.recipient_name }}</div>
                <div class="text-[11px] text-slate-400 truncate max-w-xs">{{ ord.shipping_address }}</div>
              </td>
              <td class="px-3 py-2.5 text-right font-mono font-bold text-slate-900">₩{{ ord.total_order_amount.toLocaleString() }}</td>
              <td class="px-3 py-2.5 text-center">
                <span
                  class="px-2 py-0.5 rounded-full text-[10px] font-bold"
                  :class="{
                    'bg-amber-100 text-amber-800': ord.order_status === 'COLLECTED',
                    'bg-indigo-100 text-indigo-800': ord.order_status === 'PO_DISPATCHED',
                    'bg-emerald-100 text-emerald-800': ord.order_status === 'SHIPPED'
                  }"
                >
                  {{ ord.order_status }}
                </span>
              </td>
              <td class="px-3 py-2.5 text-center space-x-1">
                <button
                  v-if="ord.order_status === 'COLLECTED'"
                  @click="handleDispatchPo(ord.id)"
                  class="px-2.5 py-1 bg-indigo-600 hover:bg-indigo-700 text-white rounded text-[11px] font-bold cursor-pointer"
                >
                  B2B 발주
                </button>
                <button
                  v-if="ord.order_status === 'PO_DISPATCHED'"
                  @click="handleFulfill(ord.id)"
                  class="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded text-[11px] font-bold cursor-pointer"
                >
                  3PL 출고·송장연동
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- TAB 4: Global Pricing Calculator -->
    <div v-if="activeTab === 'calculator'" class="bg-white rounded-2xl shadow-sm border border-slate-200 p-6 space-y-6">
      <div>
        <h2 class="text-base font-bold text-slate-900">글로벌 멀티채널 마진 시뮬레이터</h2>
        <p class="text-xs text-slate-500">공급원가, 국제물류비, 관부가세, 채널 수수료, PG 수수료를 실시간 반영하여 역마진을 원천 차단합니다.</p>
      </div>

      <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div class="space-y-4 md:col-span-1 bg-slate-50 p-4 rounded-xl border border-slate-200">
          <div class="space-y-1">
            <label class="text-xs font-bold text-slate-700">공급 도매원가</label>
            <div class="flex gap-2">
              <input v-model.number="calcWholesaleCost" @input="runCalculator" type="number" class="w-full px-3 py-2 text-sm rounded border border-slate-300 font-mono" />
              <select v-model="calcCurrency" @change="runCalculator" class="px-2 py-2 text-xs rounded border border-slate-300 font-bold bg-white">
                <option value="KRW">KRW</option>
                <option value="USD">USD</option>
                <option value="CNY">CNY</option>
              </select>
            </div>
          </div>

          <div class="space-y-1">
            <div class="flex justify-between text-xs font-bold">
              <span>목표 마진율:</span>
              <span class="text-indigo-600 font-mono">{{ calcTargetMargin }}%</span>
            </div>
            <input v-model.number="calcTargetMargin" @input="runCalculator" type="range" min="10" max="50" step="5" class="w-full accent-indigo-600" />
          </div>

          <div class="space-y-1">
            <label class="text-xs font-bold text-slate-700">판매 대상 채널</label>
            <select v-model="calcChannel" @change="runCalculator" class="w-full px-3 py-2 text-xs rounded border border-slate-300 bg-white">
              <option value="NAVER_SMARTSTORE">네이버 스마트스토어 (5.5%)</option>
              <option value="COUPANG_MARKETPLACE">쿠팡 윙 오픈마켓 (10.8%)</option>
              <option value="ELEVEN_STREET_KR">11번가 오픈마켓 (12.0%)</option>
              <option value="AMAZON_US_FBA_MFN">Amazon US (15.0%)</option>
            </select>
          </div>

          <div class="flex items-center gap-2 pt-2">
            <input v-model="calcIsCrossborder" @change="runCalculator" type="checkbox" id="cbCheck" class="rounded accent-indigo-600" />
            <label for="cbCheck" class="text-xs font-semibold text-slate-700 cursor-pointer">해외 직구 크로스보더 상품 (통관/항공운임)</label>
          </div>
        </div>

        <!-- Simulation Result View -->
        <div v-if="calcResult" class="md:col-span-2 space-y-4">
          <div class="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-indigo-50 p-4 rounded-xl border border-indigo-100 font-mono text-center">
            <div>
              <div class="text-[11px] text-slate-500">총 랜드 원가</div>
              <div class="text-base font-bold text-slate-900">₩{{ calcResult.cost_breakdown.total_landed_cost_krw.toLocaleString() }}</div>
            </div>
            <div>
              <div class="text-[11px] text-slate-500">채널 수수료</div>
              <div class="text-base font-bold text-amber-600">₩{{ calcResult.fees_breakdown.channel_commission_krw.toLocaleString() }}</div>
            </div>
            <div>
              <div class="text-[11px] text-slate-500">최종 권장 판매가</div>
              <div class="text-lg font-extrabold text-emerald-600">₩{{ calcResult.pricing_result.sale_price_krw.toLocaleString() }}</div>
            </div>
            <div>
              <div class="text-[11px] text-slate-500">순수익 보장액</div>
              <div class="text-base font-bold text-indigo-700">₩{{ calcResult.pricing_result.net_profit_krw.toLocaleString() }}</div>
            </div>
          </div>

          <div class="text-xs space-y-1 text-slate-600 bg-slate-50 p-4 rounded-xl border border-slate-200 leading-relaxed">
            <p><strong>수수료 세부 내역:</strong> 채널 수수료 {{ (calcResult.fees_breakdown.channel_commission_rate_bps / 100).toFixed(1) }}% + PG 결제수수료 3.0% + 반품 충당금 1.5% 포함</p>
            <p><strong>역마진 방지 가드:</strong> <span class="font-bold text-emerald-600">안전 (보장 순이익 ₩{{ calcResult.pricing_result.net_profit_krw.toLocaleString() }})</span></p>
          </div>
        </div>
      </div>
    </div>

    <!-- Credential Modal -->
    <div v-if="showCredModal" class="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div class="bg-white rounded-2xl p-6 max-w-md w-full space-y-4 shadow-2xl">
        <div class="flex items-center justify-between border-b pb-2">
          <h3 class="font-bold text-slate-900">판매채널 API 계정 연동</h3>
          <button @click="showCredModal = false" class="text-slate-400 hover:text-slate-600 cursor-pointer">
            <i class="fa-solid fa-xmark"></i>
          </button>
        </div>

        <div class="space-y-3 text-xs">
          <div>
            <label class="block font-bold mb-1">대상 플랫폼 선택</label>
            <select v-model="selectedPlatformId" class="w-full p-2 border rounded-lg bg-white">
              <option value="naver_smartstore">네이버 스마트스토어</option>
              <option value="coupang_wing">쿠팡 윙 오픈API</option>
              <option value="eleven_street">11번가 오픈API</option>
              <option value="amazon_sp_api">Amazon SP-API (US)</option>
              <option value="domeggook_domeme">도매꾹/도매매 B2B</option>
              <option value="onchannel_b2b">온채널 B2B</option>
            </select>
          </div>

          <div>
            <label class="block font-bold mb-1">계정 식별 이름</label>
            <input v-model="credAccountName" type="text" class="w-full p-2 border rounded-lg" placeholder="예: 네이버 본점" />
          </div>

          <div>
            <label class="block font-bold mb-1">API Key / Client ID / Access Key</label>
            <input v-model="credApiKey" type="password" class="w-full p-2 border rounded-lg font-mono" placeholder="API Key 입력" />
          </div>

          <div>
            <label class="block font-bold mb-1">Secret Key / Client Secret (해당시)</label>
            <input v-model="credSecretKey" type="password" class="w-full p-2 border rounded-lg font-mono" placeholder="Secret Key 입력" />
          </div>

          <div>
            <label class="block font-bold mb-1">판매자 ID / Vendor ID (쿠팡 등)</label>
            <input v-model="credVendorId" type="text" class="w-full p-2 border rounded-lg font-mono" placeholder="Vendor ID 입력" />
          </div>

          <div class="flex items-center gap-2 pt-1">
            <input v-model="isSandbox" type="checkbox" id="sbxCheck" class="rounded accent-indigo-600" />
            <label for="sbxCheck" class="cursor-pointer">테스트 샌드박스(Sandbox) 환경으로 등록</label>
          </div>
        </div>

        <div class="flex justify-end gap-2 pt-2 border-t">
          <button @click="showCredModal = false" class="px-4 py-2 border rounded-lg text-slate-600 text-xs font-bold cursor-pointer">취소</button>
          <button @click="handleSaveCredential" class="px-4 py-2 bg-indigo-600 text-white rounded-lg text-xs font-bold cursor-pointer">저장 및 연동</button>
        </div>
      </div>
    </div>
  </div>
</template>
