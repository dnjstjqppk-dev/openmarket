<script setup lang="ts">
import { ref } from 'vue';

interface ShipmentOrder {
  id: string;
  orderNo: string;
  recipient: string;
  phone: string;
  carrier: string;
  trackingNo: string;
  status: string;
}

const shipments = ref<ShipmentOrder[]>([
  { id: 'sub_1', orderNo: 'ORD20261015-001', recipient: '김철수', phone: '010-1234-5678', carrier: 'CJ대한통운', trackingNo: '', status: '결제완료' },
  { id: 'sub_2', orderNo: 'ORD20261015-002', recipient: '이영희', phone: '010-9876-5432', carrier: '우체국택배', trackingNo: '68920194821', status: '배송중' }
]);

function saveTracking(order: ShipmentOrder) {
  if (order.trackingNo.trim()) {
    order.status = '배송중';
    alert(`송장번호 [${order.trackingNo}]가 정상 등록되어 출고 처리되었습니다.`);
  }
}
</script>

<template>
  <div class="space-y-6">
    <div>
      <h1 class="text-2xl font-bold text-slate-900">주문 발송 및 운송장 관리</h1>
      <p class="text-xs text-slate-500 mt-1">인입된 주문의 송장번호를 등록하여 배송추적 시스템으로 연동합니다.</p>
    </div>

    <div class="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
      <div class="overflow-x-auto">
        <table class="w-full text-left text-xs">
          <thead class="bg-slate-50 text-slate-500 uppercase font-semibold">
            <tr>
              <th class="py-3 px-4">주문번호</th>
              <th class="py-3 px-4">수령인</th>
              <th class="py-3 px-4">연락처</th>
              <th class="py-3 px-4">택배사</th>
              <th class="py-3 px-4">운송장 번호</th>
              <th class="py-3 px-4">배송상태</th>
              <th class="py-3 px-4 text-right">출고 등록</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-slate-100">
            <tr v-for="s in shipments" :key="s.id" class="hover:bg-slate-50 transition">
              <td class="py-3.5 px-4 font-mono font-bold text-slate-900">{{ s.orderNo }}</td>
              <td class="py-3.5 px-4 font-medium text-slate-800">{{ s.recipient }}</td>
              <td class="py-3.5 px-4 text-slate-500 font-mono">{{ s.phone }}</td>
              <td class="py-3.5 px-4">
                <select v-model="s.carrier" class="border border-slate-300 rounded px-2 py-1 text-xs">
                  <option>CJ대한통운</option>
                  <option>우체국택배</option>
                  <option>한진택배</option>
                  <option>롯데택배</option>
                </select>
              </td>
              <td class="py-3.5 px-4">
                <input 
                  v-model="s.trackingNo" 
                  placeholder="송장번호 입력" 
                  class="border border-slate-300 rounded px-2.5 py-1 text-xs font-mono w-36 focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                />
              </td>
              <td class="py-3.5 px-4">
                <span class="px-2 py-0.5 rounded-full text-[10px] font-semibold" :class="s.status === '배송중' ? 'bg-sky-100 text-sky-700' : 'bg-amber-100 text-amber-700'">
                  {{ s.status }}
                </span>
              </td>
              <td class="py-3.5 px-4 text-right">
                <button 
                  @click="saveTracking(s)" 
                  class="px-3 py-1 bg-indigo-600 hover:bg-indigo-700 text-white rounded font-semibold text-[11px] shadow-sm transition"
                >
                  출고 확정
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</template>
