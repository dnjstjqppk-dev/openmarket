<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { API_BASE_URL, getAdminHeaders } from '../config';

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
  created_at: string;
}

const products = ref<AdminProduct[]>([]);
const loading = ref(true);
const updatingId = ref<string | null>(null);

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
  updatingId.value = p.id;
  try {
    const res = await fetch(`${API_BASE_URL}/api/v1/admin/products/${p.id}/status`, {
      method: 'PUT',
      headers: getAdminHeaders(),
      body: JSON.stringify({ status: newStatus })
    });
    if (res.ok) {
      p.status = newStatus;
    }
  } catch (_) {
  } finally {
    updatingId.value = null;
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
        <i class="fa-solid fa-arrows-rotate mr-1"></i>새로고침
      </button>
    </div>

    <div v-if="loading" class="p-12 text-center text-slate-400 text-xs">
      <i class="fa-solid fa-spinner fa-spin mr-2"></i>상품 목록을 불러오는 중...
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
            <td class="p-3 text-slate-600">{{ p.business_name || '직영점' }}</td>
            <td class="p-3 text-slate-500">{{ p.category_name || '미분류' }}</td>
            <td class="p-3 text-right font-mono font-bold text-slate-800">₩{{ p.lowest_sale_price.toLocaleString() }}</td>
            <td class="p-3 text-center font-mono">{{ p.sku_count || 1 }}개</td>
            <td class="p-3 text-center font-mono font-semibold" :class="p.total_stock <= 0 ? 'text-rose-600' : 'text-slate-700'">
              {{ p.total_stock !== null ? p.total_stock : 0 }}개
            </td>
            <td class="p-3 text-center">
              <span 
                class="px-2 py-0.5 rounded text-[10px] font-bold"
                :class="p.status === 'ACTIVE' ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-200 text-slate-700'"
              >
                {{ p.status === 'ACTIVE' ? '정상 판매중' : '판매 중지' }}
              </span>
            </td>
            <td class="p-3 text-center space-x-1.5">
              <button 
                v-if="p.status !== 'ACTIVE'"
                :disabled="updatingId === p.id"
                @click="updateStatus(p, 'ACTIVE')"
                class="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded font-bold text-[11px] transition disabled:opacity-50"
              >
                판매 승인
              </button>
              <button 
                v-else
                :disabled="updatingId === p.id"
                @click="updateStatus(p, 'HIDDEN')"
                class="px-2.5 py-1 bg-rose-600 hover:bg-rose-700 text-white rounded font-bold text-[11px] transition disabled:opacity-50"
              >
                판매 중지
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
