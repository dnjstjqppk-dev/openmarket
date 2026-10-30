<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { API_BASE, getPartnerHeaders } from '../config';

interface ReturnItem {
  id: string;
  order_id: string;
  user_id: string;
  claim_type: 'RETURN' | 'EXCHANGE' | 'PRICE_ADJUSTMENT';
  reason: string;
  status: 'REQUESTED' | 'APPROVED' | 'REJECTED' | 'REFUNDED';
  refund_amount: number;
  notes?: string;
  created_at: string;
  order_no?: string;
  sub_order_id?: string;
  sub_order_no?: string;
  goods_amount?: number;
  shipping_fee?: number;
  total_amount?: number;
  customer_email?: string;
  customer_name?: string;
}

const returns = ref<ReturnItem[]>([]);
const loading = ref(true);
const selectedTab = ref<'ALL' | 'REQUESTED' | 'APPROVED' | 'REFUNDED' | 'REJECTED'>('ALL');
const searchQuery = ref('');
const toast = ref('');

// Action Modal
const activeModal = ref(false);
const targetItem = ref<ReturnItem | null>(null);
const targetStatus = ref<'APPROVED' | 'REFUNDED' | 'REJECTED'>('APPROVED');
const sellerNote = ref('');
const processing = ref(false);

const loadReturns = async () => {
  loading.value = true;
  try {
    const res = await fetch(`${API_BASE}/api/v1/partner/returns`, {
      headers: getPartnerHeaders()
    });
    const json = await res.json();
    if (json.success && Array.isArray(json.data)) {
      returns.value = json.data;
    }
  } catch (e) {
    console.error('Failed to load partner returns:', e);
  } finally {
    loading.value = false;
  }
};

const counts = computed(() => {
  const all = returns.value.length;
  const requested = returns.value.filter(r => r.status === 'REQUESTED').length;
  const approved = returns.value.filter(r => r.status === 'APPROVED').length;
  const refunded = returns.value.filter(r => r.status === 'REFUNDED').length;
  const rejected = returns.value.filter(r => r.status === 'REJECTED').length;
  return { all, requested, approved, refunded, rejected };
});

const filteredReturns = computed(() => {
  return returns.value.filter(r => {
    if (selectedTab.value !== 'ALL' && r.status !== selectedTab.value) return false;
    if (searchQuery.value.trim()) {
      const q = searchQuery.value.toLowerCase();
      const matchNo = (r.order_no || '').toLowerCase().includes(q) || (r.sub_order_no || '').toLowerCase().includes(q);
      const matchCustomer = (r.customer_name || '').toLowerCase().includes(q) || (r.customer_email || '').toLowerCase().includes(q);
      const matchReason = (r.reason || '').toLowerCase().includes(q);
      return matchNo || matchCustomer || matchReason;
    }
    return true;
  });
});

const openStatusModal = (item: ReturnItem, status: 'APPROVED' | 'REFUNDED' | 'REJECTED') => {
  targetItem.value = item;
  targetStatus.value = status;
  sellerNote.value = item.notes || '';
  activeModal.value = true;
};

const confirmStatusUpdate = async () => {
  if (!targetItem.value) return;
  processing.value = true;
  try {
    const res = await fetch(`${API_BASE}/api/v1/partner/returns/${targetItem.value.id}/status`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        ...getPartnerHeaders()
      },
      body: JSON.stringify({
        status: targetStatus.value,
        notes: sellerNote.value.trim()
      })
    });
    const json = await res.json();
    if (json.success) {
      toast.value = `✓ 클레임(${targetItem.value.id})이 '${targetStatus.value}' 상태로 갱신되었습니다.`;
      setTimeout(() => { toast.value = ''; }, 3000);
      activeModal.value = false;
      await loadReturns();
    } else {
      alert(json.error || '상태 변경 중 오류가 발생했습니다.');
    }
  } catch (e: any) {
    alert(e.message || '네트워크 통신 오류');
  } finally {
    processing.value = false;
  }
};

const formatPrice = (val?: number) => {
  return (val || 0).toLocaleString('ko-KR') + '원';
};

