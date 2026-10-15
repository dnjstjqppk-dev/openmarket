<script setup lang="ts">
import { ref } from 'vue';

interface PartnerProduct {
  id: string;
  title: string;
  sku: string;
  price: number;
  stock: number;
  status: string;
}

const products = ref<PartnerProduct[]>([
  { id: 'prod_001', title: '초경량 액티브 노이즈캔슬링 무선 이어폰 Pro 3', sku: 'EAR-PRO3-WHT', price: 49900, stock: 500, status: '판매중' },
  { id: 'prod_002', title: '울트라 슬림 65W GaN 고속 충전기 3포트', sku: 'GAN-65W-BLK', price: 24500, stock: 1200, status: '판매중' },
  { id: 'prod_003', title: '스마트 타이머 진공 밀폐 보관용기 4종 세트', sku: 'VAC-CAN-4SET', price: 19900, stock: 450, status: '판매중' },
  { id: 'prod_004', title: '데일리 오버핏 소프트 기모 후드티 (Grey)', sku: 'HOOD-GRY-L', price: 28900, stock: 350, status: '판매중' }
]);

const editingStockId = ref<string | null>(null);
const tempStock = ref(0);

function editStock(product: PartnerProduct) {
  editingStockId.value = product.id;
  tempStock.value = product.stock;
}

function saveStock(product: PartnerProduct) {
  product.stock = tempStock.value;
  editingStockId.value = null;
}
</script>

<template>
  <div class="space-y-6">
    <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
      <div>
        <h1 class="text-2xl font-bold text-slate-900">등록 상품 및 SKU 재고 관리</h1>
        <p class="text-xs text-slate-500 mt-1">실시간 가격 수정 및 안전 재고를 변경할 수 있습니다.</p>
      </div>
      <router-link to="/bulk-upload" class="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-semibold shadow-sm transition">
        <i class="fa-solid fa-plus mr-1.5"></i>신규 상품 등록
      </router-link>
    </div>

    <div class="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
      <div class="overflow-x-auto">
        <table class="w-full text-left text-xs">
          <thead class="bg-slate-50 text-slate-500 uppercase font-semibold">
            <tr>
              <th class="py-3 px-4">상품명</th>
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
              <td class="py-3.5 px-4 font-mono text-slate-600">{{ p.sku }}</td>
              <td class="py-3.5 px-4 font-bold text-slate-900">₩{{ p.price.toLocaleString() }}</td>
              <td class="py-3.5 px-4">
                <span v-if="editingStockId !== p.id" class="font-semibold" :class="p.stock > 50 ? 'text-emerald-600' : 'text-rose-600'">
                  {{ p.stock }}개
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
                  <button @click="saveStock(p)" class="px-2 py-1 bg-indigo-600 text-white rounded text-[11px] font-semibold">저장</button>
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

