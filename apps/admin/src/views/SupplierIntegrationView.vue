<script setup lang="ts">
import { ArrowUpRight, Boxes, CircleCheck, CloudDownload, Globe, Key, LoaderCircle, Network, RotateCw, ShieldCheck, SlidersHorizontal, Store, ToggleRight, TriangleAlert, Truck, X } from 'lucide-vue-next'
import { ref, computed, onMounted } from 'vue';
import { adminApi, won, API_BASE_URL } from '../config';
import { userErrorMessage, useConfirm, useToast } from '@olmoa/ui'

const { confirm: askConfirm } = useConfirm()
const toastApi = useToast()

interface SupplierOrder {
  id: string;
  sub_order_id: string;
  sub_order_no?: string;
  supplier_id: string;
  supplier_name?: string;
  idempotency_key: string;
  total_supply_cost: number;
  status: string;
  carrier_code?: string;
  tracking_number?: string;
  shipped_at?: string;
  created_at: string;
  items?: any[];
}

interface ImportJob {
  id: string;
  partner_id: string;
  source_url: string;
  domain: string;
  status: string;
  quality_score: number;
  published_product_id?: string;
  published_title?: string;
  created_at: string;
}

interface SyncLog {
  id: string;
  supplier_id: string;
  sku_id: string;
  old_price: number;
  new_price: number;
  old_stock: number;
  new_stock: number;
  sync_status: string;
  alert_message?: string;
  created_at: string;
}

interface FeatureFlag {
  key: string;
  name: string;
  category: string;
  description: string;
  is_enabled: number;
  requires_credential: number;
  credential_configured: number;
  risk_level: string;
  updated_at: string;
}

interface Platform {
  id: string;
  platform_code: string;
  platform_name: string;
  country_code: string;
  category: string;
  base_url: string;
  auth_type: string;
  api_doc_url: string;
  default_commission_rate: number;
  status: string;
  capabilities: Array<{
    capability_code: string;
    description: string;
    rate_limit_per_minute: number;
    is_supported: number;
  }>;
  active_channels_count?: number;
}

const currentTab = ref<'orders' | 'imports' | 'sync' | 'flags' | 'platforms'>('orders');
const platformCategoryFilter = ref('ALL');

const filteredPlatforms = computed(() => {
  if (platformCategoryFilter.value === 'ALL') return platforms.value;
  return platforms.value.filter(p => p.category === platformCategoryFilter.value);
});
// P2-A03: every platform count derives from the loaded list — no literals.
const platformCounts = computed<Record<string, number>>(() => {
  const c: Record<string, number> = { ALL: platforms.value.length, DOMESTIC_OPENMARKET: 0, GLOBAL_OPENMARKET: 0, B2B_SUPPLIER: 0, '3PL_LOGISTICS': 0 };
  for (const p of platforms.value) if (c[p.category] !== undefined) c[p.category] += 1;
  return c;
});
const platformFilterTabs = computed(() => [
  { id: 'ALL', label: `전체 플랫폼 (${platformCounts.value.ALL})` },
  { id: 'DOMESTIC_OPENMARKET', label: `국내 오픈마켓 (${platformCounts.value.DOMESTIC_OPENMARKET})` },
  { id: 'GLOBAL_OPENMARKET', label: `글로벌 오픈마켓 (${platformCounts.value.GLOBAL_OPENMARKET})` },
  { id: 'B2B_SUPPLIER', label: `B2B 도매 공급사 (${platformCounts.value.B2B_SUPPLIER})` },
  { id: '3PL_LOGISTICS', label: `3PL 물류사 (${platformCounts.value['3PL_LOGISTICS']})` }
]);

// State
const orders = ref<SupplierOrder[]>([]);
const importJobs = ref<ImportJob[]>([]);
const syncLogs = ref<SyncLog[]>([]);
const flags = ref<FeatureFlag[]>([]);
const platforms = ref<Platform[]>([]);
const platformSummary = ref<{ total: number; domestic_openmarket: number; global_openmarket: number; b2b_supplier: number; logistics_3pl: number } | null>(null);
const isLoading = ref(false);
const actionMsg = ref('');
const errorMsg = ref('');

// Dispatch modal state
const showDispatchModal = ref(false);
const dispatchTarget = ref<SupplierOrder | null>(null);
const dispatchCarrier = ref('CJ대한통운');
const dispatchTracking = ref('');
const isDispatching = ref(false);

// Health check state
const systemHealth = ref<{ status: string; ssrf_protection: string } | null>(null);

async function loadHealth() {
  try {
    const r = await adminApi('/api/v1/integrations/health');
    if (r.ok) {
      systemHealth.value = r.data;
    }
  } catch (err) {
    console.error('Failed to load integrations health:', err);
  }
}

async function loadOrders() {
  isLoading.value = true;
  try {
    const r = await adminApi('/api/v1/admin/supplier-orders');
    if (!r.ok) throw new Error(r.data.error || '발주 목록을 불러오지 못했습니다.');
    orders.value = r.data.data || [];
  } catch (err: any) {
    console.error('Failed to load supplier orders:', err);
    errorMsg.value = userErrorMessage(err, '발주 목록을 불러오지 못했습니다.');
  } finally {
    isLoading.value = false;
  }
}

async function loadImportJobs() {
  isLoading.value = true;
  try {
    const r = await adminApi('/api/v1/admin/imports/jobs');
    if (!r.ok) throw new Error(r.data.error || '수집 작업 목록을 불러오지 못했습니다.');
    importJobs.value = r.data.data || [];
  } catch (err: any) {
    console.error('Failed to load import jobs:', err);
    errorMsg.value = userErrorMessage(err, '수집 작업 목록을 불러오지 못했습니다.');
  } finally {
    isLoading.value = false;
  }
}

