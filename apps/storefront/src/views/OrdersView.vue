<script setup lang="ts">
import { ref } from 'vue';

interface OrderItem {
  id: string;
  date: string;
  product: string;
  total: number;
  status: string;
  tracking: string;
}

const orders = ref<OrderItem[]>([
  {
    id: 'OLM-2026-98124',
    date: '2026-10-15',
    product: '초경량 액티브 노이즈캔슬링 무선 이어폰 Pro 3 (White)',
    total: 49900,
    status: '배송중 (글로벌 물류센터 출고 완료)',
    tracking: 'CJ대한통운 6891024819'
  }
]);
</script>

<template>
  <div class="max-w-3xl mx-auto space-y-5">
    <div class="border-b border-slate-200 pb-3 flex items-center justify-between">
      <div>
        <h2 class="text-xl font-black text-slate-900">내 주문 및 글로벌 배송 조회</h2>
        <p class="text-xs text-slate-500 mt-0.5">올모아(OLMOA)에서 주문하신 모든 내역을 실시간으로 추적합니다.</p>
      </div>
      <router-link to="/" class="text-xs text-orange-600 font-bold hover:underline">
        쇼핑 계속하기 &rarr;
      </router-link>
    </div>
    
    <div v-for="ord in orders" :key="ord.id" class="bg-white rounded-3xl p-6 border border-slate-200 shadow-sm space-y-4 text-xs">
      <div class="flex justify-between font-mono text-slate-500 text-[11px] border-b border-slate-100 pb-3">
        <span>주문번호: <strong class="text-slate-800">{{ ord.id }}</strong></span>
        <span>주문일자: {{ ord.date }}</span>
      </div>
      <div class="flex items-start justify-between gap-4">
        <div>
          <span class="text-[10px] font-bold text-orange-600 uppercase">OLMOA 직구 특가</span>
          <div class="font-bold text-slate-900 text-sm mt-0.5">{{ ord.product }}</div>
        </div>
        <div class="text-right shrink-0">
          <div class="text-xs text-slate-400">결제 금액</div>
          <div class="text-base font-black text-orange-600">₩ {{ ord.total.toLocaleString() }}</div>
        </div>
      </div>
      <div class="flex flex-col sm:flex-row justify-between sm:items-center gap-2 pt-3 border-t border-slate-100">
        <span class="bg-sky-50 text-sky-700 border border-sky-200 font-bold px-3 py-1 rounded-full text-[11px] inline-flex items-center gap-1.5 w-fit">
          <i class="fa-solid fa-truck-fast"></i>
          <span>{{ ord.status }}</span>
        </span>
        <span class="text-slate-500 text-[11px] font-mono">운송장: {{ ord.tracking }}</span>
      </div>
    </div>
  </div>
</template>
