<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { adminApi, won } from '../config';

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

const currentTab = ref<'orders' | 'imports' | 'sync' | 'flags'>('orders');

// State
const orders = ref<SupplierOrder[]>([]);
const importJobs = ref<ImportJob[]>([]);
const syncLogs = ref<SyncLog[]>([]);
const flags = ref<FeatureFlag[]>([]);
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
    orders.value = r.data.data || [];
  } catch (err) {
    console.error('Failed to load supplier orders:', err);
  } finally {
    isLoading.value = false;
  }
}

async function loadImportJobs() {
  isLoading.value = true;
  try {
    const r = await adminApi('/api/v1/admin/imports/jobs');
    importJobs.value = r.data.data || [];
  } catch (err) {
    console.error('Failed to load import jobs:', err);
  } finally {
    isLoading.value = false;
  }
}

async function loadSyncLogs() {
  isLoading.value = true;
  try {
    const r = await adminApi('/api/v1/admin/sync/logs');
    syncLogs.value = r.data.data || [];
  } catch (err) {
    console.error('Failed to load sync logs:', err);
  } finally {
    isLoading.value = false;
  }
}

async function loadFlags() {
  isLoading.value = true;
  try {
    const r = await adminApi('/api/v1/admin/feature-flags');
    flags.value = r.data.data || [];
  } catch (err) {
    console.error('Failed to load feature flags:', err);
  } finally {
    isLoading.value = false;
  }
}

