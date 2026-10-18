<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { API_BASE, getPartnerHeaders } from '../config';

const loading = ref(true);
const summary = ref({
  totalGross: 0,
  commission: 0,
  shippingSettled: 0,
  netPayout: 0
});

const settlements = ref<any[]>([]);

onMounted(async () => {
  try {
    const res = await fetch(`${API_BASE}/api/v1/partner/settlements`, {
      headers: getPartnerHeaders()
    });
    if (res.ok) {
      const json = await res.json();
      if (json.summary) {
        summary.value = json.summary;
      }
      settlements.value = json.data || [];
    }
  } catch (e) {
    console.error('Failed to load real settlements ledger:', e);
  } finally {
    loading.value = false;
  }
});
</script>

<template>
  <div class="space-y-6">
    <div>
      <h1 class="text-2xl font-bold text-slate-900">판매 정산 내역 및 수수료 원장</h1>
      <p class="text-xs text-slate-500 mt-1">D1 정산 원장 테이블에 실시간 기록된 정산 대금 및 수수료 명세입니다.</p>
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
      <div v-if="loading" class="p-8 text-center text-xs text-slate-400">
        <i class="fa-solid fa-spinner fa-spin mr-1"></i>정산 원장을 조회하는 중입니다...
      </div>
      <div v-else-if="settlements.length === 0" class="p-8 text-center text-xs text-slate-400">
        아직 집계된 정산 내역이 없습니다. (주문 발생 시 자동 생성)
      </div>
      <div v-else class="overflow-x-auto">
        <table class="w-full text-left text-xs">
          <thead class="bg-slate-50 text-slate-500 uppercase font-semibold">
            <tr>
              <th class="py-3 px-4">정산 ID</th>
              <th class="py-3 px-4">주문번호</th>
              <th class="py-3 px-4">매출액</th>
              <th class="py-3 px-4">배송비</th>
              <th class="py-3 px-4">수수료(10%)</th>
              <th class="py-3 px-4">실 지급액</th>
              <th class="py-3 px-4">주문상태</th>
              <th class="py-3 px-4 text-right">정산상태</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-slate-100">
            <tr v-for="st in settlements" :key="st.id" class="hover:bg-slate-50 transition">
              <td class="py-3 px-4 font-mono text-slate-500">{{ st.id }}</td>
              <td class="py-3 px-4 font-medium text-slate-800">{{ st.sub_order_no || st.sub_order_id }}</td>
              <td class="py-3 px-4 font-mono font-bold text-slate-900">₩{{ (st.gross_amount || 0).toLocaleString() }}</td>
              <td class="py-3 px-4 font-mono text-slate-600">₩{{ (st.shipping_fee || 0).toLocaleString() }}</td>
              <td class="py-3 px-4 font-mono text-rose-600">-₩{{ (st.commission_amount || 0).toLocaleString() }}</td>
              <td class="py-3 px-4 font-mono font-bold text-indigo-700">₩{{ (st.net_payout_amount || 0).toLocaleString() }}</td>
              <td class="py-3 px-4">
                <span class="px-2 py-0.5 rounded text-[10px] font-bold" :class="st.order_status === 'SHIPPED' ? 'bg-sky-50 text-sky-700' : 'bg-amber-50 text-amber-700'">
                  {{ st.order_status || 'CONFIRMED' }}
                </span>
              </td>
              <td class="py-3 px-4 text-right">
                <span class="px-2.5 py-1 rounded-full text-[11px] font-bold" :class="st.status === 'PAID' ? 'bg-emerald-50 text-emerald-700' : st.status === 'CANCELLED' ? 'bg-rose-50 text-rose-700' : 'bg-slate-100 text-slate-600'">
                  {{ st.status === 'PAID' ? '지급완료' : st.status === 'CANCELLED' ? '취소환원' : '정산대기' }}
                </span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</template>
