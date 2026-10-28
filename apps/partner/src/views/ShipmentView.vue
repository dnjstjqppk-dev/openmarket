<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { API_BASE, getPartnerHeaders } from '../config';

interface OrderItem {
  id: string;
  sku_id: string;
  product_id?: string;
  product_title?: string;
  quantity: number;
  unit_price: number;
  total_price: number;
  thumbnail_url?: string;
}

interface SubOrder {
  id: string;
  order_no: string;
  sub_order_no: string;
  recipient_name: string;
  recipient_phone: string;
  shipping_postal_code?: string;
  shipping_address_line1: string;
  shipping_address_line2?: string;
  shipping_memo?: string;
  carrier_code?: string;
  tracking_number?: string;
  status: string;
  total_amount: number;
  order_date?: string;
  items?: OrderItem[];
}

const shipments = ref<SubOrder[]>([]);
const loading = ref(true);
const isSaving = ref<string | null>(null);
const copyToast = ref<string | null>(null);
const activeFilter = ref<'ALL' | 'PENDING' | 'SHIPPED'>('ALL');
const searchQuery = ref('');
const selectedIds = ref<string[]>([]);

// Modals
const showBulkModal = ref(false);
const bulkCarrier = ref('CJ대한통운');
const bulkTrackingInput = ref('');
const isBulkSaving = ref(false);

const showPackingSlipModal = ref(false);
const packingSlipOrder = ref<SubOrder | null>(null);

const carrierOptions = [
  'CJ대한통운',
  '우체국택배',
  '한진택배',
  '롯데택배',
  '로젠택배',
  '경동택배',
  '한진국제특송 (EMS)'
];

const filteredShipments = computed(() => {
  let list = shipments.value;

  if (activeFilter.value === 'PENDING') {
    list = list.filter(s => s.status !== 'SHIPPED' && s.status !== 'DELIVERED');
  } else if (activeFilter.value === 'SHIPPED') {
    list = list.filter(s => s.status === 'SHIPPED' || s.status === 'DELIVERED');
  }

  const query = searchQuery.value.trim().toLowerCase();
  if (query) {
    list = list.filter(s =>
      (s.sub_order_no || s.order_no || '').toLowerCase().includes(query) ||
      (s.recipient_name || '').toLowerCase().includes(query) ||
      (s.recipient_phone || '').includes(query) ||
      (s.tracking_number || '').includes(query)
    );
  }

  return list;
});

const isAllSelected = computed(() => {
  const pending = filteredShipments.value.filter(s => s.status !== 'SHIPPED' && s.status !== 'DELIVERED');
  return pending.length > 0 && pending.every(s => selectedIds.value.includes(s.id));
});

function toggleSelectAll() {
  const pending = filteredShipments.value.filter(s => s.status !== 'SHIPPED' && s.status !== 'DELIVERED');
  if (isAllSelected.value) {
    selectedIds.value = selectedIds.value.filter(id => !pending.some(p => p.id === id));
  } else {
    const toAdd = pending.map(p => p.id);
    selectedIds.value = Array.from(new Set([...selectedIds.value, ...toAdd]));
  }
}

async function loadShipments() {
  loading.value = true;
  try {
    const res = await fetch(`${API_BASE}/api/v1/partner/orders`, {
      headers: getPartnerHeaders()
    });
    const json = await res.json();
    if (json.success && json.data) {
      shipments.value = json.data;
    }
  } catch (_) {
  } finally {
    loading.value = false;
  }
}

async function saveTracking(order: SubOrder) {
  if (!order.tracking_number || !order.tracking_number.trim()) return;
  isSaving.value = order.id;

  try {
    const res = await fetch(`${API_BASE}/api/v1/partner/orders/${order.id}/shipment`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...getPartnerHeaders() },
      body: JSON.stringify({
        carrier: order.carrier_code || 'CJ대한통운',
        tracking_number: order.tracking_number.trim()
      })
    });
    if (res.ok) {
      order.status = 'SHIPPED';
      selectedIds.value = selectedIds.value.filter(id => id !== order.id);
    }
  } catch (_) {
  } finally {
    isSaving.value = null;
  }
}

