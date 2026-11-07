<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { API_BASE_URL, getAdminHeaders } from '../config';

interface AdminOrder {
  id: string;
  order_no: string;
  customer_id: string;
  buyer_email?: string;
  total_pay_amount: number;
  currency?: string;
  pccc?: string;
  pccc_verified?: number;
  customs_duty_type?: string;
  payment_status: string;
  created_at: string;
  sub_orders?: any[];
}

const orders = ref<AdminOrder[]>([]);
const loading = ref(true);
const statusFilter = ref('ALL');
const actionMsg = ref('');
const refunding = ref<string | null>(null);

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

function refundableLines(o: AdminOrder) {
  const lines: { order_item_id: string; quantity: number }[] = [];
  for (const s of o.sub_orders || []) {
    for (const it of s.items || []) {
      const left = Number(it.quantity || 0) - Number(it.refunded_quantity || 0);
      if (left > 0) lines.push({ order_item_id: it.id, quantity: left });
    }
  }
  return lines;
}

async function fullRefund(o: AdminOrder) {
  const lines = refundableLines(o);
  if (!lines.length) return;
  const reason = window.prompt(`주문 ${o.order_no || o.id} 전액 환불 사유를 입력하세요 (필수, 환불 원장에 기록됩니다)`, '')?.trim();
  if (!reason) return;
  if (!window.confirm(`${lines.length}개 품목 전량을 원결제수단/적립금으로 환불합니다. 계속할까요?`)) return;
  refunding.value = o.id;
  try {
    const res = await fetch(`${API_BASE_URL}/api/v1/admin/orders/${o.id}/refund`, {
      method: 'POST',
      headers: { ...getAdminHeaders(), 'X-Idempotency-Key': `admfr-${o.id}-${Date.now()}` },
      body: JSON.stringify({ lines, reason })
    });
    const json = await res.json().catch(() => ({}));
    actionMsg.value = res.ok && json.success
      ? `✓ 전액 환불 접수 (환불ID ${json.data?.refund?.id || '-'})`
      : `⚠ ${json.error || '환불 실패'}`;
    await loadOrders();
  } catch (_) {
    actionMsg.value = '⚠ 환불 요청 중 네트워크 오류';
  } finally {
    refunding.value = null;
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
        <h2 class="text-base font-bold text-slate-900 flex items-center gap-2">
          <span>전사 주문 & 글로벌 통관 통합 관리</span>
          <span class="px-2 py-0.5 rounded-full bg-blue-50 text-blue-600 text-[10px] font-bold">PCCC / FX 통합</span>
        </h2>
        <p class="text-xs text-slate-500 mt-0.5">Cloudflare D1에 적재된 모든 주문과 해외 통관고유부호(PCCC), 결제 통화를 모니터링합니다.</p>
      </div>
      <div class="flex items-center gap-2">
        <select v-model="statusFilter" class="text-xs border border-slate-300 rounded-lg px-2 py-1.5 bg-white">
          <option value="ALL">전체 상태</option>
          <option value="PAID">결제완료</option>
          <option value="SHIPPED">배송중</option>
          <option value="DELIVERED">배송완료</option>
          <option value="CANCELLED">취소</option>
        </select>
        <button @click="loadOrders" class="text-xs text-indigo-600 font-bold hover:underline cursor-pointer">
          <i class="fa-solid fa-rotate mr-1"></i>새로고침
        </button>
      </div>
    </div>

    <div v-if="actionMsg" class="p-3 rounded-xl bg-indigo-50 border border-indigo-200 text-indigo-800 text-xs font-bold">
      {{ actionMsg }}
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
            <th class="p-3">통관부호 (PCCC)</th>
            <th class="p-3">결제금액 (통화)</th>
            <th class="p-3">상태</th>
            <th class="p-3">주문일시</th>
            <th class="p-3 text-right">환불 조치</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-slate-100">
          <tr v-for="o in filteredOrders" :key="o.id" class="hover:bg-slate-50">
            <td class="p-3 font-mono font-bold text-slate-700">{{ o.order_no || o.id }}</td>
            <td class="p-3 text-slate-600">{{ o.buyer_email || o.customer_id }}</td>
            <td class="p-3">
              <span v-if="o.pccc" class="font-mono font-bold text-blue-600 bg-blue-50 px-2 py-0.5 rounded border border-blue-200 text-[10px]">
                {{ o.pccc }}
              </span>
              <span v-else class="text-slate-400 text-[10px]">국내배송 (면제)</span>
            </td>
            <td class="p-3 font-bold text-slate-900">
              ₩{{ Number(o.total_pay_amount || 0).toLocaleString() }}
              <span v-if="o.currency && o.currency !== 'KRW'" class="ml-1 text-[10px] text-gray-500 font-mono">
                ({{ o.currency }})
              </span>
            </td>
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
            <td class="p-3 text-right">
              <button
                v-if="['PAID', 'PARTIAL_REFUNDED'].includes(o.payment_status) && refundableLines(o).length"
                @click="fullRefund(o)"
                :disabled="refunding === o.id"
                class="px-2.5 py-1 rounded-lg border border-red-200 text-red-600 hover:bg-red-50 text-[11px] font-bold disabled:opacity-50 cursor-pointer"
              >
                {{ refunding === o.id ? '처리 중...' : '전액 환불' }}
              </button>
            </td>
          </tr>
        </tbody>
      </table>
      <div v-if="filteredOrders.length === 0" class="p-8 text-center text-slate-400">
        조건에 맞는 주문이 없습니다.
      </div>
    </div>
  </div>
</template>
