<script setup lang="ts">
import { ref, onMounted } from 'vue';

const metrics = ref({
  totalProducts: 0,
  ordersCount: 0,
  totalSales: 0,
  settlementExpected: 0
});

const recentOrders = ref<any[]>([]);
const loading = ref(true);

onMounted(async () => {
  try {
    const [metRes, ordRes] = await Promise.all([
      fetch('https://olmoa-api.dnjstjqppk.workers.dev/api/v1/partner/metrics', { headers: { 'X-Partner-Id': 'pt_001' } }),
      fetch('https://olmoa-api.dnjstjqppk.workers.dev/api/v1/partner/orders', { headers: { 'X-Partner-Id': 'pt_001' } })
    ]);

    const metJson = await metRes.json();
    if (metJson.success) {
      metrics.value.totalProducts = metJson.products_count || 0;
      metrics.value.ordersCount = metJson.orders_count || 0;
      metrics.value.totalSales = metJson.total_sales_amount || 0;
      metrics.value.settlementExpected = Math.round(metrics.value.totalSales * 0.9);
    }

    const ordJson = await ordRes.json();
    if (ordJson.success && ordJson.data) {
      recentOrders.value = ordJson.data.slice(0, 5);
    }
  } catch (_) {
  } finally {
    loading.value = false;
  }
});
</script>

<template>
  <div class="space-y-6">
    <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
      <div>
        <h1 class="text-2xl font-bold text-slate-900">판매자 비즈니스 대시보드</h1>
        <p class="text-xs text-slate-500 mt-1">D1 데이터베이스에 기록된 입점사의 실시간 판매 현황 및 출고 지표입니다.</p>
      </div>
      <div class="flex gap-2">
        <router-link to="/products" class="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-semibold shadow-sm transition">
          <i class="fa-solid fa-boxes-stacked mr-1.5"></i>상품 재고 관리
        </router-link>
        <router-link to="/shipments" class="px-4 py-2 bg-slate-800 hover:bg-slate-900 text-white rounded-lg text-xs font-semibold shadow-sm transition">
          <i class="fa-solid fa-truck-fast mr-1.5"></i>송장 출고 관리
        </router-link>
      </div>
    </div>

    <!-- Metric Cards -->
    <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
      <div class="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
        <div class="text-xs font-semibold text-slate-500 mb-1">등록 상품 수</div>
        <div class="text-2xl font-bold text-slate-900">{{ metrics.totalProducts }}개</div>
        <div class="text-[10px] text-emerald-600 font-semibold mt-1">D1 활성 카탈로그</div>
      </div>
      <div class="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
        <div class="text-xs font-semibold text-slate-500 mb-1">인입된 총 주문건수</div>
        <div class="text-2xl font-bold text-indigo-600">{{ metrics.ordersCount }}건</div>
        <div class="text-[10px] text-slate-400 mt-1">실시간 고객 주문</div>
      </div>
      <div class="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
        <div class="text-xs font-semibold text-slate-500 mb-1">총 누적 매출</div>
        <div class="text-2xl font-bold text-slate-900">₩{{ metrics.totalSales.toLocaleString() }}</div>
        <div class="text-[10px] text-emerald-600 font-semibold mt-1">에스크로 확정 매출</div>
      </div>
      <div class="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
        <div class="text-xs font-semibold text-slate-500 mb-1">정산 예정 금액 (수수료 10% 제외)</div>
        <div class="text-2xl font-bold text-emerald-600">₩{{ metrics.settlementExpected.toLocaleString() }}</div>
        <div class="text-[10px] text-slate-400 mt-1">월 2회 정산 자동 지급</div>
      </div>
    </div>

    <!-- Recent Orders Table -->
    <div class="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
      <div class="p-5 border-b border-slate-100 flex items-center justify-between">
        <h2 class="font-bold text-slate-800 text-sm">실시간 인입 주문 내역</h2>
        <router-link to="/shipments" class="text-xs text-indigo-600 hover:underline">전체보기 &rarr;</router-link>
      </div>

      <div v-if="loading" class="p-8 text-center text-slate-400 text-xs">
        <i class="fa-solid fa-spinner fa-spin mr-2"></i>주문 정보를 불러오는 중...
      </div>

      <div v-else-if="recentOrders.length === 0" class="p-8 text-center text-slate-400 text-xs">
        인입된 신규 주문이 없습니다.
      </div>

      <div v-else class="overflow-x-auto">
        <table class="w-full text-left text-xs">
          <thead class="bg-slate-50 text-slate-500 uppercase font-semibold">
            <tr>
              <th class="py-3 px-4">주문번호</th>
              <th class="py-3 px-4">수령인</th>
              <th class="py-3 px-4">결제금액</th>
              <th class="py-3 px-4">진행상태</th>
              <th class="py-3 px-4 text-right">관리</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-slate-100">
            <tr v-for="order in recentOrders" :key="order.id" class="hover:bg-slate-50 transition">
              <td class="py-3 px-4 font-mono font-medium text-slate-900">{{ order.sub_order_no || order.order_no }}</td>
              <td class="py-3 px-4 font-medium text-slate-800">{{ order.recipient_name }}</td>
              <td class="py-3 px-4 font-semibold text-slate-900">₩{{ order.total_amount.toLocaleString() }}</td>
              <td class="py-3 px-4">
                <span 
                  class="px-2 py-0.5 rounded-full text-[10px] font-semibold"
                  :class="order.status === 'SHIPPED' ? 'bg-sky-100 text-sky-700' : 'bg-amber-100 text-amber-700'"
                >
                  {{ order.status === 'SHIPPED' ? '출고완료' : '결제확인' }}
                </span>
              </td>
              <td class="py-3 px-4 text-right">
                <router-link to="/shipments" class="text-indigo-600 hover:text-indigo-800 font-semibold text-[11px]">처리</router-link>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</template>
