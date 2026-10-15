<script setup lang="ts">
import { ref } from 'vue';

const gmv = ref('₩ 412,850,000');
const escrow = ref('₩ 189,400,000');
const pendingKyc = ref(2);
const todayOrders = ref(3491);
</script>

<template>
  <div class="space-y-6">
    <h2 class="text-xl font-black text-slate-900 border-b pb-3">플랫폼 운영 총괄 대시보드</h2>
    <div class="grid grid-cols-1 md:grid-cols-4 gap-4 text-xs">
      <div class="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
        <div class="text-slate-500 font-medium">당일 총 거래액 (GMV)</div>
        <div class="text-2xl font-black text-slate-900 mt-1">{{ gmv }}</div>
        <div class="text-emerald-600 font-bold mt-1">↑ 전일 대비 18.4% 증가</div>
      </div>
      <div class="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
        <div class="text-slate-500 font-medium">플랫폼 에스크로 보관 잔액</div>
        <div class="text-2xl font-black text-purple-700 mt-1">{{ escrow }}</div>
        <div class="text-slate-400 mt-1">구매확정 대기 자금 안전 격리</div>
      </div>
      <div class="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
        <div class="text-slate-500 font-medium">입점 심사 대기 파트너</div>
        <div class="text-2xl font-black text-orange-600 mt-1">{{ pendingKyc }} 건</div>
        <div class="text-orange-700 mt-1">사업자등록증 서류 심사 필요</div>
      </div>
      <div class="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
        <div class="text-slate-500 font-medium">오늘 접수된 신규 주문</div>
        <div class="text-2xl font-black text-blue-600 mt-1">{{ todayOrders.toLocaleString() }} 건</div>
        <div class="text-slate-400 mt-1">전체 주문 정상 출고 진행중</div>
      </div>
    </div>
  </div>
</template>
