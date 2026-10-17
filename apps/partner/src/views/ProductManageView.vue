<script setup lang="ts">
import { ref, onMounted } from 'vue';

interface PartnerProduct {
  id: string;
  title: string;
  sku_code: string;
  lowest_sale_price: number;
  stock_quantity: number;
  status: string;
  category_name?: string;
}

const products = ref<PartnerProduct[]>([]);
const loading = ref(true);
const editingStockId = ref<string | null>(null);
const tempStock = ref(0);
const isSaving = ref(false);

async function loadProducts() {
  loading.value = true;
  try {
    const res = await fetch('https://olmoa-api.dnjstjqppk.workers.dev/api/v1/partner/products', {
      headers: { 'X-Partner-Id': 'pt_001' }
    });
    const json = await res.json();
    if (json.success && json.data) {
      products.value = json.data;
    }
  } catch (_) {
  } finally {
    loading.value = false;
  }
}

function editStock(product: PartnerProduct) {
  editingStockId.value = product.id;
  tempStock.value = product.stock_quantity;
}

async function saveStock(product: PartnerProduct) {
  isSaving.value = true;
  try {
    const res = await fetch(`https://olmoa-api.dnjstjqppk.workers.dev/api/v1/partner/products/${product.id}/stock`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'X-Partner-Id': 'pt_001' },
      body: JSON.stringify({ stock_quantity: tempStock.value })
    });
    if (res.ok) {
      product.stock_quantity = tempStock.value;
      editingStockId.value = null;
    }
  } catch (_) {
  } finally {
    isSaving.value = false;
  }
}

onMounted(() => {
  loadProducts();
});
</script>

<template>
  <div class="space-y-6">
    <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
      <div>
        <h1 class="text-2xl font-bold text-slate-900">등록 상품 및 SKU 재고 관리</h1>
        <p class="text-xs text-slate-500 mt-1">Cloudflare D1에 영구 저장된 입점사 실시간 상품과 SKU 재고를 조회 및 변경합니다.</p>
      </div>
      <router-link to="/bulk-upload" class="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-semibold shadow-sm transition">
        <i class="fa-solid fa-plus mr-1.5"></i>신규 상품 등록
      </router-link>
    </div>

    <div v-if="loading" class="p-16 text-center text-slate-400">
      <i class="fa-solid fa-spinner fa-spin text-3xl mb-3 text-indigo-500"></i>
      <p class="text-xs font-bold">D1에서 상품 목록을 불러오는 중입니다...</p>
    </div>

    <div v-else class="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
      <div class="overflow-x-auto">
        <table class="w-full text-left text-xs">
          <thead class="bg-slate-50 text-slate-500 uppercase font-semibold">
            <tr>
              <th class="py-3 px-4">상품명</th>
              <th class="py-3 px-4">카테고리</th>
              <th class="py-3 px-4">대표 SKU 코드</th>
              <th class="py-3 px-4">판매가</th>
              <th class="py-3 px-4">가용 재고</th>
              <th class="py-3 px-4">상태</th>
              <th class="py-3 px-4 text-right">재고 변경</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-slate-100">
            <tr v-for="p in products" :key="p.id" class="hover:bg-slate-50 transition">
              <td class="py-3.5 px-4 font-medium text-slate-900 max-w-xs truncate">{{ p.title }}</td>
              <td class="py-3.5 px-4 text-slate-500">{{ p.category_name || '일반' }}</td>
              <td class="py-3.5 px-4 font-mono text-slate-600">{{ p.sku_code || ('SKU-' + p.id) }}</td>
              <td class="py-3.5 px-4 font-bold text-slate-900">₩{{ p.lowest_sale_price.toLocaleString() }}</td>
              <td class="py-3.5 px-4">
                <span v-if="editingStockId !== p.id" class="font-semibold" :class="p.stock_quantity > 20 ? 'text-emerald-600' : 'text-rose-600'">
                  {{ p.stock_quantity }}개
                </span>
                <input 
                  v-else 
                  v-model.number="tempStock" 
                  type="number" 
                  class="w-20 px-2 py-1 border border-indigo-400 rounded text-xs font-mono"
                />
              </td>
              <td class="py-3.5 px-4">
                <span class="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-100 text-emerald-700">
                  {{ p.status }}
                </span>
              </td>
              <td class="py-3.5 px-4 text-right">
                <button 
                  v-if="editingStockId !== p.id" 
                  @click="editStock(p)" 
                  class="px-2.5 py-1 text-indigo-600 hover:bg-indigo-50 rounded border border-indigo-200 text-[11px] font-semibold"
                >
                  재고 수정
                </button>
                <div v-else class="flex gap-1 justify-end">
                  <button @click="saveStock(p)" :disabled="isSaving" class="px-2 py-1 bg-indigo-600 text-white rounded text-[11px] font-semibold">
                    {{ isSaving ? '저장중' : '저장' }}
                  </button>
                  <button @click="editingStockId = null" class="px-2 py-1 bg-slate-200 text-slate-600 rounded text-[11px]">취소</button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</template>
