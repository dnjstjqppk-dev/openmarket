<script setup lang="ts">
import { ref, onMounted } from 'vue';

const metrics = ref({
  totalProducts: 0,
  totalOrders: 0,
  totalGmv: 0,
  totalPartners: 0,
  totalUsers: 0
});
const loading = ref(true);

onMounted(async () => {
  try {
    const res = await fetch('https://olmoa-api.dnjstjqppk.workers.dev/api/v1/admin/dashboard');
    const json = await res.json();
    if (json.success && json.metrics) {
      metrics.value.totalProducts = json.metrics.total_products || 0;
      metrics.value.totalOrders = json.metrics.total_orders || 0;
      metrics.value.totalGmv = json.metrics.total_gmv_amount || 0;
      metrics.value.totalPartners = json.metrics.total_partners || 0;
      metrics.value.totalUsers = json.metrics.total_users || 0;
    }
  } catch (_) {
  } finally {
    loading.value = false;
  }
});
</script>

<template>
  <div class="space-y-6">
    <div class="flex items-center justify-between border-b pb-4">
      <div>
        <h2 class="text-xl font-black text-slate-900">OLMOA 글로벌 플랫폼 운영 총괄 대시보드</h2>
        <p class="text-xs text-slate-500 mt-0.5">올모아 전 세계 주문, 에스크로 보관 자금 및 셀러 심사 현황</p>
      </div>
      <div class="flex gap-2">
        <span class="px-3 py-1 bg-emerald-50 text-emerald-700 rounded-full text-xs font-bold border border-emerald-200">
          시스템 정상 가동 (Cloudflare D1 연동)
        </span>
      </div>
    </div>

    <div v-if="loading" class="p-12 text-center text-slate-400 text-xs">
      <i class="fa-solid fa-spinner fa-spin mr-2"></i>운영 지표를 집계하는 중입니다...
    </div>

    <div v-else class="grid grid-cols-1 md:grid-cols-4 gap-4 text-xs">
      <div class="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
        <div class="text-slate-500 font-medium">총 누적 결제액 (GMV)</div>
        <div class="text-2xl font-black text-slate-900 mt-1">₩ {{ metrics.totalGmv.toLocaleString() }}</div>
        <div class="text-emerald-600 font-bold mt-1">D1 실시간 집계</div>
      </div>
      <div class="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
        <div class="text-slate-500 font-medium">플랫폼 총 주문 건수</div>
        <div class="text-2xl font-black text-indigo-700 mt-1">{{ metrics.totalOrders }} 건</div>
        <div class="text-slate-400 mt-1">Split-Order 분기 완료</div>
      </div>
      <div class="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
        <div class="text-slate-500 font-medium">활성 판매 파트너사</div>
        <div class="text-2xl font-black text-orange-600 mt-1">{{ metrics.totalPartners }} 개사</div>
        <div class="text-slate-400 mt-1">입점 승인 파트너</div>
      </div>
      <div class="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
        <div class="text-slate-500 font-medium">등록 활성 상품 (33개 대분류)</div>
        <div class="text-2xl font-black text-blue-600 mt-1">{{ metrics.totalProducts }} 개</div>
        <div class="text-slate-400 mt-1">전 카테고리 실재고 연동</div>
      </div>
    </div>
  </div>
</template>
