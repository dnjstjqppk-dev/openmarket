<script setup lang="ts">
import { ArrowUpRight, Calculator, CircleCheck, Key, Network, Plug, RotateCw, Share2, ShoppingCart, TriangleAlert, X } from 'lucide-vue-next'
import { ref, onMounted } from 'vue';
import { API_BASE, getPartnerHeaders } from '../config';
import { userErrorMessage, OmButton, OmEmptyState } from '@olmoa/ui'

interface Platform {
  id: string;
  name: string;
  country_code: string;
  platform_type: string;
  auth_type: string;
  api_docs_url: string;
  supported_models: string;
  status: string;
  api_integrated?: boolean;
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

// 4-11: honest status labels — connectors without a live platform call stay
// in simulation and never claim to be integrated.
const LISTING_LABEL: Record<string, string> = { DRAFT: '임시저장', PENDING_REVIEW: '심사중', SYNC_FAILED: '동기화 실패', LIVE: '판매중', PAUSED: '일시중지' };
const ORDER_LABEL: Record<string, string> = { COLLECTED: '수집됨', PO_DISPATCHED: '발주됨', SHIPPED: '출고됨' };
const isLivePlatform = (platformId: string) => platforms.value.find((p) => p.id === platformId)?.api_integrated === true;
const channelLive = (c: any) => isLivePlatform(c.platform_id);

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
    errorMsg.value = userErrorMessage(err, '데이터 로드 중 오류가 발생했습니다.');
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
    errorMsg.value = userErrorMessage(err, '저장 중 오류 발생');
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
    errorMsg.value = userErrorMessage(err, '검증 중 오류 발생');
  }
}

async function openDeployModal() {
  errorMsg.value = '';
  successMsg.value = '';
  deploySelected.value = [];
  deploySalePrice.value = null;
  try {
    const res = await fetch(`${API_BASE}/api/v1/partner/products`, { headers: getPartnerHeaders() });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || '상품 목록 조회에 실패했습니다.');
    const seen = new Set<string>();
    deployProducts.value = (data.data || []).filter((p: any) => {
      if (!p.id || seen.has(p.id)) return false;
      seen.add(p.id);
      return true;
    }).map((p: any) => ({ id: p.id, title: p.title }));
    deployChannelId.value = channels.value[0]?.id || '';
    showDeployModal.value = true;
  } catch (err: any) {
    errorMsg.value = userErrorMessage(err, '상품 목록 조회 중 오류 발생');
  }
}

async function handleDeploy() {
  if (deploySelected.value.length === 0) {
    errorMsg.value = '배포할 상품을 1개 이상 선택해 주세요.';
    return;
  }
  if (!deployChannelId.value) {
    errorMsg.value = '배포할 판매채널을 선택해 주세요.';
    return;
  }
  if (!deployBrand.value.trim() || !deployDeliveryCompany.value.trim() || !deployCategoryId.value.trim()) {
    errorMsg.value = '브랜드, 배송 택배사, 채널 카테고리는 필수 입력입니다.';
    return;
  }
  isDeploying.value = true;
  errorMsg.value = '';
  const ok: string[] = [];
  const failed: string[] = [];
  let saw501 = false;
  let sawSim = false;
  try {
    for (const pid of deploySelected.value) {
      try {
        const res = await fetch(`${API_BASE}/api/v1/channels/listings/publish`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...getPartnerHeaders() },
          body: JSON.stringify({
            sales_channel_id: deployChannelId.value,
            product_id: pid,
            ...(deploySalePrice.value ? { sale_price: Number(deploySalePrice.value) } : {}),
            brand: deployBrand.value.trim(),
            delivery_company: deployDeliveryCompany.value.trim(),
            external_category_id: deployCategoryId.value.trim(),
            delivery_fee_type: deployFeeType.value,
            ...(deployFee.value !== null ? { delivery_fee: Number(deployFee.value) } : {}),
            ...(deployThreshold.value !== null ? { free_shipping_threshold: Number(deployThreshold.value) } : {})
          })
        });
        const data = await res.json().catch(() => ({}));
        if (res.status === 501) {
          saw501 = true;
          failed.push(`${pid}: ${data.error || '외부 API 미연동'}`);
          continue;
        }
        if (!res.ok || (data.simulated === false && data.success === false)) throw new Error(data.error || data.message || `배포하지 못했습니다. 잠시 후 다시 시도해주세요.`);
        if (data.simulated) sawSim = true;
        ok.push(pid);
      } catch (err: any) {
        failed.push(`${pid}: ${userErrorMessage(err, '배포 실패')}`);
      }
    }
    if (failed.length === 0) {
      successMsg.value = sawSim
        ? `시뮬레이션으로 ${ok.length}건 기록되었습니다. 외부 API 연동 전에는 실제 채널에 등록되지 않습니다.`
        : `${ok.length}건이 채널에 배포되었습니다.`;
      showDeployModal.value = false;
    } else {
      errorMsg.value = saw501 && ok.length === 0
        ? `외부 채널 API가 아직 연동되지 않아 배포할 수 없습니다: ${failed.join('; ')}`
        : `${ok.length}건 성공, ${failed.length}건 실패: ${failed.join('; ')}`;
    }
    loadData();
  } finally {
    isDeploying.value = false;
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
    errorMsg.value = userErrorMessage(err, '주문 동기화 실패');
  }
}

