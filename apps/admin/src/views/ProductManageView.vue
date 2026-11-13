<script setup lang="ts">
import { LoaderCircle, RotateCw } from 'lucide-vue-next'
import { ref, onMounted } from 'vue';
import { API_BASE_URL, getAdminHeaders } from '../config';
import { useConfirm, useToast } from '@olmoa/ui'

const { confirm } = useConfirm()
const toastApi = useToast()

interface AdminProduct {
  id: string;
  title: string;
  business_name: string;
  category_name: string;
  lowest_sale_price: number;
  total_sold_count: number;
  status: 'ACTIVE' | 'HIDDEN' | 'DELETED';
  sku_count: number;
  total_stock: number;
  review_status?: string;
  created_at: string;
}

const products = ref<AdminProduct[]>([]);
const loading = ref(true);
const updatingId = ref<string | null>(null);
const toastMsg = ref('');

function toast(msg: string, ms = 4000) {
  toastMsg.value = msg;
  setTimeout(() => { toastMsg.value = ''; }, ms);
}

async function loadProducts() {
  loading.value = true;
  try {
    const res = await fetch(`${API_BASE_URL}/api/v1/admin/products`, {
      headers: getAdminHeaders()
    });
    const json = await res.json();
    if (json.success && Array.isArray(json.data)) {
      products.value = json.data;
    }
  } catch (_) {
  } finally {
    loading.value = false;
  }
}

async function updateStatus(p: AdminProduct, newStatus: 'ACTIVE' | 'HIDDEN') {
  const label = newStatus === 'ACTIVE' ? '판매 재개(노출)' : '판매 중지(노출 중단)';
  if (!(await confirm({ title: '상품 상태 변경', body: `[${p.title}] 상품을 ${label} 처리합니다.`, danger: newStatus === 'HIDDEN' }))) return;
  updatingId.value = p.id;
  try {
    const res = await fetch(`${API_BASE_URL}/api/v1/admin/products/${p.id}/status`, {
      method: 'PUT',
      headers: getAdminHeaders(),
      body: JSON.stringify({ status: newStatus })
    });
    if (res.ok) {
      p.status = newStatus;
      toast(`✓ [${p.title}] ${label} 처리되었습니다.`, 3000);
    } else {
      const errJson = await res.json().catch(() => ({}));
      toast(`⚠ 상태 변경에 실패했습니다 (${errJson.error || `HTTP ${res.status}`}). 다시 시도해 주세요.`);
    }
  } catch (_) {
    toast('⚠ 요청 중 네트워크 오류가 발생했습니다. 다시 시도해 주세요.');
  } finally {
    updatingId.value = null;
  }
}

async function reviewProduct(p: any, decision: 'APPROVE' | 'REJECT') {
  const note = decision === 'REJECT' ? (prompt('반려 사유') || '') : ''
  if (decision === 'REJECT' && !note) return
  updatingId.value = p.id
  try {
    const res = await fetch(`${API_BASE_URL}/api/v1/admin/products/${p.id}/review`, { method: 'POST', headers: getAdminHeaders(), body: JSON.stringify({ decision, note }) })
    const json = await res.json()
    if (json.success) { p.review_status = json.review_status; p.status = json.status }
    else toastApi.error(json.error || '처리 실패')
  } finally {
    updatingId.value = null
  }
}

onMounted(() => {
  loadProducts();
});
</script>

<template>
  <div class="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-4">
    <div class="flex items-center justify-between border-b pb-3">
      <div>
        <h2 class="text-base font-bold text-slate-900">전체 플랫폼 상품 및 SKU 상태 관리</h2>
        <p class="text-xs text-slate-500 mt-0.5">입점사 등록 상품 승인, 노출 상태 변경 및 실시간 가용 재고 모니터링</p>
      </div>
      <button @click="loadProducts" class="text-xs text-indigo-600 font-bold hover:underline">
        <RotateCw class="h-4 w-4 mr-1" aria-hidden="true" />새로고침
      </button>
    </div>

    <div v-if="toastMsg" class="p-3 rounded-xl bg-slate-900 text-white text-xs font-bold">
      {{ toastMsg }}
    </div>

    <div v-if="loading" class="p-12 text-center text-slate-400 text-xs">
      <LoaderCircle class="h-4 w-4 animate-spin mr-2" aria-hidden="true" />상품 목록을 불러오는 중...
    </div>

    <div v-else-if="products.length === 0" class="p-12 text-center text-slate-400 text-xs">
      등록된 상품이 없습니다.
    </div>

    <div v-else class="overflow-x-auto">
      <table class="w-full text-left text-xs border-collapse">
        <thead>
          <tr class="bg-slate-50 border-b text-slate-600 font-bold">
            <th class="p-3">상품명</th>
            <th class="p-3">판매 파트너</th>
            <th class="p-3">카테고리</th>
            <th class="p-3 text-right">판매가</th>
            <th class="p-3 text-center">SKU 수</th>
            <th class="p-3 text-center">총 재고</th>
            <th class="p-3 text-center">상태</th>
            <th class="p-3 text-center">관리 액션</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-slate-100">
          <tr v-for="p in products" :key="p.id" class="hover:bg-slate-50/60 transition">
            <td class="p-3 font-medium text-slate-900 max-w-xs truncate">{{ p.title }}</td>
            <td class="p-3 text-slate-600">{{ p.business_name || '-' }}</td>
            <td class="p-3 text-slate-500">{{ p.category_name || '미분류' }}</td>
            <td class="p-3 text-right font-mono font-bold text-slate-800">₩{{ p.lowest_sale_price.toLocaleString() }}</td>
            <td class="p-3 text-center font-mono">{{ p.sku_count || 1 }}개</td>
            <td class="p-3 text-center font-mono font-semibold" :class="p.total_stock <= 0 ? 'text-rose-600' : 'text-slate-700'">
              {{ p.total_stock !== null ? p.total_stock : 0 }}개
            </td>
            <td class="p-3 text-center">
              <span v-if="p.review_status === 'PENDING'" class="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-800">심사 대기</span>
              <span v-else-if="p.review_status === 'REJECTED'" class="px-2 py-0.5 rounded text-[10px] font-bold bg-red-100 text-red-700">반려</span>
              <span v-else class="px-2 py-0.5 rounded text-[10px] font-bold" :class="p.status === 'ACTIVE' ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-200 text-slate-700'">{{ p.status === 'ACTIVE' ? '판매중' : '판매 중지' }}</span>
            </td>
            <td class="p-3 text-center space-x-1.5">
              <template v-if="p.review_status === 'PENDING'">
                <button :disabled="updatingId === p.id" @click="reviewProduct(p, 'APPROVE')" class="px-2.5 py-1 bg-emerald-600 text-white rounded font-bold text-[11px] disabled:opacity-50">심사 승인</button>
                <button :disabled="updatingId === p.id" @click="reviewProduct(p, 'REJECT')" class="px-2.5 py-1 bg-slate-200 text-slate-800 rounded font-bold text-[11px] disabled:opacity-50">반려</button>
              </template>
              <button v-else-if="p.review_status === 'APPROVED' && p.status !== 'ACTIVE'" :disabled="updatingId === p.id" @click="updateStatus(p, 'ACTIVE')" class="px-2.5 py-1 bg-emerald-600 text-white rounded font-bold text-[11px] disabled:opacity-50">판매 재개</button>
              <button v-else-if="p.status === 'ACTIVE'" :disabled="updatingId === p.id" @click="updateStatus(p, 'HIDDEN')" class="px-2.5 py-1 bg-rose-600 text-white rounded font-bold text-[11px] disabled:opacity-50">판매 중지</button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
