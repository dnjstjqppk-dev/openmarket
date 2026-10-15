<script setup lang="ts">
import { ref } from 'vue';

const summary = ref({
  totalGross: 48200000,
  commission: 4820000,
  shippingSettled: 1250000,
  netPayout: 44630000
});

const settlements = ref([
  { id: 'stl_01', cycle: '2026-10 1회차', period: '2026-10-01 ~ 10-15', gross: 24500000, fee: 2450000, payout: 22050000, status: '정산완료', date: '2026-10-15' },
  { id: 'stl_02', cycle: '2026-10 2회차', period: '2026-10-16 ~ 10-31', gross: 23700000, fee: 2370000, payout: 21330000, status: '정산대기', date: '2026-10-31' }
]);
</script>

<template>
  <div class="space-y-6">
    <div>
      <h1 class="text-2xl font-bold text-slate-900">판매 정산 내역 및 수수료 원장</h1>
      <p class="text-xs text-slate-500 mt-1">에스크로 확정 주문에 대한 정산 대금 및 플랫폼 수수료 명세입니다.</p>
    </div>

    <!-- Summary Cards -->
    <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
      <div class="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
        <div class="text-xs text-slate-500 font-semibold mb-1">총 결제 승인액</div>
        <div class="text-lg font-bold text-slate-900">₩{{ summary.totalGross.toLocaleString() }}</div>
      </div>
      <div class="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
        <div class="text-xs text-slate-500 font-semibold mb-1">플랫폼 수수료 (10%)</div>
        <div class="text-lg font-bold text-rose-600">-₩{{ summary.commission.toLocaleString() }}</div>
      </div>
      <div class="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
        <div class="text-xs text-slate-500 font-semibold mb-1">배송비 정산액</div>
        <div class="text-lg font-bold text-slate-700">+₩{{ summary.shippingSettled.toLocaleString() }}</div>
      </div>
      <div class="bg-white p-5 rounded-2xl border border-indigo-200 bg-indigo-50/50 shadow-sm">
        <div class="text-xs text-indigo-700 font-semibold mb-1">실 지급 확정액</div>
        <div class="text-xl font-black text-indigo-900">₩{{ summary.netPayout.toLocaleString() }}</div>
      </div>
    </div>

    <!-- Settlement Table -->
    <div class="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
      <div class="overflow-x-auto">
        <table class="w-full text-left text-xs">
          <thead class="bg-slate-50 text-slate-500 uppercase font-semibold">
            <tr>
              <th class="py-3 px-4">정산 차수</th>
              <th class="py-3 px-4">집계 대상 기간</th>
              <th class="py-3 px-4">매출액</th>
              <th class="py-3 px-4">수수료 공제</th>
              <th class="py-3 px-4">실 지급액</th>
              <th class="py-3 px-4">지급예정일</th>
              <th class="py-3 px-4 text-right">상태</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-slate-100">
            <tr v-for="st in settlements" :key="st.id" class="hover:bg-slate-50 transition">
              <td class="py-3.5 px-4 font-bold text-slate-900">{{ st.cycle }}</td>
              <td class="py-3.5 px-4 text-slate-600">{{ st.period }}</td>
              <td class="py-3.5 px-4 font-semibold text-slate-900">₩{{ st.gross.toLocaleString() }}</td>
              <td class="py-3.5 px-4 text-rose-600 font-medium">-₩{{ st.fee.toLocaleString() }}</td>
              <td class="py-3.5 px-4 font-bold text-indigo-600">₩{{ st.payout.toLocaleString() }}</td>
              <td class="py-3.5 px-4 font-mono text-slate-500">{{ st.date }}</td>
              <td class="py-3.5 px-4 text-right">
                <span class="px-2 py-0.5 rounded-full text-[10px] font-semibold" :class="st.status === '정산완료' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'">
                  {{ st.status }}
                </span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</template>
