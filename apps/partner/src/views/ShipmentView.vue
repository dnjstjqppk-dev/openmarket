<script setup lang="ts">
import { ref, onMounted } from 'vue';

interface SubOrder {
  id: string;
  order_no: string;
  sub_order_no: string;
  recipient_name: string;
  recipient_phone: string;
  shipping_address_line1: string;
  carrier_code?: string;
  tracking_number?: string;
  status: string;
  total_amount: number;
  items?: any[];
}

const shipments = ref<SubOrder[]>([]);
const loading = ref(true);
const isSaving = ref<string | null>(null);

async function loadShipments() {
  loading.value = true;
  try {
    const res = await fetch('https://olmoa-api.dnjstjqppk.workers.dev/api/v1/partner/orders', {
      headers: { 'X-Partner-Id': 'pt_001' }
    });
    const json = await res.json();
    if (json.success && json.data) {
      shipments.value = json.data;
    }
  } catch (_) {
  } finally {
    loading.value = false;
  }
}

async function saveTracking(order: SubOrder) {
  if (!order.tracking_number || !order.tracking_number.trim()) return;
  isSaving.value = order.id;

  try {
    const res = await fetch(`https://olmoa-api.dnjstjqppk.workers.dev/api/v1/partner/orders/${order.id}/shipment`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'X-Partner-Id': 'pt_001' },
      body: JSON.stringify({
        carrier: order.carrier_code || 'CJ대한통운',
        tracking_number: order.tracking_number.trim()
      })
    });
    if (res.ok) {
      order.status = 'SHIPPED';
    }
  } catch (_) {
  } finally {
    isSaving.value = null;
  }
}

onMounted(() => {
  loadShipments();
});
</script>

<template>
  <div class="space-y-6">
    <div>
      <h1 class="text-2xl font-bold text-slate-900">주문 발송 및 운송장 관리</h1>
      <p class="text-xs text-slate-500 mt-1">D1에 실시간 인입된 주문의 송장번호를 등록하여 배송추적 시스템으로 연동합니다.</p>
    </div>

    <div v-if="loading" class="p-16 text-center text-slate-400">
      <i class="fa-solid fa-spinner fa-spin text-3xl mb-3 text-indigo-500"></i>
      <p class="text-xs font-bold">주문 및 발송 대기 목록을 불러오는 중입니다...</p>
    </div>

    <div v-else-if="shipments.length === 0" class="bg-white rounded-2xl p-12 text-center border border-slate-200">
      <i class="fa-solid fa-truck text-4xl text-slate-300 mb-2"></i>
      <h3 class="font-bold text-slate-700 text-sm">인입된 발송 대기 주문이 없습니다.</h3>
      <p class="text-xs text-slate-400 mt-1">새로운 고객 주문이 접수되면 이곳에 자동으로 표시됩니다.</p>
    </div>

    <div v-else class="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
      <div class="overflow-x-auto">
        <table class="w-full text-left text-xs">
          <thead class="bg-slate-50 text-slate-500 uppercase font-semibold">
            <tr>
              <th class="py-3 px-4">주문번호</th>
              <th class="py-3 px-4">수령인</th>
              <th class="py-3 px-4">배송지</th>
              <th class="py-3 px-4">택배사</th>
              <th class="py-3 px-4">운송장 번호</th>
              <th class="py-3 px-4">배송상태</th>
              <th class="py-3 px-4 text-right">출고 등록</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-slate-100">
            <tr v-for="s in shipments" :key="s.id" class="hover:bg-slate-50 transition">
              <td class="py-3.5 px-4 font-mono font-bold text-slate-900">
                {{ s.sub_order_no || s.order_no }}
              </td>
              <td class="py-3.5 px-4 font-medium text-slate-800">
                {{ s.recipient_name }} ({{ s.recipient_phone }})
              </td>
              <td class="py-3.5 px-4 text-slate-500 max-w-xs truncate">
                {{ s.shipping_address_line1 }}
              </td>
              <td class="py-3.5 px-4">
                <select v-model="s.carrier_code" class="border border-slate-300 rounded px-2 py-1 text-xs">
                  <option value="CJ대한통운">CJ대한통운</option>
                  <option value="우체국택배">우체국택배</option>
                  <option value="한진택배">한진택배</option>
                  <option value="롯데택배">롯데택배</option>
                </select>
              </td>
              <td class="py-3.5 px-4">
                <input 
                  v-model="s.tracking_number" 
                  placeholder="송장번호 입력" 
                  class="border border-slate-300 rounded px-2.5 py-1 text-xs font-mono w-36 focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                />
              </td>
              <td class="py-3.5 px-4">
                <span 
                  class="px-2 py-0.5 rounded-full text-[10px] font-semibold" 
                  :class="s.status === 'SHIPPED' ? 'bg-sky-100 text-sky-700' : 'bg-amber-100 text-amber-700'"
                >
                  {{ s.status === 'SHIPPED' ? '출고완료' : '결제확인' }}
                </span>
              </td>
              <td class="py-3.5 px-4 text-right">
                <button 
                  @click="saveTracking(s)" 
                  :disabled="isSaving === s.id || !s.tracking_number"
                  class="px-3 py-1 bg-indigo-600 hover:bg-indigo-700 text-white rounded font-semibold text-[11px] shadow-sm transition disabled:opacity-50"
                >
                  {{ isSaving === s.id ? '처리중' : '출고 확정' }}
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</template>