async function loadSyncLogs() {
  isLoading.value = true;
  try {
    const r = await adminApi('/api/v1/admin/sync/logs');
    if (!r.ok) throw new Error(r.data.error || '동기화 로그를 불러오지 못했습니다.');
    syncLogs.value = r.data.data || [];
  } catch (err: any) {
    console.error('Failed to load sync logs:', err);
    errorMsg.value = userErrorMessage(err, '동기화 로그를 불러오지 못했습니다.');
  } finally {
    isLoading.value = false;
  }
}

async function loadFlags() {
  isLoading.value = true;
  try {
    const r = await adminApi('/api/v1/admin/feature-flags');
    if (!r.ok) throw new Error(r.data.error || '기능 플래그를 불러오지 못했습니다.');
    flags.value = r.data.data || [];
  } catch (err: any) {
    console.error('Failed to load feature flags:', err);
    errorMsg.value = userErrorMessage(err, '기능 플래그를 불러오지 못했습니다.');
  } finally {
    isLoading.value = false;
  }
}

async function toggleFlag(flag: FeatureFlag) {
  const targetState = flag.is_enabled === 1 ? false : true;
  const verb = targetState ? '활성화(ON)' : '비활성화(OFF)';
  if (!(await askConfirm({ title: '기능 플래그', body: `[${flag.name}] 기능을 ${verb} 하시겠습니까?\n주의: ${flag.description}` }))) return;

  actionMsg.value = '';
  errorMsg.value = '';

  try {
    const r = await adminApi(`/api/v1/admin/feature-flags/${flag.key}/toggle`, {
      method: 'POST',
      json: {
        is_enabled: targetState,
        reason: `운영자 콘솔 제어: ${verb}`
      }
    });

    if (r.ok) {
      actionMsg.value = `✓ [${flag.name}] 기능이 ${verb} 처리되었습니다.`;
      loadFlags();
    } else {
      errorMsg.value = r.data.error || '플래그 토글 실패';
    }
  } catch (err: any) {
    errorMsg.value = err.message;
  }
}

async function handleAccept(po: SupplierOrder) {
  if (!(await askConfirm({ title: '발주 접수', body: `PO [${po.id}] 발주를 접수/승인하시겠습니까?` }))) return;
  actionMsg.value = '';
  errorMsg.value = '';
  try {
    const r = await adminApi(`/api/v1/supplier-orders/${po.id}/respond`, {
      method: 'POST',
      json: { action: 'ACCEPT' }
    });
    if (r.ok) {
      actionMsg.value = `✓ 발주 [${po.id}] 접수가 완료되었습니다.`;
      loadOrders();
    } else {
      errorMsg.value = r.data.error || '발주 승인 실패';
    }
  } catch (err: any) {
    errorMsg.value = err.message;
  }
}

function openDispatch(po: SupplierOrder) {
  dispatchTarget.value = po;
  dispatchCarrier.value = 'CJ대한통운';
  dispatchTracking.value = '';
  showDispatchModal.value = true;
}

async function executeDispatch() {
  if (!dispatchTarget.value) return;
  if (!dispatchTracking.value.trim()) {
    toastApi.error('운송장 번호를 입력해 주세요.');
    return;
  }
  isDispatching.value = true;
  actionMsg.value = '';
  errorMsg.value = '';

  try {
    const r = await adminApi(`/api/v1/supplier-orders/${dispatchTarget.value.id}/dispatch`, {
      method: 'POST',
      json: {
        carrier_code: dispatchCarrier.value,
        tracking_number: dispatchTracking.value.trim()
      }
    });

    if (r.ok) {
      actionMsg.value = `✓ 3PL 송장 등록 및 직출고 완료! (고객 주문 상태가 '배송중'으로 자동 동기화되었습니다)`;
      showDispatchModal.value = false;
      loadOrders();
    } else {
      errorMsg.value = r.data.error || '송장 등록 실패';
    }
  } catch (err: any) {
    errorMsg.value = err.message;
  } finally {
    isDispatching.value = false;
  }
}

async function loadPlatforms() {
  isLoading.value = true;
  try {
    const r = await adminApi('/api/v1/channels/platforms');
    if (!r.ok) throw new Error(r.data.error || '플랫폼 목록을 불러오지 못했습니다.');
    if (r.data) {
      platforms.value = r.data.platforms || [];
      platformSummary.value = r.data.summary || null;
    }
  } catch (err: any) {
    console.error('Failed to load platforms:', err);
    errorMsg.value = userErrorMessage(err, '플랫폼 목록을 불러오지 못했습니다.');
  } finally {
    isLoading.value = false;
  }
}

onMounted(() => {
  loadHealth();
  loadOrders();
  loadImportJobs();
  loadSyncLogs();
  loadFlags();
  loadPlatforms();
});
</script>