// Dispatch PO modal state
const showDispatchModal = ref(false);
const dispatchOrderId = ref('');
const suppliers = ref<{ id: string; name: string }[]>([]);
const dispatchSupplierId = ref('');
const dispatchTotalCost = ref<number | null>(null);
const isDispatching = ref(false);

// Fulfill modal state
const showFulfillModal = ref(false);
const fulfillOrderId = ref('');
const carriers = ref<{ code: string; name: string }[]>([]);
const fulfillCarrierCode = ref('');
const fulfillTrackingNumber = ref('');
const isFulfilling = ref(false);

// T14: deploy-to-channel modal state (multi-product deploy).
const showDeployModal = ref(false);
const deployProducts = ref<{ id: string; title: string }[]>([]);
const deploySelected = ref<string[]>([]);
const deployChannelId = ref('');
const deploySalePrice = ref<number | null>(null);
const deployBrand = ref('');
const deployDeliveryCompany = ref('');
const deployCategoryId = ref('');
const deployFeeType = ref('CHARGE');
const deployFee = ref<number | null>(null);
const deployThreshold = ref<number | null>(null);
const isDeploying = ref(false);
const hasCredentialFor = (platformName: string) =>
  credentials.value.some((c) => c.platform_name === platformName);

async function openDispatchModal(orderId: string) {
  dispatchOrderId.value = orderId;
  dispatchTotalCost.value = null;
  errorMsg.value = '';
  try {
    const res = await fetch(`${API_BASE}/api/v1/channels/suppliers`, { headers: getPartnerHeaders() });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || '공급사 목록 조회에 실패했습니다.');
    suppliers.value = data.data || [];
    dispatchSupplierId.value = suppliers.value[0]?.id || '';
    showDispatchModal.value = true;
  } catch (err: any) {
    errorMsg.value = userErrorMessage(err, '공급사 목록 조회 중 오류 발생');
  }
}

async function handleDispatchPo() {
  if (!dispatchSupplierId.value) {
    errorMsg.value = '공급사를 선택해 주세요.';
    return;
  }
  const cost = Number(dispatchTotalCost.value);
  if (!Number.isSafeInteger(cost) || cost <= 0) {
    errorMsg.value = '공급원가 합계는 1 이상의 정수로 입력해 주세요.';
    return;
  }
  isDispatching.value = true;
  try {
    const res = await fetch(`${API_BASE}/api/v1/channels/orders/${dispatchOrderId.value}/dispatch-po`, {
      method: 'POST',
      headers: getPartnerHeaders(),
      body: JSON.stringify({ supplier_id: dispatchSupplierId.value, total_cost_krw: cost })
    });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || '공급사 발주 실패');
    successMsg.value = data.message || '공급업체 발주가 완료되었습니다.';
    showDispatchModal.value = false;
    loadData();
  } catch (err: any) {
    errorMsg.value = userErrorMessage(err, '발주 중 오류 발생');
  } finally {
    isDispatching.value = false;
  }
}

async function openFulfillModal(orderId: string) {
  fulfillOrderId.value = orderId;
  fulfillTrackingNumber.value = '';
  errorMsg.value = '';
  try {
    const res = await fetch(`${API_BASE}/api/v1/channels/carriers`, { headers: getPartnerHeaders() });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || '택배사 목록 조회에 실패했습니다.');
    carriers.value = data.data || [];
    fulfillCarrierCode.value = carriers.value[0]?.code || '';
    showFulfillModal.value = true;
  } catch (err: any) {
    errorMsg.value = userErrorMessage(err, '택배사 목록 조회 중 오류 발생');
  }
}