async function toggleFlag(flag: FeatureFlag) {
  const targetState = flag.is_enabled === 1 ? false : true;
  const verb = targetState ? '활성화(ON)' : '비활성화(OFF)';
  if (!confirm(`[${flag.name}] 기능을 ${verb} 하시겠습니까?\n주의: ${flag.description}`)) return;

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
  if (!confirm(`PO [${po.id}] 발주를 접수/승인하시겠습니까?`)) return;
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
    alert('운송장 번호를 입력해 주세요.');
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

onMounted(() => {
  loadHealth();
  loadOrders();
  loadImportJobs();
  loadSyncLogs();
  loadFlags();
});
</script>

<template>
  <div class="max-w-7xl mx-auto px-4 py-8 space-y-6">
    <!-- Header Hero Banner -->
    <div class="bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 rounded-2xl p-6 sm:p-8 text-white shadow-xl relative overflow-hidden">
      <div class="relative z-10 space-y-3">
        <div class="flex flex-wrap items-center gap-3">
          <div class="inline-flex items-center gap-2 bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 px-3 py-1 rounded-full text-xs font-semibold">
            <i class="fa-solid fa-boxes-packing text-amber-400"></i>
            <span>3PL FULFILLMENT & DROPSHIP CENTER</span>
          </div>
          <div class="flex items-center gap-2 text-xs bg-slate-800/80 px-3 py-1 rounded-full border border-slate-700 font-mono">
            <span class="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
            <span>SSRF DEFENSE: {{ systemHealth?.ssrf_protection || 'ACTIVE' }}</span>
          </div>
        </div>
        <h1 class="text-2xl sm:text-3xl font-extrabold tracking-tight">3PL 물류 대행 & 위탁판매 통합 관제 센터</h1>
        <p class="text-xs sm:text-sm text-slate-300 max-w-3xl leading-relaxed">
          외부 위탁 공급업체 발주(PO) 접수 및 3PL 직출고 송장 연동, 전사 URL 상품 수집 작업 감사, 실시간 공급가/재고 변동 알림 및 <strong>기능별 독립 ON/OFF 제어(Feature Flags)</strong>를 통합 관리합니다.
        </p>
      </div>
      <div class="absolute -right-6 -bottom-6 opacity-10 text-white text-9xl pointer-events-none">
        <i class="fa-solid fa-truck-ramp-box"></i>
      </div>
    </div>

    <!-- Alert Banners -->
    <div v-if="actionMsg" class="p-4 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-xl flex items-center gap-3">
      <i class="fa-solid fa-circle-check text-emerald-500 text-lg flex-shrink-0"></i>
      <span class="text-sm font-semibold">{{ actionMsg }}</span>
    </div>
    <div v-if="errorMsg" class="p-4 bg-rose-50 border border-rose-200 text-rose-800 rounded-xl flex items-center gap-3">
      <i class="fa-solid fa-triangle-exclamation text-rose-500 text-lg flex-shrink-0"></i>
      <span class="text-sm font-semibold">{{ errorMsg }}</span>
    </div>

    <!-- Navigation Tabs -->
    <div class="flex border-b border-slate-200 bg-white rounded-t-xl px-4 pt-2 overflow-x-auto">
      <button
        @click="currentTab = 'orders'; loadOrders()"
        class="py-3 px-5 text-sm font-bold border-b-2 transition flex items-center gap-2 cursor-pointer flex-shrink-0"
        :class="currentTab === 'orders' ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-slate-500 hover:text-slate-800'"
      >
        <i class="fa-solid fa-truck-fast"></i>
        <span>3PL & 위탁 공급사 발주 (PO)</span>
        <span class="bg-indigo-100 text-indigo-700 text-xs px-2 py-0.5 rounded-full font-mono">{{ orders.length }}</span>
      </button>

      <button
        @click="currentTab = 'imports'; loadImportJobs()"
        class="py-3 px-5 text-sm font-bold border-b-2 transition flex items-center gap-2 cursor-pointer flex-shrink-0"
        :class="currentTab === 'imports' ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-slate-500 hover:text-slate-800'"
      >
        <i class="fa-solid fa-cloud-arrow-down"></i>
        <span>URL 상품 수집 감사 (Imports)</span>
        <span class="bg-slate-100 text-slate-700 text-xs px-2 py-0.5 rounded-full font-mono">{{ importJobs.length }}</span>
      </button>

      <button
        @click="currentTab = 'sync'; loadSyncLogs()"
        class="py-3 px-5 text-sm font-bold border-b-2 transition flex items-center gap-2 cursor-pointer flex-shrink-0"
        :class="currentTab === 'sync' ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-slate-500 hover:text-slate-800'"
      >
        <i class="fa-solid fa-arrows-rotate"></i>
        <span>재고·공급가 변동 알림 (Sync)</span>
        <span class="bg-amber-100 text-amber-800 text-xs px-2 py-0.5 rounded-full font-mono">{{ syncLogs.length }}</span>
      </button>

      <button
        @click="currentTab = 'flags'; loadFlags()"
        class="py-3 px-5 text-sm font-bold border-b-2 transition flex items-center gap-2 cursor-pointer flex-shrink-0"
        :class="currentTab === 'flags' ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-slate-500 hover:text-slate-800'"
      >
        <i class="fa-solid fa-toggle-on text-emerald-500"></i>
        <span>기능 활성화 관리 (Feature Flags)</span>
        <span class="bg-emerald-100 text-emerald-800 text-xs px-2 py-0.5 rounded-full font-mono">9개</span>
      </button>
    </div>

    <!-- TAB 1: 3PL & Supplier Purchase Orders -->
    <div v-if="currentTab === 'orders'" class="bg-white rounded-b-xl shadow-sm border border-slate-200 p-6 space-y-6">
      <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 class="text-lg font-bold text-slate-900">공급업체 발주서 (PO) 및 3PL 직출고 관리</h2>
          <p class="text-xs text-slate-500">
            소비자 주문 결제 확인 시 자동 생성되는 공급사 발주 목록입니다. 송장 등록 시 소비자 주문이 자동 '배송중'으로 처리됩니다.
          </p>
        </div>
        <button
          @click="loadOrders"
          class="text-xs bg-slate-100 hover:bg-slate-200 text-slate-700 px-3.5 py-2 rounded-lg font-bold flex items-center gap-1.5 transition cursor-pointer"
        >
          <i class="fa-solid fa-rotate-right"></i> 목록 새로고침
        </button>
      </div>

      <!-- Orders Table -->
      <div class="overflow-x-auto border border-slate-200 rounded-xl">
        <table class="w-full text-xs text-left">
          <thead class="bg-slate-50 text-slate-600 font-bold border-b border-slate-200">
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
          <tbody class="divide-y divide-slate-100 font-mono">
            <tr v-if="orders.length === 0">
              <td colspan="8" class="px-3 py-8 text-center text-slate-400 font-sans">
                현재 등록된 공급업체 발주서가 없습니다.
              </td>
            </tr>
            <tr v-for="po in orders" :key="po.id" class="hover:bg-slate-50">
              <td class="px-3 py-3 font-bold text-indigo-700">{{ po.id }}</td>
              <td class="px-3 py-3 text-slate-600">{{ po.sub_order_no || po.sub_order_id }}</td>
              <td class="px-3 py-3 text-slate-700 font-sans font-medium">{{ po.supplier_name || po.supplier_id }}</td>
              <td class="px-3 py-3 text-right font-bold text-slate-900">₩{{ po.total_supply_cost?.toLocaleString() }}</td>
              <td class="px-3 py-3 text-center font-sans">
                <span
                  class="px-2.5 py-0.5 rounded-full text-[10px] font-bold"
                  :class="{
                    'bg-amber-100 text-amber-800': po.status === 'REQUESTED',
                    'bg-blue-100 text-blue-800': po.status === 'ACCEPTED',
                    'bg-indigo-100 text-indigo-800': po.status === 'IN_TRANSIT',
                    'bg-emerald-100 text-emerald-800': po.status === 'DELIVERED',
                    'bg-rose-100 text-rose-800': po.status === 'REJECTED'
                  }"
                >
                  {{ po.status }}
                </span>
              </td>
              <td class="px-3 py-3 text-slate-600 font-sans">
                <div v-if="po.tracking_number" class="flex items-center gap-1.5 font-mono text-xs">
                  <span class="text-slate-500 font-sans">{{ po.carrier_code }}</span>
                  <span class="font-bold text-slate-900">{{ po.tracking_number }}</span>
                </div>
                <span v-else class="text-slate-400 text-[11px]">-</span>
              </td>
              <td class="px-3 py-3 text-center text-slate-400 text-[11px]">
                {{ po.created_at ? new Date(po.created_at).toLocaleDateString() : '-' }}
              </td>
              <td class="px-3 py-3 text-center font-sans">
                <div class="flex items-center justify-center gap-1.5">
                  <button
                    v-if="po.status === 'REQUESTED'"
                    @click="handleAccept(po)"
                    class="px-2.5 py-1 bg-indigo-600 hover:bg-indigo-700 text-white rounded text-[11px] font-bold transition cursor-pointer"
                  >
                    발주 승인
                  </button>
                  <button
                    v-if="po.status === 'REQUESTED' || po.status === 'ACCEPTED'"
                    @click="openDispatch(po)"
                    class="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded text-[11px] font-bold transition cursor-pointer"
                  >
                    3PL 출고 등록
                  </button>
                  <span v-if="po.status === 'IN_TRANSIT' || po.status === 'DELIVERED'" class="text-[11px] text-emerald-600 font-semibold">
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
    <div v-if="currentTab === 'imports'" class="bg-white rounded-b-xl shadow-sm border border-slate-200 p-6 space-y-6">
      <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 class="text-lg font-bold text-slate-900">전사 URL 상품 수집 작업 감사 로그</h2>
          <p class="text-xs text-slate-500">판매자 및 운영진이 실행한 URL 자동 수집 건의 품질 점수 및 등록 상태를 실시간 모니터링합니다.</p>
        </div>
        <button
          @click="loadImportJobs"
          class="text-xs bg-slate-100 hover:bg-slate-200 text-slate-700 px-3.5 py-2 rounded-lg font-bold flex items-center gap-1.5 transition cursor-pointer"
        >
          <i class="fa-solid fa-rotate-right"></i> 목록 새로고침
        </button>
      </div>

      <div class="overflow-x-auto border border-slate-200 rounded-xl">
        <table class="w-full text-xs text-left">
          <thead class="bg-slate-50 text-slate-600 font-bold border-b border-slate-200">
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
          <tbody class="divide-y divide-slate-100 font-mono">
            <tr v-if="importJobs.length === 0">
              <td colspan="8" class="px-3 py-8 text-center text-slate-400 font-sans">
                수집 작업 이력이 없습니다.
              </td>
            </tr>
            <tr v-for="j in importJobs" :key="j.id" class="hover:bg-slate-50">
              <td class="px-3 py-3 text-slate-700 font-bold">{{ j.id }}</td>
              <td class="px-3 py-3 text-indigo-700 font-sans font-medium">{{ j.partner_id }}</td>
              <td class="px-3 py-3 font-semibold text-slate-800">{{ j.domain }}</td>
              <td class="px-3 py-3 text-slate-500 max-w-xs truncate" :title="j.source_url">
                <a :href="j.source_url" target="_blank" class="hover:underline flex items-center gap-1">
                  <span>{{ j.source_url }}</span>
                  <i class="fa-solid fa-arrow-up-right-from-square text-[9px]"></i>
                </a>
              </td>
              <td class="px-3 py-3 text-center">
                <span
                  class="px-2 py-0.5 rounded font-bold text-[10px]"
                  :class="j.quality_score >= 80 ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'"
                >
                  {{ j.quality_score }}점
                </span>
              </td>
              <td class="px-3 py-3 text-center font-sans">
                <span
                  class="px-2 py-0.5 rounded-full text-[10px] font-bold"
                  :class="{
                    'bg-emerald-100 text-emerald-700': j.status === 'PUBLISHED',
                    'bg-indigo-100 text-indigo-700': j.status === 'EXTRACTED',
                    'bg-slate-100 text-slate-700': j.status === 'PENDING',
                    'bg-rose-100 text-rose-700': j.status === 'FAILED'
                  }"
                >
                  {{ j.status }}
                </span>
              </td>
              <td class="px-3 py-3 text-slate-600 font-mono">{{ j.published_product_id || '-' }}</td>
              <td class="px-3 py-3 text-right text-slate-400 text-[11px]">
                {{ j.created_at ? new Date(j.created_at).toLocaleDateString() : '-' }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- TAB 3: Inventory & Price Sync Logs -->
    <div v-if="currentTab === 'sync'" class="bg-white rounded-b-xl shadow-sm border border-slate-200 p-6 space-y-6">
      <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 class="text-lg font-bold text-slate-900">공급업체 재고 및 공급단가 실시간 동기화 감사</h2>
          <p class="text-xs text-slate-500">
            공급업체 재고 연동 웹훅 및 20% 이상 공급가 급변동 경고(Price Jump Alert) 로그를 기록합니다.
          </p>
        </div>
        <button
          @click="loadSyncLogs"
          class="text-xs bg-slate-100 hover:bg-slate-200 text-slate-700 px-3.5 py-2 rounded-lg font-bold flex items-center gap-1.5 transition cursor-pointer"
        >
          <i class="fa-solid fa-rotate-right"></i> 로그 새로고침
        </button>
      </div>

      <div class="overflow-x-auto border border-slate-200 rounded-xl">
        <table class="w-full text-xs text-left">
          <thead class="bg-slate-50 text-slate-600 font-bold border-b border-slate-200">
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
          <tbody class="divide-y divide-slate-100 font-mono">
            <tr v-if="syncLogs.length === 0">
              <td colspan="8" class="px-3 py-8 text-center text-slate-400 font-sans">
                기록된 재고/가격 변동 로그가 없습니다.
              </td>
            </tr>
            <tr v-for="log in syncLogs" :key="log.id" class="hover:bg-slate-50">
              <td class="px-3 py-3 font-semibold text-slate-800">{{ log.supplier_id }}</td>
              <td class="px-3 py-3 text-indigo-700">{{ log.sku_id }}</td>
              <td class="px-3 py-3 text-right text-slate-500">₩{{ log.old_price?.toLocaleString() }}</td>
              <td class="px-3 py-3 text-right font-bold text-slate-900">₩{{ log.new_price?.toLocaleString() }}</td>
              <td class="px-3 py-3 text-center text-slate-700">{{ log.old_stock }}개 &rarr; {{ log.new_stock }}개</td>
              <td class="px-3 py-3 text-center font-sans">
                <span
                  class="px-2 py-0.5 rounded-full text-[10px] font-bold"
                  :class="log.sync_status === 'PRICE_JUMP_ALERT' ? 'bg-amber-100 text-amber-800 border border-amber-300' : 'bg-emerald-100 text-emerald-800'"
                >
                  {{ log.sync_status }}
                </span>
              </td>
              <td class="px-3 py-3 font-sans text-amber-800 font-medium">
                {{ log.alert_message || '-' }}
              </td>
              <td class="px-3 py-3 text-right text-slate-400 text-[11px]">
                {{ log.created_at ? new Date(log.created_at).toLocaleTimeString() : '-' }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- TAB 4: Feature Flags Management -->
    <div v-if="currentTab === 'flags'" class="bg-white rounded-b-xl shadow-sm border border-slate-200 p-6 space-y-6">
      <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 class="text-lg font-bold text-slate-900 flex items-center gap-2">
            <i class="fa-solid fa-sliders text-indigo-600"></i>
            <span>상용 기능별 독립 ON/OFF 제어 (Feature Flags Engine)</span>
          </h2>
          <p class="text-xs text-slate-500">
            외주 발주, 크롤링, AI 번역, 자동 가격 조정 등 대외 영향이 있는 기능은 검증 및 승인 전까지 안전하게 OFF 차단 정책이 적용됩니다.
          </p>
        </div>
        <button
          @click="loadFlags"
          class="text-xs bg-slate-100 hover:bg-slate-200 text-slate-700 px-3.5 py-2 rounded-lg font-bold flex items-center gap-1.5 transition cursor-pointer"
        >
          <i class="fa-solid fa-rotate-right"></i> 플래그 새로고침
        </button>
      </div>

      <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        <div
          v-for="flag in flags"
          :key="flag.key"
          class="p-5 rounded-2xl border transition-all flex flex-col justify-between"
          :class="flag.is_enabled === 1 ? 'border-indigo-300 bg-indigo-50/30 shadow-sm' : 'border-slate-200 bg-slate-50/60 opacity-80'"
        >
          <div class="space-y-3">
            <div class="flex items-center justify-between">
              <span class="text-[11px] font-bold font-mono px-2 py-0.5 rounded uppercase tracking-wider"
                :class="{
                  'bg-rose-100 text-rose-800': flag.risk_level === 'HIGH',
                  'bg-amber-100 text-amber-800': flag.risk_level === 'MEDIUM',
                  'bg-slate-200 text-slate-700': flag.risk_level === 'LOW'
                }"
              >
                위험도: {{ flag.risk_level }}
              </span>

              <!-- Live ON/OFF Switch -->
              <button
                @click="toggleFlag(flag)"
                class="relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none"
                :class="flag.is_enabled === 1 ? 'bg-emerald-600' : 'bg-slate-300'"
              >
                <span
                  class="pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out"
                  :class="flag.is_enabled === 1 ? 'translate-x-5' : 'translate-x-0'"
                />
              </button>
            </div>

            <div>
              <div class="flex items-center gap-2">
                <h3 class="text-sm font-bold text-slate-900">{{ flag.name }}</h3>
                <span class="text-[10px] font-mono font-semibold" :class="flag.is_enabled === 1 ? 'text-emerald-700' : 'text-slate-400'">
                  {{ flag.is_enabled === 1 ? '● ACTIVE (ON)' : '○ BLOCKED (OFF)' }}
                </span>
              </div>
              <div class="text-[10px] text-slate-400 font-mono pt-0.5">{{ flag.key }}</div>
            </div>

            <p class="text-xs text-slate-600 leading-relaxed">{{ flag.description }}</p>
          </div>

          <div class="pt-4 border-t border-slate-200/60 mt-4 flex items-center justify-between text-[11px]">
            <span v-if="flag.requires_credential === 1" class="text-amber-800 font-medium">
              <i class="fa-solid fa-key mr-1"></i>외부 연동 API 키 필요
            </span>
            <span v-else class="text-emerald-700 font-medium">
              <i class="fa-solid fa-circle-check mr-1"></i>내부 안전 엔진 동작
            </span>
            <span class="text-slate-400 font-mono text-[10px]">
              {{ flag.updated_at ? new Date(flag.updated_at).toLocaleDateString() : '-' }}
            </span>
          </div>
        </div>
      </div>
    </div>

    <!-- 3PL Dispatch Modal -->
    <div v-if="showDispatchModal" class="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
      <div class="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4">
        <div class="flex items-center justify-between border-b border-slate-100 pb-3">
          <h3 class="text-base font-bold text-slate-900 flex items-center gap-2">
            <i class="fa-solid fa-truck-ramp-box text-indigo-600"></i>
            <span>3PL 운송장 번호 등록 및 직출고</span>
          </h3>
          <button @click="showDispatchModal = false" class="text-slate-400 hover:text-slate-600">
            <i class="fa-solid fa-xmark text-lg"></i>
          </button>
        </div>

        <div class="space-y-3 text-xs">
          <div class="bg-slate-50 p-3 rounded-lg border border-slate-200 space-y-1">
            <div class="text-slate-500">발주 번호: <span class="font-mono font-bold text-slate-900">{{ dispatchTarget?.id }}</span></div>
            <div class="text-slate-500">공급처: <span class="font-bold text-slate-900">{{ dispatchTarget?.supplier_name || dispatchTarget?.supplier_id }}</span></div>
            <div class="text-slate-500">공급 총액: <span class="font-mono font-bold text-slate-900">₩{{ dispatchTarget?.total_supply_cost?.toLocaleString() }}</span></div>
          </div>

          <div class="space-y-1">
            <label class="block font-bold text-slate-700">택배사 / 3PL 물류사</label>
            <select
              v-model="dispatchCarrier"
              class="w-full p-2.5 rounded-lg border border-slate-300 bg-white font-medium"
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
            <label class="block font-bold text-slate-700">송장 번호 (Tracking Number)</label>
            <input
              v-model="dispatchTracking"
              type="text"
              placeholder="예: 682910482012"
              class="w-full p-2.5 rounded-lg border border-slate-300 font-mono text-sm"
            />
          </div>

          <p class="text-[11px] text-indigo-700 bg-indigo-50 p-2.5 rounded-lg border border-indigo-100">
            ℹ️ 운송장이 등록되면 고객의 주문 상태가 즉시 <strong>'배송중(SHIPPED)'</strong>으로 자동 업데이트되며, 실시간 택배 조회 링크가 활성화됩니다.
          </p>
        </div>

        <div class="flex justify-end gap-2 pt-2">
          <button
            @click="showDispatchModal = false"
            class="px-4 py-2 text-xs font-bold text-slate-600 hover:text-slate-800 transition cursor-pointer"
          >
            취소
          </button>
          <button
            @click="executeDispatch"
            :disabled="isDispatching"
            class="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-400 text-white text-xs font-bold rounded-lg shadow transition flex items-center gap-1.5 cursor-pointer"
          >
            <i v-if="isDispatching" class="fa-solid fa-spinner fa-spin"></i>
            <span>{{ isDispatching ? '처리 중...' : '출고 완료 처리' }}</span>
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