<template>
  <div class="max-w-7xl mx-auto px-4 py-8 space-y-6">
    <!-- Header Hero Banner -->
    <div class="rounded-2xl border border-line bg-surface p-6 sm:p-8 shadow-xl relative overflow-hidden">
      <div class="relative z-10 space-y-3">
        <div class="flex flex-wrap items-center gap-3">
          <div class="inline-flex items-center gap-2 bg-primary-soft text-primary-soft-ink border border-line px-3 py-1 rounded-full text-xs font-semibold">
            <Boxes class="h-4 w-4 text-primary" aria-hidden="true" />
            <span>3PL 이행 & 위탁배송 센터</span>
          </div>
          <div class="flex items-center gap-2 text-xs bg-surface-2 px-3 py-1 rounded-full border border-line font-mono text-ink-muted">
            <span class="w-2 h-2 rounded-full bg-success animate-pulse"></span>
            <span>SSRF DEFENSE: {{ systemHealth?.ssrf_protection || 'ACTIVE' }}</span>
          </div>
        </div>
        <h1 class="text-2xl sm:text-3xl font-bold tracking-tight text-ink">3PL 물류 대행 & 위탁판매 통합 관제 센터</h1>
        <p class="text-xs sm:text-sm text-ink-muted max-w-3xl leading-relaxed">
          외부 위탁 공급업체 발주(PO) 접수 및 3PL 직출고 송장 연동, 전사 URL 상품 수집 작업 감사, 실시간 공급가/재고 변동 알림 및 <strong>기능별 독립 ON/OFF 제어(Feature Flags)</strong>를 통합 관리합니다.
        </p>
      </div>
    </div>

    <!-- Alert Banners -->
    <div v-if="actionMsg" class="p-4 bg-success-soft border border-line text-success rounded-xl flex items-center gap-3">
      <CircleCheck class="h-4 w-4 text-success text-lg flex-shrink-0" aria-hidden="true" />
      <span class="text-sm font-semibold">{{ actionMsg }}</span>
    </div>
    <div v-if="errorMsg" class="p-4 bg-danger-soft border border-line text-danger rounded-xl flex items-center gap-3">
      <TriangleAlert class="h-4 w-4 text-danger text-lg flex-shrink-0" aria-hidden="true" />
      <span class="text-sm font-semibold">{{ errorMsg }}</span>
    </div>
    <div v-if="isLoading" class="p-8 text-center text-ink-subtle text-xs bg-surface rounded-xl border border-line">
      <LoaderCircle class="h-4 w-4 animate-spin mr-2" aria-hidden="true" />데이터를 불러오는 중입니다...
    </div>

    <!-- Navigation Tabs -->
    <div class="flex border-b border-line bg-surface rounded-t-xl px-4 pt-2 overflow-x-auto">
      <button
        @click="currentTab = 'orders'; loadOrders()"
        class="py-3 px-5 text-sm font-bold border-b-2 transition flex items-center gap-2 cursor-pointer flex-shrink-0"
        :class="currentTab === 'orders' ? 'border-primary text-primary' : 'border-transparent text-ink-muted hover:text-ink'"
      >
        <Truck class="h-4 w-4" aria-hidden="true" />
        <span>3PL & 위탁 공급사 발주 (PO)</span>
        <span class="bg-primary-soft text-primary-soft-ink text-xs px-2 py-0.5 rounded-full font-mono">{{ orders.length }}</span>
      </button>

      <button
        @click="currentTab = 'imports'; loadImportJobs()"
        class="py-3 px-5 text-sm font-bold border-b-2 transition flex items-center gap-2 cursor-pointer flex-shrink-0"
        :class="currentTab === 'imports' ? 'border-primary text-primary' : 'border-transparent text-ink-muted hover:text-ink'"
      >
        <CloudDownload class="h-4 w-4" aria-hidden="true" />
        <span>URL 상품 수집 감사 (Imports)</span>
        <span class="bg-surface-2 text-ink-muted text-xs px-2 py-0.5 rounded-full font-mono">{{ importJobs.length }}</span>
      </button>

      <button
        @click="currentTab = 'sync'; loadSyncLogs()"
        class="py-3 px-5 text-sm font-bold border-b-2 transition flex items-center gap-2 cursor-pointer flex-shrink-0"
        :class="currentTab === 'sync' ? 'border-primary text-primary' : 'border-transparent text-ink-muted hover:text-ink'"
      >
        <RotateCw class="h-4 w-4" aria-hidden="true" />
        <span>재고·공급가 변동 알림 (Sync)</span>
        <span class="bg-warning-soft text-warning text-xs px-2 py-0.5 rounded-full font-mono">{{ syncLogs.length }}</span>
      </button>

      <button
        @click="currentTab = 'flags'; loadFlags()"
        class="py-3 px-5 text-sm font-bold border-b-2 transition flex items-center gap-2 cursor-pointer flex-shrink-0"
        :class="currentTab === 'flags' ? 'border-primary text-primary' : 'border-transparent text-ink-muted hover:text-ink'"
      >
        <ToggleRight class="h-4 w-4 text-success" aria-hidden="true" />
        <span>기능 활성화 관리 (Feature Flags)</span>
        <span class="bg-success-soft text-success text-xs px-2 py-0.5 rounded-full font-mono">{{ flags.length }}개</span>
      </button>

      <button
        @click="currentTab = 'platforms'; loadPlatforms()"
        class="py-3 px-5 text-sm font-bold border-b-2 transition flex items-center gap-2 cursor-pointer flex-shrink-0"
        :class="currentTab === 'platforms' ? 'border-primary text-primary' : 'border-transparent text-ink-muted hover:text-ink'"
      >
        <Globe class="h-4 w-4 text-primary" aria-hidden="true" />
        <span>글로벌 오픈마켓 & 공급망 플랫폼</span>
        <span class="bg-primary-soft text-primary-soft-ink text-xs px-2 py-0.5 rounded-full font-mono">{{ platforms.length }}개</span>
      </button>
    </div>

    <!-- TAB 1: 3PL & Supplier Purchase Orders -->
    <div v-if="currentTab === 'orders'" class="bg-surface rounded-b-xl shadow-sm border border-line p-6 space-y-6">
      <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 class="text-lg font-bold text-ink">공급업체 발주서 (PO) 및 3PL 직출고 관리</h2>
          <p class="text-xs text-ink-muted">
            소비자 주문 결제 확인 시 자동 생성되는 공급사 발주 목록입니다. 송장 등록 시 소비자 주문이 자동 '배송중'으로 처리됩니다.
          </p>
        </div>
        <button
          @click="loadOrders"
          class="text-xs bg-surface-2 hover:bg-surface-3 text-ink-muted px-3.5 py-2 rounded-lg font-bold flex items-center gap-1.5 transition cursor-pointer"
        >
          <RotateCw class="h-4 w-4" aria-hidden="true" /> 목록 새로고침
        </button>
      </div>

      <!-- Orders Table -->
      <div class="overflow-x-auto border border-line rounded-xl">
        <table class="w-full text-xs text-left">
          <thead class="bg-surface-2 text-ink-muted font-bold border-b border-line">
            <tr>
              <th class="px-3 py-3">PO 번호</th>
              <th class="px-3 py-3">원주문 번호</th>
              <th class="px-3 py-3">공급업체 ID</th>
              <th class="px-3 py-3 text-right">총 공급원가</th>
              <th class="px-3 py-3 text-center">발주 상태</th>
              <th class="px-3 py-3">배송 추적 정보</th>
              <th class="px-3 py-3 text-center">발주일시</th>
              <th class="px-3 py-3 text-center">작업</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-line-divider font-mono">
            <tr v-if="orders.length === 0">
              <td colspan="8" class="px-3 py-8 text-center text-ink-subtle font-sans">
                현재 등록된 공급업체 발주서가 없습니다.
              </td>
            </tr>
            <tr v-for="po in orders" :key="po.id" class="hover:bg-surface-2">
              <td class="px-3 py-3 font-bold text-primary">{{ po.id }}</td>
              <td class="px-3 py-3 text-ink-muted">{{ po.sub_order_no || po.sub_order_id }}</td>
              <td class="px-3 py-3 text-ink-muted font-sans font-medium">{{ po.supplier_name || po.supplier_id }}</td>
              <td class="px-3 py-3 text-right font-bold text-ink">₩{{ po.total_supply_cost?.toLocaleString() }}</td>
              <td class="px-3 py-3 text-center font-sans">
                <span
                  class="px-2.5 py-0.5 rounded-full text-[10px] font-bold"
                  :class="{
                    'bg-warning-soft text-warning': po.status === 'REQUESTED',
                    'bg-info-soft text-info': po.status === 'ACCEPTED',
                    'bg-primary-soft text-primary-soft-ink': po.status === 'IN_TRANSIT',
                    'bg-success-soft text-success': po.status === 'DELIVERED',
                    'bg-danger-soft text-danger': po.status === 'REJECTED'
                  }"
                >
                  {{ po.status }}
                </span>
              </td>
              <td class="px-3 py-3 text-ink-muted font-sans">
                <div v-if="po.tracking_number" class="flex items-center gap-1.5 font-mono text-xs">
                  <span class="text-ink-muted font-sans">{{ po.carrier_code }}</span>
                  <span class="font-bold text-ink">{{ po.tracking_number }}</span>
                </div>
                <span v-else class="text-ink-subtle text-[11px]">-</span>
              </td>
              <td class="px-3 py-3 text-center text-ink-subtle text-[11px]">
                {{ po.created_at ? new Date(po.created_at).toLocaleDateString() : '-' }}
              </td>
              <td class="px-3 py-3 text-center font-sans">
                <div class="flex items-center justify-center gap-1.5">
                  <button
                    v-if="po.status === 'REQUESTED'"
                    @click="handleAccept(po)"
                    class="px-2.5 py-1 bg-primary hover:bg-primary-hover text-primary-on rounded text-[11px] font-bold transition cursor-pointer"
                  >
                    발주 승인
                  </button>
                  <button
                    v-if="po.status === 'REQUESTED' || po.status === 'ACCEPTED'"
                    @click="openDispatch(po)"
                    class="px-2.5 py-1 bg-success text-primary-on rounded text-[11px] font-bold transition cursor-pointer"
                  >
                    3PL 출고 등록
                  </button>
                  <span v-if="po.status === 'IN_TRANSIT' || po.status === 'DELIVERED'" class="text-[11px] text-success font-semibold">
                    ✓ 출고 완료
                  </span>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- TAB 2: URL Imports Audit -->
    <div v-if="currentTab === 'imports'" class="bg-surface rounded-b-xl shadow-sm border border-line p-6 space-y-6">
      <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 class="text-lg font-bold text-ink">전사 URL 상품 수집 작업 감사 로그</h2>
          <p class="text-xs text-ink-muted">판매자 및 운영진이 실행한 URL 자동 수집 건의 품질 점수 및 등록 상태를 실시간 모니터링합니다.</p>
        </div>
        <button
          @click="loadImportJobs"
          class="text-xs bg-surface-2 hover:bg-surface-3 text-ink-muted px-3.5 py-2 rounded-lg font-bold flex items-center gap-1.5 transition cursor-pointer"
        >
          <RotateCw class="h-4 w-4" aria-hidden="true" /> 목록 새로고침
        </button>
      </div>

      <div class="overflow-x-auto border border-line rounded-xl">
        <table class="w-full text-xs text-left">
          <thead class="bg-surface-2 text-ink-muted font-bold border-b border-line">
            <tr>
              <th class="px-3 py-3">작업 ID</th>
              <th class="px-3 py-3">파트너 ID</th>
              <th class="px-3 py-3">도메인</th>
              <th class="px-3 py-3">수집 대상 URL</th>
              <th class="px-3 py-3 text-center">품질 점수</th>
              <th class="px-3 py-3 text-center">상태</th>
              <th class="px-3 py-3">발행 상품 ID</th>
              <th class="px-3 py-3 text-right">수집 일시</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-line-divider font-mono">
            <tr v-if="importJobs.length === 0">
              <td colspan="8" class="px-3 py-8 text-center text-ink-subtle font-sans">
                수집 작업 이력이 없습니다.
              </td>
            </tr>
            <tr v-for="j in importJobs" :key="j.id" class="hover:bg-surface-2">
              <td class="px-3 py-3 text-ink-muted font-bold">{{ j.id }}</td>
              <td class="px-3 py-3 text-primary font-sans font-medium">{{ j.partner_id }}</td>
              <td class="px-3 py-3 font-semibold text-ink">{{ j.domain }}</td>
              <td class="px-3 py-3 text-ink-muted max-w-xs truncate" :title="j.source_url">
                <a :href="j.source_url" target="_blank" class="hover:underline flex items-center gap-1">
                  <span>{{ j.source_url }}</span>
                  <ArrowUpRight class="h-4 w-4 text-[9px]" aria-hidden="true" />
                </a>
              </td>
              <td class="px-3 py-3 text-center">
                <span
                  class="px-2 py-0.5 rounded font-bold text-[10px]"
                  :class="j.quality_score >= 80 ? 'bg-success-soft text-success' : 'bg-warning-soft text-warning'"
                >
                  {{ j.quality_score }}점
                </span>
              </td>
              <td class="px-3 py-3 text-center font-sans">
                <span
                  class="px-2 py-0.5 rounded-full text-[10px] font-bold"
                  :class="{
                    'bg-success-soft text-success': j.status === 'PUBLISHED',
                    'bg-primary-soft text-primary-soft-ink': j.status === 'EXTRACTED',
                    'bg-surface-2 text-ink-muted': j.status === 'PENDING',
                    'bg-danger-soft text-danger': j.status === 'FAILED'
                  }"
                >
                  {{ j.status }}
                </span>
              </td>
              <td class="px-3 py-3 text-ink-muted font-mono">{{ j.published_product_id || '-' }}</td>
              <td class="px-3 py-3 text-right text-ink-subtle text-[11px]">
                {{ j.created_at ? new Date(j.created_at).toLocaleDateString() : '-' }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- TAB 3: Inventory & Price Sync Logs -->
    <div v-if="currentTab === 'sync'" class="bg-surface rounded-b-xl shadow-sm border border-line p-6 space-y-6">
      <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 class="text-lg font-bold text-ink">공급업체 재고 및 공급단가 실시간 동기화 감사</h2>
          <p class="text-xs text-ink-muted">
            공급업체 재고 연동 웹훅 및 20% 이상 공급가 급변동 경고(Price Jump Alert) 로그를 기록합니다.
          </p>
        </div>
        <button
          @click="loadSyncLogs"
          class="text-xs bg-surface-2 hover:bg-surface-3 text-ink-muted px-3.5 py-2 rounded-lg font-bold flex items-center gap-1.5 transition cursor-pointer"
        >
          <RotateCw class="h-4 w-4" aria-hidden="true" /> 로그 새로고침
        </button>
      </div>

      <div class="overflow-x-auto border border-line rounded-xl">
        <table class="w-full text-xs text-left">
          <thead class="bg-surface-2 text-ink-muted font-bold border-b border-line">
            <tr>
              <th class="px-3 py-3">공급업체</th>
              <th class="px-3 py-3">SKU ID</th>
              <th class="px-3 py-3 text-right">이전 공급가</th>
              <th class="px-3 py-3 text-right">신규 공급가</th>
              <th class="px-3 py-3 text-center">재고 변동</th>
              <th class="px-3 py-3 text-center">동기화 상태</th>
              <th class="px-3 py-3">알림 상세 사유</th>
              <th class="px-3 py-3 text-right">일시</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-line-divider font-mono">
            <tr v-if="syncLogs.length === 0">
              <td colspan="8" class="px-3 py-8 text-center text-ink-subtle font-sans">
                기록된 재고/가격 변동 로그가 없습니다.
              </td>
            </tr>
            <tr v-for="log in syncLogs" :key="log.id" class="hover:bg-surface-2">
              <td class="px-3 py-3 font-semibold text-ink">{{ log.supplier_id }}</td>
              <td class="px-3 py-3 text-primary">{{ log.sku_id }}</td>
              <td class="px-3 py-3 text-right text-ink-muted">₩{{ log.old_price?.toLocaleString() }}</td>
              <td class="px-3 py-3 text-right font-bold text-ink">₩{{ log.new_price?.toLocaleString() }}</td>
              <td class="px-3 py-3 text-center text-ink-muted">{{ log.old_stock }}개 &rarr; {{ log.new_stock }}개</td>
              <td class="px-3 py-3 text-center font-sans">
                <span
                  class="px-2 py-0.5 rounded-full text-[10px] font-bold"
                  :class="log.sync_status === 'PRICE_JUMP_ALERT' ? 'bg-warning-soft text-warning border border-line' : 'bg-success-soft text-success'"
                >
                  {{ log.sync_status }}
                </span>
              </td>
              <td class="px-3 py-3 font-sans text-warning font-medium">
                {{ log.alert_message || '-' }}
              </td>
              <td class="px-3 py-3 text-right text-ink-subtle text-[11px]">
                {{ log.created_at ? new Date(log.created_at).toLocaleTimeString() : '-' }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- TAB 4: Feature Flags Management -->
    <div v-if="currentTab === 'flags'" class="bg-surface rounded-b-xl shadow-sm border border-line p-6 space-y-6">
      <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 class="text-lg font-bold text-ink flex items-center gap-2">
            <SlidersHorizontal class="h-4 w-4 text-primary" aria-hidden="true" />
            <span>상용 기능별 독립 ON/OFF 제어 (Feature Flags Engine)</span>
          </h2>
          <p class="text-xs text-ink-muted">
            외주 발주, 크롤링, AI 번역, 자동 가격 조정 등 대외 영향이 있는 기능은 검증 및 승인 전까지 안전하게 OFF 차단 정책이 적용됩니다.
          </p>
        </div>
        <button
          @click="loadFlags"
          class="text-xs bg-surface-2 hover:bg-surface-3 text-ink-muted px-3.5 py-2 rounded-lg font-bold flex items-center gap-1.5 transition cursor-pointer"
        >
          <RotateCw class="h-4 w-4" aria-hidden="true" /> 플래그 새로고침
        </button>
      </div>

      <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        <div
          v-for="flag in flags"
          :key="flag.key"
          class="p-5 rounded-2xl border transition-all flex flex-col justify-between"
          :class="flag.is_enabled === 1 ? 'border-primary bg-primary-soft shadow-sm' : 'border-line bg-surface-2 opacity-80'"
        >
          <div class="space-y-3">
            <div class="flex items-center justify-between">
              <span class="text-[11px] font-bold font-mono px-2 py-0.5 rounded uppercase tracking-wider"
                :class="{
                  'bg-danger-soft text-danger': flag.risk_level === 'HIGH',
                  'bg-warning-soft text-warning': flag.risk_level === 'MEDIUM',
                  'bg-surface-3 text-ink-muted': flag.risk_level === 'LOW'
                }"
              >
                위험도: {{ flag.risk_level }}
              </span>

              <!-- Live ON/OFF Switch -->
              <button
                @click="toggleFlag(flag)"
                class="relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none"
                :class="flag.is_enabled === 1 ? 'bg-success' : 'bg-surface-3'"
              >
                <span
                  class="pointer-events-none inline-block h-5 w-5 transform rounded-full bg-surface shadow ring-0 transition duration-200 ease-in-out"
                  :class="flag.is_enabled === 1 ? 'translate-x-5' : 'translate-x-0'"
                />
              </button>
            </div>

            <div>
              <div class="flex items-center gap-2">
                <h3 class="text-sm font-bold text-ink">{{ flag.name }}</h3>
                <span class="text-[10px] font-mono font-semibold" :class="flag.is_enabled === 1 ? 'text-success' : 'text-ink-subtle'">
                  {{ flag.is_enabled === 1 ? '● ACTIVE (ON)' : '○ BLOCKED (OFF)' }}
                </span>
              </div>
              <div class="text-[10px] text-ink-subtle font-mono pt-0.5">{{ flag.key }}</div>
            </div>

            <p class="text-xs text-ink-muted leading-relaxed">{{ flag.description }}</p>
          </div>

          <div class="pt-4 border-t border-line-divider mt-4 flex items-center justify-between text-[11px]">
            <span v-if="flag.requires_credential === 1" class="text-warning font-medium">
              <Key class="h-4 w-4 mr-1" aria-hidden="true" />외부 연동 API 키 필요
            </span>
            <span v-else class="text-success font-medium">
              <CircleCheck class="h-4 w-4 mr-1" aria-hidden="true" />내부 안전 엔진 동작
            </span>
            <span class="text-ink-subtle font-mono text-[10px]">
              {{ flag.updated_at ? new Date(flag.updated_at).toLocaleDateString() : '-' }}
            </span>
          </div>
        </div>
      </div>
    </div>

    <!-- TAB 5: Global OpenMarket & Supply Chain Platforms -->
    <div v-if="currentTab === 'platforms'" class="bg-surface rounded-b-xl shadow-sm border border-line p-6 space-y-6">
      <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 class="text-lg font-bold text-ink flex items-center gap-2">
            <Network class="h-4 w-4 text-primary" aria-hidden="true" />
            <span>글로벌 오픈마켓 & 공급망 플랫폼 연동 매트릭스 ({{ platforms.length }}개)</span>
          </h2>
          <p class="text-xs text-ink-muted">
            국내·글로벌 오픈마켓, B2B 공급처 및 3PL 물류사의 API 규격, 수수료, 연동 상태를 중앙 관제합니다.
          </p>
        </div>
        <button
          @click="loadPlatforms"
          class="text-xs bg-surface-2 hover:bg-surface-3 text-ink-muted px-3.5 py-2 rounded-lg font-bold flex items-center gap-1.5 transition cursor-pointer self-start sm:self-auto"
        >
          <RotateCw class="h-4 w-4" aria-hidden="true" /> 플랫폼 목록 새로고침
        </button>
      </div>

      <!-- Platform KPI Cards -->
      <div class="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div class="bg-info-soft border border-line p-4 rounded-xl">
          <div class="flex items-center justify-between">
            <span class="text-xs font-bold text-info">국내 오픈마켓</span>
            <span class="text-lg">🇰🇷</span>
          </div>
          <div class="mt-2 text-2xl font-bold text-ink">{{ platformSummary?.domestic_openmarket ?? platformCounts.DOMESTIC_OPENMARKET }}개</div>
          <p class="text-[11px] text-info mt-1 font-medium">네이버, 쿠팡, 11번가, G마켓/옥션</p>
        </div>

        <div class="bg-primary-soft border border-line p-4 rounded-xl">
          <div class="flex items-center justify-between">
            <span class="text-xs font-bold text-primary-soft-ink">글로벌 오픈마켓</span>
            <span class="text-lg">🌐</span>
          </div>
          <div class="mt-2 text-2xl font-bold text-ink">{{ platformSummary?.global_openmarket ?? platformCounts.GLOBAL_OPENMARKET }}개</div>
          <p class="text-[11px] text-primary-soft-ink mt-1 font-medium">아마존 SP-API, Shopee, 알리, 라쿠텐</p>
        </div>

        <div class="bg-warning-soft border border-line p-4 rounded-xl">
          <div class="flex items-center justify-between">
            <span class="text-xs font-bold text-warning">B2B 도매 공급사</span>
            <span class="text-lg">📦</span>
          </div>
          <div class="mt-2 text-2xl font-bold text-ink">{{ platformSummary?.b2b_supplier ?? platformCounts.B2B_SUPPLIER }}개</div>
          <p class="text-[11px] text-warning mt-1 font-medium">도매꾹, 도매매, 온채널, 오너클랜</p>
        </div>

        <div class="bg-success-soft border border-line p-4 rounded-xl">
          <div class="flex items-center justify-between">
            <span class="text-xs font-bold text-success">글로벌 3PL 물류사</span>
            <span class="text-lg">🚚</span>
          </div>
          <div class="mt-2 text-2xl font-bold text-ink">{{ platformSummary?.logistics_3pl ?? platformCounts['3PL_LOGISTICS'] }}개</div>
          <p class="text-[11px] text-success mt-1 font-medium">CJ, 한진, 롯데글로벌, 우체국, DHL, FedEx</p>
        </div>
      </div>

      <!-- Inbound Webhooks & Security Notice -->
      <div class="bg-secondary text-secondary-on rounded-xl p-4 sm:p-5 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div class="space-y-1">
          <div class="flex items-center gap-2">
            <span class="px-2 py-0.5 rounded text-[10px] font-bold bg-primary-soft text-primary-soft-ink font-mono">INBOUND WEBHOOK ENDPOINT</span>
            <span class="text-xs text-success font-bold">● HMAC-SHA256 SIGNATURE VERIFIED</span>
          </div>
          <p class="text-xs text-secondary-on/80 font-mono break-all">
            POST {{ API_BASE_URL }}/api/v1/channels/webhooks/:platform_code
          </p>
        </div>
        <div class="flex items-center gap-2 text-xs text-secondary-on/70 font-medium">
          <ShieldCheck class="h-4 w-4 text-success" aria-hidden="true" />
          <span>실제 외부 결제/발주 차단 가드(Safe Mock) 및 멱등키 보증</span>
        </div>
      </div>

      <!-- Category Filter Tabs -->
      <div class="flex flex-wrap gap-2 border-b border-line pb-3">
        <button
          v-for="cat in platformFilterTabs"
          :key="cat.id"
          @click="platformCategoryFilter = cat.id"
          class="px-3 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer"
          :class="platformCategoryFilter === cat.id ? 'bg-primary text-primary-on shadow-sm' : 'bg-surface-2 text-ink-muted hover:bg-surface-3'"
        >
          {{ cat.label }}
        </button>
      </div>

      <!-- Platform Cards Grid -->
      <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        <div
          v-for="platform in filteredPlatforms"
          :key="platform.platform_code"
          class="border rounded-xl p-5 bg-surface transition hover:shadow-md space-y-4 flex flex-col justify-between"
          :class="platform.status === 'ACTIVE' ? 'border-primary' : 'border-line'"
        >
          <div class="space-y-3">
            <div class="flex items-start justify-between gap-2">
              <div class="flex items-center gap-2">
                <span class="text-xl" v-if="platform.country_code === 'KR'">🇰🇷</span>
                <span class="text-xl" v-else-if="platform.country_code === 'US'">🇺🇸</span>
                <span class="text-xl" v-else-if="platform.country_code === 'SG'">🇸🇬</span>
                <span class="text-xl" v-else-if="platform.country_code === 'JP'">🇯🇵</span>
                <span class="text-xl" v-else-if="platform.country_code === 'CN'">🇨🇳</span>
                <span class="text-xl" v-else-if="platform.country_code === 'DE'">🇩🇪</span>
                <span class="text-xl" v-else>🌐</span>
                <div>
                  <h3 class="text-sm font-bold text-ink leading-tight">{{ platform.platform_name }}</h3>
                  <span class="text-[11px] font-mono text-ink-subtle">{{ platform.platform_code }}</span>
                </div>
              </div>
              <span
                class="px-2 py-0.5 rounded text-[10px] font-bold font-mono"
                :class="{
                  'bg-success-soft text-success': platform.status === 'ACTIVE',
                  'bg-info-soft text-info': platform.status === 'READY',
                  'bg-warning-soft text-warning': platform.status === 'BLOCKED_NO_CREDENTIAL' || platform.status === 'INACTIVE'
                }"
              >
                {{ platform.status }}
              </span>
            </div>

            <div class="bg-surface-2 p-2.5 rounded-lg border border-line-divider space-y-1 text-xs">
              <div class="flex justify-between text-ink-muted">
                <span class="text-ink-muted">인증 방식:</span>
                <span class="font-mono font-bold text-ink">{{ platform.auth_type }}</span>
              </div>
              <div class="flex justify-between text-ink-muted">
                <span class="text-ink-muted">채널 수수료율:</span>
                <span class="font-mono font-bold text-primary">{{ (platform.default_commission_rate * 100).toFixed(1) }}%</span>
              </div>
              <div class="flex justify-between text-ink-muted">
                <span class="text-ink-muted">카테고리:</span>
                <span class="font-semibold text-ink-muted text-[11px]">{{ platform.category }}</span>
              </div>
            </div>

            <!-- Capabilities Badges -->
            <div class="space-y-1.5">
              <span class="text-[10px] font-bold text-ink-subtle uppercase tracking-wider">지원 기능 (CAPABILITIES)</span>
              <div class="flex flex-wrap gap-1">
                <span
                  v-for="cap in (platform.capabilities || [])"
                  :key="cap.capability_code"
                  class="px-2 py-0.5 rounded text-[10px] font-medium"
                  :class="cap.is_supported === 1 ? 'bg-primary-soft text-primary-soft-ink border border-line' : 'bg-surface-2 text-ink-subtle line-through'"
                >
                  {{ cap.capability_code }}
                </span>
                <span v-if="!platform.capabilities || platform.capabilities.length === 0" class="text-xs text-ink-subtle">
                  기본 연동 API 규격 정의됨
                </span>
              </div>
            </div>
          </div>

          <div class="pt-3 border-t border-line-divider flex items-center justify-between text-xs text-ink-muted">
            <span class="font-mono text-[11px]">
              <Store class="h-4 w-4 mr-1 text-primary" aria-hidden="true" />
              활성 채널: <strong class="text-ink">{{ platform.active_channels_count || 0 }}개</strong>
            </span>
            <a
              v-if="platform.api_doc_url"
              :href="platform.api_doc_url"
              target="_blank"
              rel="noopener noreferrer"
              class="text-primary hover:underline font-bold flex items-center gap-1 text-[11px]"
            >
              <span>API 개발 문서</span>
              <ArrowUpRight class="h-4 w-4 text-[9px]" aria-hidden="true" />
            </a>
          </div>
        </div>
      </div>
    </div>

    <!-- 3PL Dispatch Modal -->
    <div v-if="showDispatchModal" class="fixed inset-0 bg-overlay/60 z-50 flex items-center justify-center p-4">
      <div class="bg-surface rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4 border border-line">
        <div class="flex items-center justify-between border-b border-line-divider pb-3">
          <h3 class="text-base font-bold text-ink flex items-center gap-2">
            <Truck class="h-4 w-4 text-primary" aria-hidden="true" />
            <span>3PL 운송장 번호 등록 및 직출고</span>
          </h3>
          <button @click="showDispatchModal = false" class="text-ink-subtle hover:text-ink">
            <X class="h-4 w-4 text-lg" aria-hidden="true" />
          </button>
        </div>

        <div class="space-y-3 text-xs">
          <div class="bg-surface-2 p-3 rounded-lg border border-line space-y-1">
            <div class="text-ink-muted">발주 번호: <span class="font-mono font-bold text-ink">{{ dispatchTarget?.id }}</span></div>
            <div class="text-ink-muted">공급처: <span class="font-bold text-ink">{{ dispatchTarget?.supplier_name || dispatchTarget?.supplier_id }}</span></div>
            <div class="text-ink-muted">공급 총액: <span class="font-mono font-bold text-ink">₩{{ dispatchTarget?.total_supply_cost?.toLocaleString() }}</span></div>
          </div>

          <div class="space-y-1">
            <label class="block font-bold text-ink-muted">택배사 / 3PL 물류사</label>
            <select
              v-model="dispatchCarrier"
              class="w-full p-2.5 rounded-lg border border-line bg-surface text-ink font-medium"
            >
              <option value="CJ대한통운">CJ대한통운</option>
              <option value="한진택배">한진택배</option>
              <option value="우체국택배">우체국택배</option>
              <option value="로젠택배">로젠택배</option>
              <option value="롯데택배">롯데택배</option>
              <option value="3PL_INCHEON_LOGIS">인천 글로벌 3PL 물류센터</option>
            </select>
          </div>

          <div class="space-y-1">
            <label class="block font-bold text-ink-muted">송장 번호 (Tracking Number)</label>
            <input
              v-model="dispatchTracking"
              type="text"
              placeholder="예: 682910482012"
              class="w-full p-2.5 rounded-lg border border-line bg-surface text-ink font-mono text-sm"
            />
          </div>

          <p class="text-[11px] text-primary-soft-ink bg-primary-soft p-2.5 rounded-lg border border-line">
            운송장이 등록되면 고객의 주문 상태가 즉시 <strong>'배송중(SHIPPED)'</strong>으로 자동 업데이트되며, 실시간 택배 조회 링크가 활성화됩니다.
          </p>
        </div>

        <div class="flex justify-end gap-2 pt-2">
          <button
            @click="showDispatchModal = false"
            class="px-4 py-2 text-xs font-bold text-ink-muted hover:text-ink transition cursor-pointer"
          >
            취소
          </button>
          <button
            @click="executeDispatch"
            :disabled="isDispatching"
            class="px-5 py-2 bg-primary hover:bg-primary-hover disabled:bg-surface-3 disabled:text-ink-subtle text-primary-on text-xs font-bold rounded-lg shadow transition flex items-center gap-1.5 cursor-pointer"
          >
            <LoaderCircle v-if="isDispatching" class="h-4 w-4 animate-spin" aria-hidden="true" />
            <span>{{ isDispatching ? '처리 중...' : '출고 완료 처리' }}</span>
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