async function handleFulfill() {
  if (!fulfillCarrierCode.value) {
    errorMsg.value = '택배사를 선택해 주세요.';
    return;
  }
  const tracking = fulfillTrackingNumber.value.trim();
  if (!/^[A-Za-z0-9-]{6,40}$/.test(tracking)) {
    errorMsg.value = '택배사에서 발급받은 운송장 번호(영문·숫자·- 6~40자)를 입력해 주세요.';
    return;
  }
  isFulfilling.value = true;
  try {
    const res = await fetch(`${API_BASE}/api/v1/channels/orders/${fulfillOrderId.value}/fulfill`, {
      method: 'POST',
      headers: getPartnerHeaders(),
      body: JSON.stringify({ carrier_code: fulfillCarrierCode.value, tracking_number: tracking })
    });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || '출고 송장 전송 실패');
    successMsg.value = data.message || '3PL 운송장 연동이 완료되었습니다.';
    showFulfillModal.value = false;
    loadData();
  } catch (err: any) {
    errorMsg.value = userErrorMessage(err, '출고 처리 실패');
  } finally {
    isFulfilling.value = false;
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
    <div class="rounded-2xl border border-line bg-surface p-6 sm:p-8 shadow-xl relative overflow-hidden">
      <div class="relative z-10 space-y-2">
        <div class="inline-flex items-center gap-2 bg-primary-soft text-primary-soft-ink border border-line px-3 py-1 rounded-full text-xs font-semibold">
          <Network class="h-4 w-4 text-primary" aria-hidden="true" />
          <span>멀티채널 & 공급망 연동</span>
        </div>
        <h1 class="text-2xl sm:text-3xl font-bold tracking-tight text-ink">외부 판매채널 · B2B 발주 · 3PL 출고 관리</h1>
        <p class="text-sm sm:text-base text-ink-muted max-w-3xl leading-relaxed">
          판매채널 계정을 등록하고 채널별 상품 배포, 외부 주문 수집, B2B 발주, 3PL 송장 연동을 관리합니다.
        </p>
      </div>
    </div>

    <div role="note" class="rounded-2xl border border-warning bg-warning-soft p-4 text-xs font-bold text-warning">
      외부 플랫폼 실연동은 아직 제공되지 않습니다. 배포·수집·검증은 시뮬레이션으로 동작하며, 실연동 채널이 생기면 아래 목록에 실연동으로 표시됩니다.
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

    <!-- Navigation Tabs -->
    <div class="flex items-center gap-2 border-b border-line pb-2">
      <button
        @click="activeTab = 'channels'"
        type="button"
        class="px-4 py-2.5 rounded-xl font-bold text-xs sm:text-sm transition flex items-center gap-2 cursor-pointer"
        :class="activeTab === 'channels' ? 'bg-secondary text-secondary-on shadow' : 'bg-surface text-ink-muted hover:bg-surface-2 border border-line'"
      >
        <Plug class="h-4 w-4" aria-hidden="true" />
        <span>판매채널 연결 & 계정 ({{ credentials.length }})</span>
      </button>
      <button
        @click="activeTab = 'listings'"
        type="button"
        class="px-4 py-2.5 rounded-xl font-bold text-xs sm:text-sm transition flex items-center gap-2 cursor-pointer"
        :class="activeTab === 'listings' ? 'bg-secondary text-secondary-on shadow' : 'bg-surface text-ink-muted hover:bg-surface-2 border border-line'"
      >
        <Share2 class="h-4 w-4" aria-hidden="true" />
        <span>채널별 등록 상품 ({{ listings.length }})</span>
      </button>
      <button
        @click="activeTab = 'orders'"
        type="button"
        class="px-4 py-2.5 rounded-xl font-bold text-xs sm:text-sm transition flex items-center gap-2 cursor-pointer"
        :class="activeTab === 'orders' ? 'bg-secondary text-secondary-on shadow' : 'bg-surface text-ink-muted hover:bg-surface-2 border border-line'"
      >
        <ShoppingCart class="h-4 w-4" aria-hidden="true" />
        <span>외부 채널 주문 & 발주 ({{ channelOrders.length }})</span>
      </button>
      <button
        @click="activeTab = 'calculator'"
        type="button"
        class="px-4 py-2.5 rounded-xl font-bold text-xs sm:text-sm transition flex items-center gap-2 cursor-pointer"
        :class="activeTab === 'calculator' ? 'bg-secondary text-secondary-on shadow' : 'bg-surface text-ink-muted hover:bg-surface-2 border border-line'"
      >
        <Calculator class="h-4 w-4" aria-hidden="true" />
        <span>글로벌 채널 마진 계산기</span>
      </button>
    </div>

    <!-- TAB 1: Channels & Credentials -->
    <div v-if="activeTab === 'channels'" class="space-y-6">
      <div class="flex items-center justify-between">
        <div>
          <h2 class="text-lg font-bold text-ink">연동 가능한 국내외 판매채널 및 B2B 공급망</h2>
          <p class="text-xs text-ink-muted">판매 채널 계정을 등록하면 배포·주문 수집 흐름을 테스트할 수 있습니다(현재 시뮬레이션 동작).</p>
        </div>
        <button
          @click="showCredModal = true"
          class="px-4 py-2 bg-primary hover:bg-primary-hover text-primary-on rounded-xl text-xs font-bold shadow flex items-center gap-2 cursor-pointer"
        >
          <Key class="h-4 w-4" aria-hidden="true" />
          <span>새 판매채널 계정 연결</span>
        </button>
      </div>

      <!-- Credentials Cards Grid -->
      <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        <div
          v-for="c in channels"
          :key="c.id"
          class="bg-surface rounded-2xl p-5 border border-line shadow-sm flex flex-col justify-between space-y-4"
        >
          <div class="space-y-2">
            <div class="flex items-center justify-between">
              <span class="text-xs font-bold px-2 py-0.5 rounded-md font-mono" :class="c.country_code === 'KR' ? 'bg-info-soft text-info' : 'bg-primary-soft text-primary-soft-ink'">
                {{ c.country_code }}
              </span>
              <span class="text-xs text-ink-subtle font-mono">수수료 {{ (c.commission_bps / 100).toFixed(1) }}%</span>
            </div>
            <h3 class="font-bold text-ink text-base">{{ c.channel_name }}</h3>
            <p class="text-xs text-ink-muted">{{ c.platform_name }} 기반 정식 오픈마켓 API</p>
            <p>
              <span v-if="channelLive(c)" class="text-xs bg-success-soft text-success font-semibold px-2 py-1 rounded">실연동</span>
              <span v-else class="text-xs bg-warning-soft text-warning font-semibold px-2 py-1 rounded">시뮬레이션</span>
            </p>
          </div>

          <div class="pt-2 border-t border-line-divider flex items-center justify-between">
            <button
              @click="handleSyncOrders(c.id)"
              class="text-xs text-primary hover:underline font-bold flex items-center gap-1 cursor-pointer"
            >
              <RotateCw class="h-4 w-4" aria-hidden="true" /> 주문 수집 실행
            </button>
            <span v-if="hasCredentialFor(c.platform_name)" class="text-xs bg-success-soft text-success font-semibold px-2 py-1 rounded">API 키 등록됨</span>
            <span v-else class="text-xs bg-surface-3 text-ink-muted font-semibold px-2 py-1 rounded">API 키 미등록</span>
          </div>
        </div>
      </div>
    </div>

    <!-- TAB 2: Channel Listings -->
    <div v-if="activeTab === 'listings'" class="bg-surface rounded-2xl shadow-sm border border-line p-6 space-y-4">
      <div class="flex items-center justify-between border-b border-line-divider pb-3">
        <div>
          <h2 class="text-base font-bold text-ink">외부 오픈마켓 등록 상품 내역</h2>
          <p class="text-xs text-ink-muted">네이버/쿠팡/아마존 등으로 배포된 리스팅 상태를 조회합니다.</p>
        </div>
        <button
          @click="openDeployModal"
          class="px-4 py-2 bg-primary hover:bg-primary-hover text-primary-on rounded-xl text-xs font-bold shadow flex items-center gap-2 cursor-pointer"
        >
          <Share2 class="h-4 w-4" aria-hidden="true" />
          <span>새 상품 배포</span>
        </button>
      </div>

      <div class="overflow-x-auto">
        <table class="w-full text-xs text-left">
          <thead class="bg-surface-2 text-ink-muted font-bold border-b border-line">
            <tr>
              <th class="px-3 py-2.5">판매 채널</th>
              <th class="px-3 py-2.5">상품명</th>
              <th class="px-3 py-2.5 text-right">채널 판매가</th>
              <th class="px-3 py-2.5 text-center">등록 상태</th>
              <th class="px-3 py-2.5">외부 상품 링크</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-line-divider">
            <tr v-if="listings.length === 0">
              <td colspan="5" class="px-3 py-8 text-center text-ink-subtle">
                아직 외부 오픈마켓에 등록된 상품이 없습니다. 위 "새 상품 배포" 버튼으로 배포해 보세요.
              </td>
            </tr>
            <tr v-for="l in listings" :key="l.id" class="hover:bg-surface-2">
              <td class="px-3 py-2.5 font-bold text-ink">{{ l.channel_name }}</td>
              <td class="px-3 py-2.5 text-ink-muted font-medium">{{ l.product_title }}</td>
              <td class="px-3 py-2.5 text-right font-mono font-bold text-ink">₩{{ l.channel_sale_price.toLocaleString() }}</td>
              <td class="px-3 py-2.5 text-center">
                <span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-success-soft text-success">
                  {{ LISTING_LABEL[l.status] ?? l.status }}
                </span>
              </td>
              <td class="px-3 py-2.5 text-primary font-mono">
                <a v-if="l.external_url" :href="l.external_url" target="_blank" class="hover:underline flex items-center gap-1">
                  <span>바로가기</span>
                  <ArrowUpRight class="h-4 w-4 text-[9px]" aria-hidden="true" />
                </a>
                <span v-else class="text-ink-subtle">-</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- TAB 3: External Orders & PO Dispatch -->
    <div v-if="activeTab === 'orders'" class="bg-surface rounded-2xl shadow-sm border border-line p-6 space-y-4">
      <div class="flex items-center justify-between border-b border-line-divider pb-3">
        <div>
          <h2 class="text-base font-bold text-ink">외부 판매채널 수집 주문 및 공급사 발주</h2>
          <p class="text-xs text-ink-muted">외부 오픈마켓에서 들어온 주문을 B2B 공급사에 1-클릭 위탁 발주하고 3PL로 출고합니다.</p>
        </div>
      </div>

      <div class="overflow-x-auto">
        <table class="w-full text-xs text-left">
          <thead class="bg-surface-2 text-ink-muted font-bold border-b border-line">
            <tr>
              <th class="px-3 py-2.5">외부 주문번호</th>
              <th class="px-3 py-2.5">채널</th>
              <th class="px-3 py-2.5">수령인 / 배송지</th>
              <th class="px-3 py-2.5 text-right">주문금액</th>
              <th class="px-3 py-2.5 text-center">주문 상태</th>
              <th class="px-3 py-2.5 text-center">작업 처리</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-line-divider">
            <tr v-if="channelOrders.length === 0">
              <td colspan="6" class="px-3 py-8 text-center text-ink-subtle">
                수집된 외부 주문이 없습니다. 판매채널 탭에서 "주문 수집 실행"을 눌러보세요.
              </td>
            </tr>
            <tr v-for="ord in channelOrders" :key="ord.id" class="hover:bg-surface-2">
              <td class="px-3 py-2.5 font-mono font-bold text-ink">{{ ord.external_order_no }}</td>
              <td class="px-3 py-2.5 text-ink-muted">{{ ord.channel_name }}</td>
              <td class="px-3 py-2.5 text-ink-muted">
                <div class="font-medium">{{ ord.recipient_name }}</div>
                <div class="text-[11px] text-ink-subtle truncate max-w-xs">{{ ord.shipping_address }}</div>
              </td>
              <td class="px-3 py-2.5 text-right font-mono font-bold text-ink">₩{{ ord.total_order_amount.toLocaleString() }}</td>
              <td class="px-3 py-2.5 text-center">
                <span
                  class="px-2 py-0.5 rounded-full text-[10px] font-bold"
                  :class="{
                    'bg-warning-soft text-warning': ord.order_status === 'COLLECTED',
                    'bg-primary-soft text-primary-soft-ink': ord.order_status === 'PO_DISPATCHED',
                    'bg-success-soft text-success': ord.order_status === 'SHIPPED'
                  }"
                >
                  {{ ORDER_LABEL[ord.order_status] ?? ord.order_status }}
                </span>
              </td>
              <td class="px-3 py-2.5 text-center space-x-1">
                <button
                  v-if="ord.order_status === 'COLLECTED'"
                  @click="openDispatchModal(ord.id)"
                  class="px-2.5 py-1 bg-primary hover:bg-primary-hover text-primary-on rounded text-[11px] font-bold cursor-pointer"
                >
                  B2B 발주
                </button>
                <button
                  v-if="ord.order_status === 'PO_DISPATCHED'"
                  @click="openFulfillModal(ord.id)"
                  class="px-2.5 py-1 bg-success text-primary-on rounded text-[11px] font-bold cursor-pointer"
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
    <div v-if="activeTab === 'calculator'" class="bg-surface rounded-2xl shadow-sm border border-line p-6 space-y-6">
      <div>
        <h2 class="text-base font-bold text-ink">글로벌 멀티채널 마진 시뮬레이터</h2>
        <p class="text-xs text-ink-muted">공급원가·국제물류비·관부가세·채널 수수료·PG 수수료를 입력값 기준으로 계산해 역마진 여부를 미리 확인합니다.</p>
      </div>

      <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div class="space-y-4 md:col-span-1 bg-surface-2 p-4 rounded-xl border border-line">
          <div class="space-y-1">
            <label class="text-xs font-bold text-ink-muted">공급 도매원가</label>
            <div class="flex gap-2">
              <input v-model.number="calcWholesaleCost" @input="runCalculator" type="number" class="w-full px-3 py-2 text-sm rounded border border-line font-mono bg-surface text-ink" />
              <select v-model="calcCurrency" @change="runCalculator" class="px-2 py-2 text-xs rounded border border-line font-bold bg-surface text-ink">
                <option value="KRW">KRW</option>
                <option value="USD">USD</option>
                <option value="CNY">CNY</option>
              </select>
            </div>
          </div>

          <div class="space-y-1">
            <div class="flex justify-between text-xs font-bold">
              <span>목표 마진율:</span>
              <span class="text-primary font-mono">{{ calcTargetMargin }}%</span>
            </div>
            <input v-model.number="calcTargetMargin" @input="runCalculator" type="range" min="10" max="50" step="5" class="w-full accent-primary" />
          </div>

          <div class="space-y-1">
            <label class="text-xs font-bold text-ink-muted">판매 대상 채널</label>
            <select v-model="calcChannel" @change="runCalculator" class="w-full px-3 py-2 text-xs rounded border border-line bg-surface text-ink">
              <option value="NAVER_SMARTSTORE">네이버 스마트스토어 (5.5%)</option>
              <option value="COUPANG_MARKETPLACE">쿠팡 윙 오픈마켓 (10.8%)</option>
              <option value="ELEVEN_STREET_KR">11번가 오픈마켓 (12.0%)</option>
              <option value="AMAZON_US_FBA_MFN">Amazon US (15.0%)</option>
            </select>
          </div>

          <div class="flex items-center gap-2 pt-2">
            <input v-model="calcIsCrossborder" @change="runCalculator" type="checkbox" id="cbCheck" class="rounded accent-primary" />
            <label for="cbCheck" class="text-xs font-semibold text-ink-muted cursor-pointer">해외 직구 크로스보더 상품 (통관/항공운임)</label>
          </div>
        </div>

        <!-- Simulation Result View -->
        <div v-if="calcResult" class="md:col-span-2 space-y-4">
          <div class="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-primary-soft p-4 rounded-xl border border-line font-mono text-center">
            <div>
              <div class="text-[11px] text-ink-muted font-sans">총 랜드 원가</div>
              <div class="text-base font-bold text-ink">₩{{ calcResult.cost_breakdown.total_landed_cost_krw.toLocaleString() }}</div>
            </div>
            <div>
              <div class="text-[11px] text-ink-muted font-sans">채널 수수료</div>
              <div class="text-base font-bold text-warning">₩{{ calcResult.fees_breakdown.channel_commission_krw.toLocaleString() }}</div>
            </div>
            <div>
              <div class="text-[11px] text-ink-muted font-sans">최종 권장 판매가</div>
              <div class="text-lg font-extrabold text-success">₩{{ calcResult.pricing_result.sale_price_krw.toLocaleString() }}</div>
            </div>
            <div>
              <div class="text-[11px] text-ink-muted font-sans">순수익 보장액</div>
              <div class="text-base font-bold text-primary">₩{{ calcResult.pricing_result.net_profit_krw.toLocaleString() }}</div>
            </div>
          </div>

          <div class="text-xs space-y-1 text-ink-muted bg-surface-2 p-4 rounded-xl border border-line leading-relaxed">
            <p><strong>수수료 세부 내역:</strong> 채널 수수료 {{ (calcResult.fees_breakdown.channel_commission_rate_bps / 100).toFixed(1) }}% + PG 결제수수료 3.0% + 반품 충당금 1.5% 포함</p>
            <p><strong>역마진 방지 가드:</strong> <span class="font-bold text-success">안전 (보장 순이익 ₩{{ calcResult.pricing_result.net_profit_krw.toLocaleString() }})</span></p>
          </div>
        </div>
      </div>
    </div>

    <!-- Credential Modal -->
    <div v-if="showCredModal" class="fixed inset-0 bg-overlay/50 z-50 flex items-center justify-center p-4">
      <div class="bg-surface rounded-2xl p-6 max-w-md w-full space-y-4 shadow-2xl">
        <div class="flex items-center justify-between border-b border-line-divider pb-2">
          <h3 class="font-bold text-ink">판매채널 API 계정 연동</h3>
          <button @click="showCredModal = false" class="text-ink-subtle hover:text-ink cursor-pointer">
            <X class="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        <div class="space-y-3 text-xs">
          <div>
            <label class="block font-bold mb-1">대상 플랫폼 선택</label>
            <select v-model="selectedPlatformId" class="w-full p-2 border border-line rounded-lg bg-surface text-ink">
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
            <input v-model="isSandbox" type="checkbox" id="sbxCheck" class="rounded accent-primary" />
            <label for="sbxCheck" class="cursor-pointer">테스트 샌드박스(Sandbox) 환경으로 등록</label>
          </div>
        </div>

        <div class="flex justify-end gap-2 pt-2 border-t border-line-divider">
          <button @click="showCredModal = false" class="px-4 py-2 border border-line rounded-lg text-ink-muted text-xs font-bold cursor-pointer">취소</button>
          <button @click="handleSaveCredential" class="px-4 py-2 bg-primary text-primary-on rounded-lg text-xs font-bold cursor-pointer">저장 및 연동</button>
        </div>
      </div>
    </div>

    <!-- Dispatch PO modal -->
    <div v-if="showDispatchModal" class="fixed inset-0 bg-overlay/50 z-50 flex items-center justify-center p-4">
      <div class="bg-surface rounded-2xl p-6 max-w-md w-full space-y-4 shadow-2xl">
        <div class="flex items-center justify-between border-b border-line-divider pb-2">
          <h3 class="font-bold text-ink">B2B 공급사 발주</h3>
          <button @click="showDispatchModal = false" class="text-ink-subtle hover:text-ink cursor-pointer">
            <X class="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
        <div>
          <label class="block text-xs font-bold text-ink-muted mb-1">공급사 선택</label>
          <select v-model="dispatchSupplierId" class="w-full h-10 px-3 rounded-lg border border-line text-xs font-bold bg-surface text-ink cursor-pointer">
            <option v-for="s in suppliers" :key="s.id" :value="s.id">{{ s.name }}</option>
          </select>
        </div>
        <div>
          <label class="block text-xs font-bold text-ink-muted mb-1">공급원가 합계 (원)</label>
          <input v-model.number="dispatchTotalCost" type="number" min="1" step="1" placeholder="예: 12000"
            class="w-full h-10 px-3 rounded-lg border border-line text-xs font-bold bg-surface text-ink" />
          <p class="text-[11px] text-ink-subtle mt-1">실제 공급원가를 입력해 주세요. 추정치로 발주할 수 없습니다.</p>
        </div>
        <div class="flex justify-end gap-2 pt-2 border-t border-line-divider">
          <button @click="showDispatchModal = false" class="px-4 py-2 border border-line rounded-lg text-ink-muted text-xs font-bold cursor-pointer">취소</button>
          <button @click="handleDispatchPo" :disabled="isDispatching" class="px-4 py-2 bg-primary text-primary-on rounded-lg text-xs font-bold cursor-pointer disabled:opacity-50">{{ isDispatching ? '발주 중...' : '발주 실행' }}</button>
        </div>
      </div>
    </div>

    <!-- Fulfill modal -->
    <div v-if="showFulfillModal" class="fixed inset-0 bg-overlay/50 z-50 flex items-center justify-center p-4">
      <div class="bg-surface rounded-2xl p-6 max-w-md w-full space-y-4 shadow-2xl">
        <div class="flex items-center justify-between border-b border-line-divider pb-2">
          <h3 class="font-bold text-ink">3PL 출고·송장 연동</h3>
          <button @click="showFulfillModal = false" class="text-ink-subtle hover:text-ink cursor-pointer">
            <X class="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
        <div>
          <label class="block text-xs font-bold text-ink-muted mb-1">택배사 선택</label>
          <select v-model="fulfillCarrierCode" class="w-full h-10 px-3 rounded-lg border border-line text-xs font-bold bg-surface text-ink cursor-pointer">
            <option v-for="c in carriers" :key="c.code" :value="c.code">{{ c.name }}</option>
          </select>
        </div>
        <div>
          <label class="block text-xs font-bold text-ink-muted mb-1">운송장 번호</label>
          <input v-model="fulfillTrackingNumber" type="text" placeholder="택배사 발급 운송장 번호"
            class="w-full h-10 px-3 rounded-lg border border-line text-xs font-mono bg-surface text-ink" />
          <p class="text-[11px] text-ink-subtle mt-1">운송장 번호는 택배사에서 발급받아야 합니다. 시스템이 임의로 만들지 않습니다.</p>
        </div>
        <div class="flex justify-end gap-2 pt-2 border-t border-line-divider">
          <button @click="showFulfillModal = false" class="px-4 py-2 border border-line rounded-lg text-ink-muted text-xs font-bold cursor-pointer">취소</button>
          <button @click="handleFulfill" :disabled="isFulfilling" class="px-4 py-2 bg-success text-primary-on rounded-lg text-xs font-bold cursor-pointer disabled:opacity-50">{{ isFulfilling ? '전송 중...' : '송장 전송' }}</button>
        </div>
      </div>
    </div>

    <!-- T14: deploy-to-channel modal (multi-product) -->
    <div v-if="showDeployModal" class="fixed inset-0 bg-overlay/50 z-50 flex items-center justify-center p-4">
      <div class="bg-surface rounded-2xl p-6 max-w-lg w-full space-y-4 shadow-2xl max-h-[90vh] overflow-y-auto">
        <div class="flex items-center justify-between border-b border-line-divider pb-2">
          <h3 class="font-bold text-ink">외부 채널 상품 배포 (다건 가능)</h3>
          <button @click="showDeployModal = false" class="text-ink-subtle hover:text-ink cursor-pointer">
            <X class="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
        <div>
          <label class="block text-xs font-bold text-ink-muted mb-1">배포 채널</label>
          <select v-model="deployChannelId" class="w-full h-10 px-3 rounded-lg border border-line text-xs font-bold bg-surface text-ink cursor-pointer">
            <option v-for="c in channels" :key="c.id" :value="c.id">{{ c.channel_name }}</option>
          </select>
        </div>
        <div>
          <label class="block text-xs font-bold text-ink-muted mb-1">배포 상품 ({{ deploySelected.length }}개 선택)</label>
          <div class="max-h-40 overflow-y-auto border border-line rounded-lg divide-y divide-line-divider">
            <label v-for="p in deployProducts" :key="p.id" class="flex items-center gap-2 px-3 py-2 text-xs cursor-pointer hover:bg-surface-2">
              <input type="checkbox" :value="p.id" v-model="deploySelected" class="rounded accent-primary" />
              <span class="font-medium text-ink truncate">{{ p.title }}</span>
            </label>
            <OmEmptyState
              v-if="deployProducts.length === 0"
              compact
              title="배포 가능한 상품이 없습니다."
              description="상품 관리에서 판매 중인 상품을 먼저 등록해 주세요."
            >
              <OmButton size="sm" @click="openDeployModal">다시 불러오기</OmButton>
            </OmEmptyState>
          </div>
        </div>
        <div class="grid grid-cols-2 gap-3">
          <div>
            <label class="block text-xs font-bold text-ink-muted mb-1">채널 판매가 (선택)</label>
            <input v-model.number="deploySalePrice" type="number" min="100" step="10" placeholder="미입력 시 올모아 판매가"
              class="w-full h-10 px-3 rounded-lg border border-line text-xs bg-surface text-ink" />
          </div>
          <div>
            <label class="block text-xs font-bold text-ink-muted mb-1">브랜드 (필수)</label>
            <input v-model="deployBrand" type="text" maxlength="100" placeholder="예: 자사 브랜드"
              class="w-full h-10 px-3 rounded-lg border border-line text-xs bg-surface text-ink" />
          </div>
          <div>
            <label class="block text-xs font-bold text-ink-muted mb-1">배송 택배사 코드 (필수)</label>
            <input v-model="deployDeliveryCompany" type="text" maxlength="20" placeholder="예: CJGLS"
              class="w-full h-10 px-3 rounded-lg border border-line text-xs font-mono bg-surface text-ink" />
          </div>
          <div>
            <label class="block text-xs font-bold text-ink-muted mb-1">채널 카테고리 ID (필수)</label>
            <input v-model="deployCategoryId" type="text" maxlength="20" placeholder="채널 카테고리 번호"
              class="w-full h-10 px-3 rounded-lg border border-line text-xs font-mono bg-surface text-ink" />
          </div>
          <div>
            <label class="block text-xs font-bold text-ink-muted mb-1">배송비 유형</label>
            <select v-model="deployFeeType" class="w-full h-10 px-3 rounded-lg border border-line text-xs bg-surface text-ink">
              <option value="CHARGE">유료 배송</option>
              <option value="FREE">무료 배송</option>
              <option value="CONDITIONAL_FREE">조건부 무료</option>
            </select>
          </div>
          <div v-if="deployFeeType !== 'FREE'">
            <label class="block text-xs font-bold text-ink-muted mb-1">배송비 (원)</label>
            <input v-model.number="deployFee" type="number" min="0" step="100" placeholder="예: 3000"
              class="w-full h-10 px-3 rounded-lg border border-line text-xs bg-surface text-ink" />
          </div>
          <div v-if="deployFeeType === 'CONDITIONAL_FREE'">
            <label class="block text-xs font-bold text-ink-muted mb-1">무료배송 기준금액 (원)</label>
            <input v-model.number="deployThreshold" type="number" min="1" step="1000" placeholder="예: 30000"
              class="w-full h-10 px-3 rounded-lg border border-line text-xs bg-surface text-ink" />
          </div>
        </div>
        <p class="text-[11px] text-ink-subtle">외부 채널 API가 연동되지 않은 플랫폼은 명확한 안내와 함께 배포가 거부됩니다. 연동 전 배포분은 시뮬레이션으로만 기록됩니다.</p>
        <div class="flex justify-end gap-2 pt-2 border-t border-line-divider">
          <button @click="showDeployModal = false" class="px-4 py-2 border border-line rounded-lg text-ink-muted text-xs font-bold cursor-pointer">취소</button>
          <button @click="handleDeploy" :disabled="isDeploying || deploySelected.length === 0" class="px-4 py-2 bg-primary text-primary-on rounded-lg text-xs font-bold cursor-pointer disabled:opacity-50">{{ isDeploying ? '배포 중...' : `배포 실행 (${deploySelected.length}건)` }}</button>
        </div>
      </div>
    </div>
  </div>
</template>