const formatDate = (dateStr: string) => {
  if (!dateStr) return '-';
  const d = new Date(dateStr);
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

onMounted(() => {
  loadReturns();
});
</script>

<template>
  <div class="space-y-6">
    <!-- Header Banner -->
    <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
      <div>
        <h1 class="text-xl sm:text-2xl font-black text-gray-900 tracking-tight flex items-center gap-2">
          <span>🔄 반품·교환 및 분쟁 클레임 관리</span>
          <span class="text-xs px-2.5 py-0.5 rounded-full bg-orange-100 text-[#FF5000] font-black">
            {{ counts.all }}건
          </span>
        </h1>
        <p class="text-xs text-gray-500 mt-1">
          고객이 접수한 90일 무료 반품, 교환 및 보상 클레임을 신속하게 검토하고 에스크로 환불을 승인합니다.
        </p>
      </div>

      <!-- Action Toast -->
      <div v-if="toast" class="px-4 py-2 rounded-xl bg-emerald-600 text-white text-xs font-bold shadow-md animate-fade-in">
        {{ toast }}
      </div>
    </div>

    <!-- Quick Stats Cards -->
    <div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
      <div
        @click="selectedTab = 'REQUESTED'"
        class="bg-white p-4 rounded-2xl border border-gray-200/80 shadow-xs cursor-pointer hover:border-amber-400 transition"
        :class="{ 'ring-2 ring-amber-500 bg-amber-50/40': selectedTab === 'REQUESTED' }"
      >
        <span class="text-xs font-bold text-gray-500">접수 대기 (신속 검토)</span>
        <div class="text-2xl font-black text-amber-600 mt-1">{{ counts.requested }}건</div>
      </div>
      <div
        @click="selectedTab = 'APPROVED'"
        class="bg-white p-4 rounded-2xl border border-gray-200/80 shadow-xs cursor-pointer hover:border-blue-400 transition"
        :class="{ 'ring-2 ring-blue-500 bg-blue-50/40': selectedTab === 'APPROVED' }"
      >
        <span class="text-xs font-bold text-gray-500">반품 승인 (회수 중)</span>
        <div class="text-2xl font-black text-blue-600 mt-1">{{ counts.approved }}건</div>
      </div>
      <div
        @click="selectedTab = 'REFUNDED'"
        class="bg-white p-4 rounded-2xl border border-gray-200/80 shadow-xs cursor-pointer hover:border-emerald-400 transition"
        :class="{ 'ring-2 ring-emerald-500 bg-emerald-50/40': selectedTab === 'REFUNDED' }"
      >
        <span class="text-xs font-bold text-gray-500">환불 완료</span>
        <div class="text-2xl font-black text-emerald-600 mt-1">{{ counts.refunded }}건</div>
      </div>
      <div
        @click="selectedTab = 'REJECTED'"
        class="bg-white p-4 rounded-2xl border border-gray-200/80 shadow-xs cursor-pointer hover:border-rose-400 transition"
        :class="{ 'ring-2 ring-rose-500 bg-rose-50/40': selectedTab === 'REJECTED' }"
      >
        <span class="text-xs font-bold text-gray-500">반려 / 철회</span>
        <div class="text-2xl font-black text-rose-600 mt-1">{{ counts.rejected }}건</div>
      </div>
    </div>

    <!-- Filter & Search Bar -->
    <div class="bg-white p-4 rounded-2xl border border-gray-200/80 shadow-xs flex flex-col md:flex-row items-center justify-between gap-4">
      <div class="flex items-center gap-1.5 overflow-x-auto w-full md:w-auto">
        <button
          @click="selectedTab = 'ALL'"
          class="px-3.5 py-1.5 rounded-xl text-xs font-bold transition whitespace-nowrap"
          :class="selectedTab === 'ALL' ? 'bg-slate-900 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'"
        >
          전체 ({{ counts.all }})
        </button>
        <button
          @click="selectedTab = 'REQUESTED'"
          class="px-3.5 py-1.5 rounded-xl text-xs font-bold transition whitespace-nowrap"
          :class="selectedTab === 'REQUESTED' ? 'bg-amber-500 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'"
        >
          접수대기 ({{ counts.requested }})
        </button>
        <button
          @click="selectedTab = 'APPROVED'"
          class="px-3.5 py-1.5 rounded-xl text-xs font-bold transition whitespace-nowrap"
          :class="selectedTab === 'APPROVED' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'"
        >
          승인 ({{ counts.approved }})
        </button>
        <button
          @click="selectedTab = 'REFUNDED'"
          class="px-3.5 py-1.5 rounded-xl text-xs font-bold transition whitespace-nowrap"
          :class="selectedTab === 'REFUNDED' ? 'bg-emerald-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'"
        >
          환불완료 ({{ counts.refunded }})
        </button>
        <button
          @click="selectedTab = 'REJECTED'"
          class="px-3.5 py-1.5 rounded-xl text-xs font-bold transition whitespace-nowrap"
          :class="selectedTab === 'REJECTED' ? 'bg-rose-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'"
        >
          반려 ({{ counts.rejected }})
        </button>
      </div>

      <div class="relative w-full md:w-72">
        <input
          v-model="searchQuery"
          type="text"
          placeholder="주문번호, 고객명, 사유 검색..."
          class="w-full h-9 pl-8 pr-3 rounded-xl border border-gray-300 text-xs focus:outline-none focus:border-slate-800"
        />
        <svg class="w-4 h-4 text-gray-400 absolute left-2.5 top-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/></svg>
      </div>
    </div>

    <!-- Table of Returns -->
    <div class="bg-white rounded-2xl border border-gray-200/80 shadow-xs overflow-hidden">
      <div v-if="loading" class="p-12 text-center text-xs text-gray-500 font-bold">
        <div class="w-8 h-8 mx-auto mb-2 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin"></div>
        반품 및 클레임 내역을 불러오는 중...
      </div>

      <div v-else-if="filteredReturns.length === 0" class="p-12 text-center text-xs text-gray-500">
        <div class="text-3xl mb-2">📦</div>
        <p class="font-bold text-gray-700">해당 조건의 반품·클레임 내역이 없습니다.</p>
        <p class="text-[11px] text-gray-400 mt-1">고객 클레임이 발생하면 이곳에 실시간으로 집계됩니다.</p>
      </div>

      <div v-else class="overflow-x-auto">
        <table class="w-full text-left text-xs">
          <thead class="bg-gray-50/90 text-gray-600 font-bold uppercase text-[11px] border-b border-gray-200">
            <tr>
              <th class="py-3 px-4">클레임 번호 / 접수일</th>
              <th class="py-3 px-4">원 주문 / 하위번호</th>
              <th class="py-3 px-4">고객 정보</th>
              <th class="py-3 px-4">유형 / 사유</th>
              <th class="py-3 px-4">환불 금액</th>
              <th class="py-3 px-4">진행 상태</th>
              <th class="py-3 px-4 text-right">처리 관리</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-gray-100">
            <tr v-for="item in filteredReturns" :key="item.id" class="hover:bg-slate-50/60 transition">
              <td class="py-3.5 px-4">
                <span class="font-mono font-bold text-indigo-950 block">{{ item.id }}</span>
                <span class="text-[10px] text-gray-400 block mt-0.5">{{ formatDate(item.created_at) }}</span>
              </td>
              <td class="py-3.5 px-4">
                <span class="font-mono text-gray-800 block">{{ item.order_no || item.order_id }}</span>
                <span class="text-[10px] text-gray-500 font-mono block">{{ item.sub_order_no || item.sub_order_id }}</span>
              </td>
              <td class="py-3.5 px-4">
                <span class="font-bold text-gray-900 block">{{ item.customer_name || '고객' }}</span>
                <span class="text-[10px] text-gray-400 block">{{ item.customer_email || '-' }}</span>
              </td>
              <td class="py-3.5 px-4 max-w-xs">
                <span
                  class="inline-block px-2 py-0.5 rounded text-[10px] font-black uppercase mb-1"
                  :class="{
                    'bg-purple-100 text-purple-700': item.claim_type === 'RETURN',
                    'bg-blue-100 text-blue-700': item.claim_type === 'EXCHANGE',
                    'bg-amber-100 text-amber-700': item.claim_type === 'PRICE_ADJUSTMENT'
                  }"
                >
                  {{ item.claim_type === 'RETURN' ? '반품 환불' : item.claim_type === 'EXCHANGE' ? '교환 접수' : '차액 보상' }}
                </span>
                <p class="text-xs text-gray-700 truncate" :title="item.reason">{{ item.reason }}</p>
                <p v-if="item.notes" class="text-[10px] text-indigo-600 mt-0.5">메모: {{ item.notes }}</p>
              </td>
              <td class="py-3.5 px-4">
                <span class="font-black text-gray-900">{{ formatPrice(item.refund_amount || item.total_amount) }}</span>
              </td>
              <td class="py-3.5 px-4">
                <span
                  class="px-2.5 py-1 rounded-full text-[10px] font-black"
                  :class="{
                    'bg-amber-100 text-amber-800': item.status === 'REQUESTED',
                    'bg-blue-100 text-blue-800': item.status === 'APPROVED',
                    'bg-emerald-100 text-emerald-800': item.status === 'REFUNDED',
                    'bg-rose-100 text-rose-800': item.status === 'REJECTED'
                  }"
                >
                  {{ item.status }}
                </span>
              </td>
              <td class="py-3.5 px-4 text-right space-x-1.5 whitespace-nowrap">
                <button
                  v-if="item.status === 'REQUESTED'"
                  @click="openStatusModal(item, 'APPROVED')"
                  class="px-2.5 py-1 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-bold text-[11px] cursor-pointer"
                >
                  반품 승인
                </button>
                <button
                  v-if="item.status === 'REQUESTED' || item.status === 'APPROVED'"
                  @click="openStatusModal(item, 'REFUNDED')"
                  class="px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-[11px] cursor-pointer"
                >
                  환불 집행
                </button>
                <button
                  v-if="item.status === 'REQUESTED'"
                  @click="openStatusModal(item, 'REJECTED')"
                  class="px-2 py-1 rounded-lg bg-gray-200 hover:bg-rose-100 text-gray-700 hover:text-rose-700 font-bold text-[11px] cursor-pointer"
                >
                  반려
                </button>
                <span v-if="item.status === 'REFUNDED' || item.status === 'REJECTED'" class="text-[11px] text-gray-400 font-medium">
                  완료됨
                </span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- Status Change Modal -->
    <div v-if="activeModal && targetItem" class="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
      <div class="bg-white rounded-3xl max-w-md w-full p-6 shadow-2xl space-y-4">
        <div class="flex items-center justify-between border-b pb-3">
          <h3 class="font-black text-gray-900 text-base">
            클레임 상태 변경 ({{ targetStatus }})
          </h3>
          <button @click="activeModal = false" class="text-gray-400 hover:text-gray-600 text-lg">✕</button>
        </div>

        <div class="space-y-2 text-xs text-gray-600">
          <div><strong class="text-gray-800">클레임 ID:</strong> {{ targetItem.id }}</div>
          <div><strong class="text-gray-800">원 주문번호:</strong> {{ targetItem.order_no || targetItem.order_id }}</div>
          <div><strong class="text-gray-800">환불 금액:</strong> {{ formatPrice(targetItem.refund_amount || targetItem.total_amount) }}</div>
          <div><strong class="text-gray-800">사유:</strong> {{ targetItem.reason }}</div>
        </div>

        <div>
          <label class="block text-xs font-bold text-gray-700 mb-1">셀러 처리 메모 (선택/택배 수거 송장 등)</label>
          <textarea
            v-model="sellerNote"
            rows="3"
            placeholder="예: 고객님 제품 수거 완료 후 검품 정상 확인되어 전액 환불 승인 처리합니다."
            class="w-full p-3 rounded-xl border border-gray-300 text-xs focus:outline-none focus:border-indigo-600"
          ></textarea>
        </div>

        <div class="flex items-center justify-end gap-2 pt-2">
          <button
            @click="activeModal = false"
            class="px-4 py-2 rounded-xl bg-gray-100 hover:bg-gray-200 text-gray-700 font-bold text-xs"
          >
            취소
          </button>
          <button
            @click="confirmStatusUpdate"
            :disabled="processing"
            class="px-5 py-2 rounded-xl bg-[#FF5000] hover:bg-[#e04700] text-white font-black text-xs shadow-md disabled:opacity-50"
          >
            {{ processing ? '처리 중...' : '확인 및 적용' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

