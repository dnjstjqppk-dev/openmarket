<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { API_BASE_URL, getAdminHeaders } from '../config';

interface AdminOrder {
  id: string;
  order_no: string;
  customer_id: string;
  buyer_email?: string;
  total_pay_amount: number;
  payment_status: string;
  created_at: string;
}

const orders = ref<AdminOrder[]>([]);
const loading = ref(true);
const statusFilter = ref('ALL');

async function loadOrders() {
  loading.value = true;
  try {
    const res = await fetch(`${API_BASE_URL}/api/v1/admin/orders`, {
      headers: getAdminHeaders()
    });
    const json = await res.json();
    if (json.success && json.data) {
      orders.value = json.data;
    }
  } catch (_) {
  } finally {
    loading.value = false;
  }
}

const filteredOrders = computed(() => {
  if (statusFilter.value === 'ALL') return orders.value;
  return orders.value.filter(o => o.payment_status === statusFilter.value);
});

onMounted(loadOrders);
</script>

<template>
  <div class="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-4">
    <div class="flex items-center justify-between border-b pb-3">
      <div>
        <h2 class="text-base font-bold text-slate-900">전사 주문 관리</h2>
        <p class="text-xs text-slate-500 mt-0.5">Cloudflare D1에 적재된 모든 주문을 조회하고 상태를 모니터링합니다.</p>
      </div>
      <div class="flex items-center gap-2">
        <select v-model="statusFilter" class="text-xs border border-slate-300 rounded-lg px-2 py-1.5 bg-white">
          <option value="ALL">전체 상태</option>
          <option value="PAID">결제완료</option>
          <option value="SHIPPED">배송중</option>
          <option value="DELIVERED">배송완료</option>
          <option value="CANCELLED">취소</option>
        </select>
        <button @click="loadOrders" class="text-xs text-indigo-600 font-bold hover:underline">
          <i class="fa-solid fa-rotate mr-1"></i>새로고침
        </button>
      </div>
    </div>

    <div v-if="loading" class="p-12 text-center text-slate-400 text-xs">
      <i class="fa-solid fa-spinner fa-spin mr-2"></i>주문 목록을 불러오는 중...
    </div>

    <div v-else class="overflow-x-auto text-xs">
      <table class="w-full text-left">
        <thead class="bg-slate-50 text-slate-500 uppercase border-b text-[10px]">
          <tr>
            <th class="p-3">주문번호</th>
            <th class="p-3">구매자</th>
            <th class="p-3">결제금액</th>
            <th class="p-3">상태</th>
            <th class="p-3">주문일시</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-slate-100">
          <tr v-for="o in filteredOrders" :key="o.id" class="hover:bg-slate-50">
            <td class="p-3 font-mono font-bold text-slate-700">{{ o.order_no || o.id }}</td>
            <td class="p-3 text-slate-600">{{ o.buyer_email || o.customer_id }}</td>
            <td class="p-3 font-bold text-slate-900">₩{{ Number(o.total_pay_amount || 0).toLocaleString() }}</td>
            <td class="p-3">
              <span class="px-2 py-0.5 rounded-full text-[10px] font-bold"
                :class="{
                  'bg-amber-100 text-amber-700': ['PAID','PREPARING'].includes(o.payment_status),
                  'bg-sky-100 text-sky-700': ['SHIPPED','IN_TRANSIT'].includes(o.payment_status),
                  'bg-emerald-100 text-emerald-700': ['DELIVERED','CONFIRMED','COMPLETED'].includes(o.payment_status),
                  'bg-rose-100 text-rose-700': o.payment_status === 'CANCELLED'
                }">
                {{ o.payment_status }}
              </span>
            </td>
            <td class="p-3 text-slate-400">{{ new Date(o.created_at).toLocaleString() }}</td>
          </tr>
        </tbody>
      </table>
      <div v-if="filteredOrders.length === 0" class="p-8 text-center text-slate-400">
        조건에 맞는 주문이 없습니다.
      </div>
    </div>
  </div>
</template>