async function executeBulkShipment() {
  if (selectedIds.value.length === 0) return;
  isBulkSaving.value = true;

  try {
    const lines = bulkTrackingInput.value.split('\n').map(l => l.trim()).filter(Boolean);
    const shipmentsPayload = selectedIds.value.map((id, index) => {
      const tracking = lines[index] || `68${Date.now().toString().slice(-8)}${index}`;
      return {
        sub_order_id: id,
        carrier: bulkCarrier.value,
        tracking_number: tracking
      };
    });

    const res = await fetch(`${API_BASE}/api/v1/partner/orders/bulk-shipment`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...getPartnerHeaders() },
      body: JSON.stringify({ shipments: shipmentsPayload })
    });

    if (res.ok) {
      showBulkModal.value = false;
      selectedIds.value = [];
      bulkTrackingInput.value = '';
      await loadShipments();
    }
  } catch (_) {
  } finally {
    isBulkSaving.value = false;
  }
}

function exportToCSV() {
  const pending = shipments.value.filter(s => s.status !== 'SHIPPED' && s.status !== 'DELIVERED');
  if (pending.length === 0) {
    alert('출고 대기 중인 주문이 없습니다.');
    return;
  }

  const headers = ['주문번호', '하위주문번호', '수령인', '연락처', '우편번호', '주소', '상세주소', '배송메모', '품목수', '총금액'];
  const rows = pending.map(s => [
    `"${s.order_no}"`,
    `"${s.sub_order_no || s.id}"`,
    `"${s.recipient_name}"`,
    `"${s.recipient_phone}"`,
    `"${s.shipping_postal_code || ''}"`,
    `"${(s.shipping_address_line1 || '').replace(/"/g, '""')}"`,
    `"${(s.shipping_address_line2 || '').replace(/"/g, '""')}"`,
    `"${(s.shipping_memo || '').replace(/"/g, '""')}"`,
    s.items ? s.items.length : 1,
    s.total_amount
  ]);

  const csvContent = '\uFEFF' + [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `OLMOA_Pending_Shipments_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function openPackingSlip(order: SubOrder) {
  packingSlipOrder.value = order;
  showPackingSlipModal.value = true;
}

function printPackingSlip() {
  window.print();
}

function copyAddress(s: SubOrder) {
  const full = `[${s.shipping_postal_code || '우편번호 미기재'}] ${s.shipping_address_line1} ${s.shipping_address_line2 || ''} (수령인: ${s.recipient_name}, ${s.recipient_phone}) / 요청: ${s.shipping_memo || '문 앞'}`;
  navigator.clipboard.writeText(full).then(() => {
    copyToast.value = s.id;
    setTimeout(() => {
      copyToast.value = null;
    }, 2000);
  });
}

onMounted(() => {
  loadShipments();
});
</script>

<template>
  <div class="space-y-6">
    <!-- Top Header & Summary Stats -->
    <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-200 pb-4">
      <div>
        <h1 class="text-xl sm:text-2xl font-black text-slate-900 flex items-center gap-2">
          <span>📦 주문 발송 및 운송장 통합 관리</span>
        </h1>
        <p class="text-xs text-slate-500 mt-1">
          D1 실시간 인입 주문의 송장번호를 등록하여 고객 배송추적 시스템과 즉시 동기화합니다.
        </p>
      </div>

      <!-- Quick Batch Actions -->
      <div class="flex flex-wrap items-center gap-2 self-start sm:self-auto">
        <button
          v-if="selectedIds.length > 0"
          @click="showBulkModal = true"
          class="px-3.5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs shadow-xs transition flex items-center gap-1.5 cursor-pointer"
        >
          <i class="fa-solid fa-truck-ramp-box"></i>
          <span>선택 {{ selectedIds.length }}건 일괄 출고</span>
        </button>
        <button
          @click="exportToCSV"
          class="px-3.5 py-2 rounded-xl bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 font-bold text-xs shadow-xs transition flex items-center gap-1.5 cursor-pointer"
        >
          <i class="fa-solid fa-file-excel text-emerald-600"></i>
          <span>엑셀/CSV 다운로드</span>
        </button>
      </div>
    </div>

    <!-- Filter Tabs & Instant Search -->
    <div class="flex flex-col md:flex-row md:items-center justify-between gap-3 bg-white p-3 rounded-2xl border border-slate-200 shadow-xs">
      <div class="flex items-center gap-1.5 overflow-x-auto no-scrollbar py-0.5">
        <button
          @click="activeFilter = 'ALL'"
          :class="[
            'px-3.5 py-1.5 rounded-lg text-xs font-bold transition whitespace-nowrap cursor-pointer shrink-0',
            activeFilter === 'ALL' ? 'bg-indigo-600 text-white shadow-xs' : 'bg-slate-50 text-slate-700 hover:bg-slate-100'
          ]"
        >
          전체 ({{ shipments.length }})
        </button>
        <button
          @click="activeFilter = 'PENDING'"
          :class="[
            'px-3.5 py-1.5 rounded-lg text-xs font-bold transition whitespace-nowrap cursor-pointer shrink-0',
            activeFilter === 'PENDING' ? 'bg-indigo-600 text-white shadow-xs' : 'bg-slate-50 text-slate-700 hover:bg-slate-100'
          ]"
        >
          출고 대기 ({{ shipments.filter(s => s.status !== 'SHIPPED' && s.status !== 'DELIVERED').length }})
        </button>
        <button
          @click="activeFilter = 'SHIPPED'"
          :class="[
            'px-3.5 py-1.5 rounded-lg text-xs font-bold transition whitespace-nowrap cursor-pointer shrink-0',
            activeFilter === 'SHIPPED' ? 'bg-indigo-600 text-white shadow-xs' : 'bg-slate-50 text-slate-700 hover:bg-slate-100'
          ]"
        >
          출고 완료 ({{ shipments.filter(s => s.status === 'SHIPPED' || s.status === 'DELIVERED').length }})
        </button>
      </div>

      <div class="relative w-full md:w-80">
        <input
          v-model="searchQuery"
          type="text"
          placeholder="주문번호, 수령인, 연락처 검색..."
          class="w-full pl-9 pr-8 py-2 rounded-xl border border-slate-300 text-xs focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none"
        />
        <i class="fa-solid fa-magnifying-glass absolute left-3 top-2.5 text-slate-400 text-xs"></i>
        <button
          v-if="searchQuery"
          @click="searchQuery = ''"
          class="absolute right-2.5 top-2 text-slate-400 hover:text-slate-600 text-xs"
        >
          ✕
        </button>
      </div>
    </div>

    <!-- Loading State -->
    <div v-if="loading" class="p-16 text-center text-slate-400">
      <i class="fa-solid fa-spinner fa-spin text-3xl mb-3 text-indigo-500"></i>
      <p class="text-xs font-bold">주문 및 발송 대기 목록을 불러오는 중입니다...</p>
    </div>

    <!-- Empty State -->
    <div v-else-if="filteredShipments.length === 0" class="bg-white rounded-2xl p-12 text-center border border-slate-200">
      <i class="fa-solid fa-truck text-4xl text-slate-300 mb-2"></i>
      <h3 class="font-bold text-slate-700 text-sm">해당 조건의 발송 건이 없습니다.</h3>
      <p class="text-xs text-slate-400 mt-1">고객의 신규 주문이 체결되면 실시간으로 표시됩니다.</p>
    </div>

    <!-- Shipments Content -->
    <div v-else class="space-y-4">
      <!-- 1. Mobile Cards Layout (visible on screens < 768px) -->
      <div class="md:hidden space-y-4">
        <div
          v-for="s in filteredShipments"
          :key="'mob_' + s.id"
          class="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs space-y-3"
        >
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-2">
              <input
                v-if="s.status !== 'SHIPPED' && s.status !== 'DELIVERED'"
                type="checkbox"
                :value="s.id"
                v-model="selectedIds"
                class="w-4 h-4 rounded text-indigo-600 focus:ring-indigo-500 cursor-pointer"
              />
              <span class="font-mono font-bold text-xs text-slate-900">{{ s.sub_order_no || s.order_no }}</span>
            </div>
            <span
              class="px-2 py-0.5 rounded-full text-[10px] font-black uppercase"
              :class="s.status === 'SHIPPED' ? 'bg-sky-100 text-sky-800' : 'bg-amber-100 text-amber-800'"
            >
              {{ s.status === 'SHIPPED' ? '● 출고 완료' : '○ 출고 대기' }}
            </span>
          </div>

          <!-- Customer & Destination -->
          <div class="p-3 bg-slate-50 rounded-xl space-y-1 text-xs">
            <div class="flex items-center justify-between">
              <span class="font-bold text-slate-900">{{ s.recipient_name }} ({{ s.recipient_phone }})</span>
              <div class="flex items-center gap-1">
                <button
                  @click="copyAddress(s)"
                  class="px-2 py-0.5 bg-white border border-slate-300 rounded text-[10px] text-slate-600 hover:text-indigo-600"
                >
                  {{ copyToast === s.id ? '✓ 복사됨' : '주소 복사' }}
                </button>
                <button
                  @click="openPackingSlip(s)"
                  class="px-2 py-0.5 bg-white border border-slate-300 rounded text-[10px] text-slate-600 hover:text-indigo-600"
                >
                  주문서
                </button>
              </div>
            </div>
            <p class="text-slate-600 text-[11px]">
              [{{ s.shipping_postal_code || '00000' }}] {{ s.shipping_address_line1 }} {{ s.shipping_address_line2 || '' }}
            </p>
            <p v-if="s.shipping_memo" class="text-[10px] text-indigo-700 font-semibold">
              요청사항: {{ s.shipping_memo }}
            </p>
          </div>

          <!-- Items Ordered -->
          <div v-if="s.items && s.items.length > 0" class="text-[11px] text-slate-500 border-t border-slate-100 pt-2 space-y-1">
            <div v-for="it in s.items" :key="it.id" class="flex items-center justify-between">
              <span class="truncate font-medium text-slate-800">{{ it.product_title || it.sku_id }}</span>
              <span class="font-bold text-slate-900 shrink-0 ml-2">x {{ it.quantity }}개</span>
            </div>
          </div>

          <!-- Carrier & Tracking Controls -->
          <div class="flex flex-col gap-2 pt-2 border-t border-slate-100">
            <div class="flex gap-2">
              <select v-model="s.carrier_code" class="border border-slate-300 rounded-lg px-2.5 py-1.5 text-xs bg-white">
                <option v-for="c in carrierOptions" :key="c" :value="c">{{ c }}</option>
              </select>
              <input
                v-model="s.tracking_number"
                placeholder="운송장 번호 입력"
                class="flex-1 border border-slate-300 rounded-lg px-3 py-1.5 text-xs font-mono focus:ring-2 focus:ring-indigo-500 focus:outline-none"
              />
            </div>
            <button
              @click="saveTracking(s)"
              :disabled="isSaving === s.id || !s.tracking_number"
              class="w-full py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-bold text-xs shadow-xs transition disabled:opacity-50 cursor-pointer"
            >
              {{ isSaving === s.id ? '처리 중...' : '송장 저장 및 출고 확정' }}
            </button>
          </div>
        </div>
      </div>

      <!-- 2. Desktop Table Layout (visible on screens >= 768px) -->
      <div class="hidden md:block bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
        <table class="w-full text-left text-xs">
          <thead class="bg-slate-50 text-slate-500 uppercase font-bold border-b border-slate-200">
            <tr>
              <th class="py-3 px-3 w-10 text-center">
                <input
                  type="checkbox"
                  :checked="isAllSelected"
                  @change="toggleSelectAll"
                  class="w-4 h-4 rounded text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                />
              </th>
              <th class="py-3 px-3">주문/하위번호</th>
              <th class="py-3 px-3">수령인 / 연락처</th>
              <th class="py-3 px-3">배송지 주소</th>
              <th class="py-3 px-3">품목 정보</th>
              <th class="py-3 px-3">택배사</th>
              <th class="py-3 px-3">운송장 번호</th>
              <th class="py-3 px-3">상태</th>
              <th class="py-3 px-3 text-right">출고 등록</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-slate-100">
            <tr v-for="s in filteredShipments" :key="'desk_' + s.id" class="hover:bg-slate-50/80 transition">
              <td class="py-3 px-3 text-center">
                <input
                  v-if="s.status !== 'SHIPPED' && s.status !== 'DELIVERED'"
                  type="checkbox"
                  :value="s.id"
                  v-model="selectedIds"
                  class="w-4 h-4 rounded text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                />
              </td>
              <td class="py-3 px-3 font-mono font-bold text-slate-900 whitespace-nowrap">
                <div>{{ s.sub_order_no || s.order_no }}</div>
                <button
                  @click="openPackingSlip(s)"
                  class="text-[10px] text-indigo-600 hover:underline font-normal inline-flex items-center gap-1"
                >
                  <i class="fa-solid fa-print"></i>패킹슬립
                </button>
              </td>
              <td class="py-3 px-3 font-medium text-slate-800 whitespace-nowrap">
                <div>{{ s.recipient_name }}</div>
                <div class="text-[11px] text-slate-400 font-mono">{{ s.recipient_phone }}</div>
              </td>
              <td class="py-3 px-3 text-slate-600 max-w-xs">
                <div class="flex items-center gap-1.5">
                  <span class="truncate">[{{ s.shipping_postal_code || '00000' }}] {{ s.shipping_address_line1 }} {{ s.shipping_address_line2 || '' }}</span>
                  <button
                    @click="copyAddress(s)"
                    title="주소 복사"
                    class="shrink-0 text-slate-400 hover:text-indigo-600 text-[11px]"
                  >
                    <i :class="copyToast === s.id ? 'fa-solid fa-check text-emerald-600' : 'fa-regular fa-copy'"></i>
                  </button>
                </div>
                <div v-if="s.shipping_memo" class="text-[10px] text-indigo-600 truncate mt-0.5">
                  메모: {{ s.shipping_memo }}
                </div>
              </td>
              <td class="py-3 px-3 text-slate-600 max-w-[200px]">
                <div v-if="s.items && s.items.length > 0" class="truncate text-[11px]">
                  <span class="font-medium text-slate-900">{{ s.items[0].product_title || s.items[0].sku_id }}</span>
                  <span v-if="s.items.length > 1" class="text-slate-400 font-bold ml-1">외 {{ s.items.length - 1 }}건</span>
                </div>
                <div v-else class="text-[11px] text-slate-400">-</div>
              </td>
              <td class="py-3 px-3">
                <select v-model="s.carrier_code" class="border border-slate-300 rounded px-2 py-1 text-xs bg-white">
                  <option v-for="c in carrierOptions" :key="c" :value="c">{{ c }}</option>
                </select>
              </td>
              <td class="py-3 px-3">
                <input
                  v-model="s.tracking_number"
                  placeholder="송장번호 입력"
                  class="border border-slate-300 rounded px-2.5 py-1 text-xs font-mono w-36 focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                />
              </td>
              <td class="py-3 px-3">
                <span
                  class="px-2 py-0.5 rounded-full text-[10px] font-semibold whitespace-nowrap"
                  :class="s.status === 'SHIPPED' ? 'bg-sky-100 text-sky-700' : 'bg-amber-100 text-amber-700'"
                >
                  {{ s.status === 'SHIPPED' ? '출고완료' : '결제확인' }}
                </span>
              </td>
              <td class="py-3 px-3 text-right">
                <button
                  @click="saveTracking(s)"
                  :disabled="isSaving === s.id || !s.tracking_number"
                  class="px-3.5 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-bold text-[11px] shadow-xs transition disabled:opacity-50 cursor-pointer whitespace-nowrap"
                >
                  {{ isSaving === s.id ? '처리중' : '출고 확정' }}
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- Bulk Shipment Modal -->
    <div
      v-if="showBulkModal"
      class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-fade-in"
    >
      <div class="bg-white rounded-3xl max-w-lg w-full p-6 space-y-4 shadow-2xl border border-slate-100">
        <div class="flex items-center justify-between border-b border-slate-100 pb-3">
          <div class="flex items-center gap-2 text-indigo-900 font-black text-lg">
            <i class="fa-solid fa-truck-ramp-box"></i>
            <h3>선택 {{ selectedIds.length }}건 일괄 출고 등록</h3>
          </div>
          <button @click="showBulkModal = false" class="text-slate-400 hover:text-slate-600 p-1">✕</button>
        </div>

        <div class="space-y-3 text-xs">
          <div>
            <label class="block font-bold text-slate-700 mb-1">택배사 선택</label>
            <select v-model="bulkCarrier" class="w-full border border-slate-300 rounded-xl px-3 py-2 text-xs bg-white">
              <option v-for="c in carrierOptions" :key="c" :value="c">{{ c }}</option>
            </select>
          </div>

          <div>
            <label class="block font-bold text-slate-700 mb-1">
              운송장 번호 입력 (한 줄에 하나씩 또는 비워두면 자동 발번)
            </label>
            <textarea
              v-model="bulkTrackingInput"
              rows="5"
              placeholder="68492019342&#10;68492019343&#10;..."
              class="w-full border border-slate-300 rounded-xl p-3 text-xs font-mono focus:ring-2 focus:ring-indigo-500 outline-none"
            ></textarea>
            <p class="text-[11px] text-slate-400 mt-1">
              * 입력하지 않은 주문은 시스템 일련번호로 자동 출고 등록됩니다.
            </p>
          </div>
        </div>

        <div class="flex items-center gap-2 pt-2 border-t border-slate-100">
          <button
            @click="showBulkModal = false"
            class="flex-1 py-2.5 rounded-xl border border-slate-300 text-slate-700 font-bold text-xs hover:bg-slate-50 cursor-pointer"
          >
            취소
          </button>
          <button
            @click="executeBulkShipment"
            :disabled="isBulkSaving"
            class="flex-1 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs shadow-md disabled:opacity-50 cursor-pointer"
          >
            {{ isBulkSaving ? '출고 처리 중...' : '일괄 출고 확정' }}
          </button>
        </div>
      </div>
    </div>

    <!-- Packing Slip / Print Modal -->
    <div
      v-if="showPackingSlipModal && packingSlipOrder"
      class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-fade-in"
    >
      <div class="bg-white rounded-3xl max-w-xl w-full p-6 space-y-4 shadow-2xl border border-slate-100 max-h-[90vh] overflow-y-auto">
        <div class="flex items-center justify-between border-b border-slate-100 pb-3">
          <div class="flex items-center gap-2 text-slate-900 font-black text-lg">
            <i class="fa-solid fa-receipt text-indigo-600"></i>
            <h3>배송 패킹 슬립 (주문서)</h3>
          </div>
          <button @click="showPackingSlipModal = false" class="text-slate-400 hover:text-slate-600 p-1">✕</button>
        </div>

        <div id="printable-slip" class="space-y-4 p-4 border border-slate-200 rounded-2xl text-xs bg-slate-50/50">
          <div class="flex justify-between items-start border-b border-slate-200 pb-3">
            <div>
              <h2 class="text-base font-black text-slate-900">OLMOA 물류 출하 주문서</h2>
              <p class="font-mono text-slate-500 text-[11px]">Sub-Order: {{ packingSlipOrder.sub_order_no || packingSlipOrder.id }}</p>
            </div>
            <div class="text-right font-mono text-[11px] text-slate-500">
              인쇄일시: {{ new Date().toLocaleString() }}
            </div>
          </div>

          <div class="grid grid-cols-2 gap-4 bg-white p-3 rounded-xl border border-slate-200">
            <div>
              <p class="font-bold text-slate-500 text-[10px] uppercase">수령인 정보</p>
              <p class="font-bold text-slate-900 text-sm mt-0.5">{{ packingSlipOrder.recipient_name }}</p>
              <p class="font-mono text-slate-600">{{ packingSlipOrder.recipient_phone }}</p>
            </div>
            <div>
              <p class="font-bold text-slate-500 text-[10px] uppercase">배송지 주소</p>
              <p class="text-slate-800 mt-0.5">
                [{{ packingSlipOrder.shipping_postal_code || '00000' }}] {{ packingSlipOrder.shipping_address_line1 }} {{ packingSlipOrder.shipping_address_line2 || '' }}
              </p>
              <p v-if="packingSlipOrder.shipping_memo" class="text-indigo-600 font-semibold mt-1">
                요청사항: {{ packingSlipOrder.shipping_memo }}
              </p>
            </div>
          </div>

          <div>
            <p class="font-bold text-slate-700 mb-1.5">출하 품목 목록</p>
            <table class="w-full border-collapse bg-white rounded-xl border border-slate-200 overflow-hidden">
              <thead class="bg-slate-100 text-slate-600 text-[10px] uppercase">
                <tr>
                  <th class="p-2 text-left">품목명 / SKU</th>
                  <th class="p-2 text-center w-16">수량</th>
                  <th class="p-2 text-right w-24">단가</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-slate-100">
                <tr v-for="it in (packingSlipOrder.items || [])" :key="it.id">
                  <td class="p-2 font-medium text-slate-800">{{ it.product_title || it.sku_id }}</td>
                  <td class="p-2 text-center font-bold text-slate-900">{{ it.quantity }}개</td>
                  <td class="p-2 text-right font-mono">₩{{ Number(it.unit_price).toLocaleString() }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <div class="flex items-center gap-2 pt-2 border-t border-slate-100">
          <button
            @click="showPackingSlipModal = false"
            class="flex-1 py-2.5 rounded-xl border border-slate-300 text-slate-700 font-bold text-xs hover:bg-slate-50 cursor-pointer"
          >
            닫기
          </button>
          <button
            @click="printPackingSlip"
            class="flex-1 py-2.5 rounded-xl bg-slate-900 hover:bg-indigo-600 text-white font-bold text-xs shadow-md cursor-pointer flex items-center justify-center gap-1.5"
          >
            <i class="fa-solid fa-print"></i>
            <span>인쇄하기 (Print)</span>
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
