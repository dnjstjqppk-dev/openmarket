<script setup lang="ts">
import { ref } from 'vue';

const metrics = ref({
  todaySales: 14250000,
  pendingOrders: 18,
  shippingReady: 42,
  returnClaims: 1,
  settlementExpected: 28500000
});

const recentOrders = ref([
  { id: 'sub_ord_101', no: 'SUB20261015-001', product: '초경량 ANC 이어폰 Pro 3', qty: 2, amount: 99800, status: '결제완료' },
  { id: 'sub_ord_102', no: 'SUB20261015-002', product: '65W GaN 고속 충전기 3포트', qty: 1, amount: 24500, status: '출고준비' },
  { id: 'sub_ord_103', no: 'SUB20261015-003', product: '소프트 기모 후드티 (Grey)', qty: 3, amount: 86700, status: '배송중' }
]);
</script>

<template>
  <div class="space-y-6">
    <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
      <div>
        <h1 class="text-2xl font-bold text-slate-900">판매자 비즈니스 대시보드</h1>
        <p class="text-xs text-slate-500 mt-1">오늘의 판매 현황, 주문 출고 대기 및 정산 지표입니다.</p>
      </div>
      <div class="flex gap-2">
        <router-link to="/bulk-upload" class="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-semibold shadow-sm transition">
          <i class="fa-solid fa-file-excel mr-1.5"></i>대량 상품 등록
        </router-link>
        <router-link to="/shipments" class="px-4 py-2 bg-slate-800 hover:bg-slate-900 text-white rounded-lg text-xs font-semibold shadow-sm transition">
          <i class="fa-solid fa-truck-fast mr-1.5"></i>송장 일괄 입력
        </router-link>
      </div>
    </div>

    <!-- Metric Cards -->
    <div class="grid grid-cols-2 md:grid-cols-5 gap-4">
      <div class="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
        <div class="text-xs font-semibold text-slate-500 mb-1">오늘 총 매출</div>
        <div class="text-xl font-bold text-slate-900">₩{{ metrics.todaySales.toLocaleString() }}</div>
        <div class="text-[10px] text-emerald-600 font-semibold mt-1"><i class="fa-solid fa-arrow-up mr-0.5"></i>전일 대비 +14.2%</div>
      </div>
      <div class="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
        <div class="text-xs font-semibold text-slate-500 mb-1">신규 주문 (결제완료)</div>
        <div class="text-xl font-bold text-indigo-600">{{ metrics.pendingOrders }}건</div>
        <div class="text-[10px] text-slate-400 mt-1">즉시 확인 요망</div>
      </div>
      <div class="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
        <div class="text-xs font-semibold text-slate-500 mb-1">출고 대기중</div>
        <div class="text-xl font-bold text-amber-600">{{ metrics.shippingReady }}건</div>
        <div class="text-[10px] text-amber-600 font-semibold mt-1">오늘 출고 마감 17:00</div>
      </div>
      <div class="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
        <div class="text-xs font-semibold text-slate-500 mb-1">클레임/반품</div>
        <div class="text-xl font-bold text-rose-600">{{ metrics.returnClaims }}건</div>
        <div class="text-[10px] text-slate-400 mt-1">처리 기한 D-2</div>
      </div>
      <div class="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm col-span-2 md:col-span-1">
        <div class="text-xs font-semibold text-slate-500 mb-1">이번 차수 정산 예정</div>
        <div class="text-xl font-bold text-emerald-600">₩{{ metrics.settlementExpected.toLocaleString() }}</div>
        <div class="text-[10px] text-slate-400 mt-1">정산일: 2026-10-25</div>
      </div>
    </div>

    <!-- Recent Orders Table -->
    <div class="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
      <div class="p-5 border-b border-slate-100 flex items-center justify-between">
        <h2 class="font-bold text-slate-800 text-sm">실시간 인입 주문 내역</h2>
        <router-link to="/shipments" class="text-xs text-indigo-600 hover:underline">전체보기 &rarr;</router-link>
      </div>
      <div class="overflow-x-auto">
        <table class="w-full text-left text-xs">
          <thead class="bg-slate-50 text-slate-500 uppercase font-semibold">
            <tr>
              <th class="py-3 px-4">주문번호</th>
              <th class="py-3 px-4">대표 상품명</th>
              <th class="py-3 px-4">수량</th>
              <th class="py-3 px-4">결제금액</th>
              <th class="py-3 px-4">진행상태</th>
              <th class="py-3 px-4 text-right">관리</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-slate-100">
            <tr v-for="order in recentOrders" :key="order.id" class="hover:bg-slate-50 transition">
              <td class="py-3 px-4 font-mono font-medium text-slate-900">{{ order.no }}</td>
              <td class="py-3 px-4 font-medium text-slate-800">{{ order.product }}</td>
              <td class="py-3 px-4 text-slate-600">{{ order.qty }}개</td>
              <td class="py-3 px-4 font-semibold text-slate-900">₩{{ order.amount.toLocaleString() }}</td>
              <td class="py-3 px-4">
                <span class="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-100 text-emerald-700">
                  {{ order.status }}
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

