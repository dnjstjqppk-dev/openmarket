<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { API_BASE, getPartnerHeaders } from '../config';

interface OrderItem {
  id: string;
  sku_id: string;
  product_id: string;
  quantity: number;
  unit_price: number;
  total_price: number;
}

interface SubOrder {
  id: string;
  order_no: string;
  sub_order_no: string;
  recipient_name: string;
  recipient_phone: string;
  shipping_postal_code?: string;
  shipping_address_line1: string;
  shipping_address_line2?: string;
  shipping_memo?: string;
  carrier_code?: string;
  tracking_number?: string;
  status: string;
  total_amount: number;
  order_date?: string;
  items?: OrderItem[];
}

const shipments = ref<SubOrder[]>([]);
const loading = ref(true);
const isSaving = ref<string | null>(null);
const copyToast = ref<string | null>(null);
const activeFilter = ref<'ALL' | 'PENDING' | 'SHIPPED'>('ALL');

const filteredShipments = computed(() => {
  if (activeFilter.value === 'PENDING') {
    return shipments.value.filter(s => s.status !== 'SHIPPED' && s.status !== 'DELIVERED');
  }
  if (activeFilter.value === 'SHIPPED') {
    return shipments.value.filter(s => s.status === 'SHIPPED' || s.status === 'DELIVERED');
  }
  return shipments.value;
});

async function loadShipments() {
  loading.value = true;
  try {
    const res = await fetch(`${API_BASE}/api/v1/partner/orders`, {
      headers: getPartnerHeaders()
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
    const res = await fetch(`${API_BASE}/api/v1/partner/orders/${order.id}/shipment`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...getPartnerHeaders() },
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

function copyAddress(s: SubOrder) {
  const full = `[${s.shipping_postal_code || '우편번호 미기재'}] ${s.shipping_address_line1} ${s.shipping_address_line2 || ''} (수령인: ${s.recipient_name}, ${s.recipient_phone}) / 요청: ${s.shipping_memo || '문 앞'}`;
  navigator.clipboard.writeText(full).then(() => {
    copyToast.value = s.id;
    setTimeout(() => {
      copyToast.value = null;
    }, 2000);
  });
}

onMounted(() => {
  loadShipments();
});
</script>

<template>
  <div class="space-y-6">
    <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-200 pb-4">
      <div>
        <h1 class="text-xl sm:text-2xl font-black text-slate-900">주문 발송 및 운송장 관리</h1>
        <p class="text-xs text-slate-500 mt-1">D1 실시간 인입 주문의 송장번호를 등록하여 고객 배송추적 시스템과 즉시 동기화합니다.</p>
      </div>
      <!-- Filter Tabs -->
      <div class="flex items-center gap-1.5 self-start sm:self-auto">
        <button
          @click="activeFilter = 'ALL'"
          :class="[
            'px-3 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer',
            activeFilter === 'ALL' ? 'bg-indigo-600 text-white shadow-xs' : 'bg-white border border-slate-300 text-slate-700 hover:bg-slate-50'
          ]"
        >
          전체 ({{ shipments.length }})
        </button>
        <button
          @click="activeFilter = 'PENDING'"
          :class="[
            'px-3 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer',
            activeFilter === 'PENDING' ? 'bg-indigo-600 text-white shadow-xs' : 'bg-white border border-slate-300 text-slate-700 hover:bg-slate-50'
          ]"
        >
          출고 대기 ({{ shipments.filter(s => s.status !== 'SHIPPED' && s.status !== 'DELIVERED').length }})
        </button>
        <button
          @click="activeFilter = 'SHIPPED'"
          :class="[
            'px-3 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer',
            activeFilter === 'SHIPPED' ? 'bg-indigo-600 text-white shadow-xs' : 'bg-white border border-slate-300 text-slate-700 hover:bg-slate-50'
          ]"
        >
          출고 완료 ({{ shipments.filter(s => s.status === 'SHIPPED' || s.status === 'DELIVERED').length }})
        </button>
      </div>
    </div>

    <div v-if="loading" class="p-16 text-center text-slate-400">
      <i class="fa-solid fa-spinner fa-spin text-3xl mb-3 text-indigo-500"></i>
      <p class="text-xs font-bold">주문 및 발송 대기 목록을 불러오는 중입니다...</p>
    </div>

    <div v-else-if="filteredShipments.length === 0" class="bg-white rounded-2xl p-12 text-center border border-slate-200">
      <i class="fa-solid fa-truck text-4xl text-slate-300 mb-2"></i>
      <h3 class="font-bold text-slate-700 text-sm">해당 조건의 발송 건이 없습니다.</h3>
      <p class="text-xs text-slate-400 mt-1">고객의 신규 주문이 체결되면 실시간으로 표시됩니다.</p>
    </div>

    <div v-else class="space-y-4">
      <!-- 1. Mobile Cards Layout (visible on screens < 768px) -->
      <div class="md:hidden space-y-4">
        <div
          v-for="s in filteredShipments"
          :key="'mob_' + s.id"
          class="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs space-y-3"
        >
          <div class="flex items-center justify-between">
            <span class="font-mono font-bold text-xs text-slate-900">{{ s.sub_order_no || s.order_no }}</span>
            <span
              class="px-2 py-0.5 rounded-full text-[10px] font-black uppercase"
              :class="s.status === 'SHIPPED' ? 'bg-sky-100 text-sky-800' : 'bg-amber-100 text-amber-800'"
            >
              {{ s.status === 'SHIPPED' ? '● 출고 완료' : '○ 출고 대기' }}
            </span>
          </div>

          <!-- Customer & Destination -->
          <div class="p-3 bg-slate-50 rounded-xl space-y-1 text-xs">
            <div class="flex items-center justify-between">
              <span class="font-bold text-slate-900">{{ s.recipient_name }} ({{ s.recipient_phone }})</span>
              <button
                @click="copyAddress(s)"
                class="px-2 py-0.5 bg-white border border-slate-300 rounded text-[10px] text-slate-600 hover:text-indigo-600"
              >
                {{ copyToast === s.id ? '✓ 복사됨' : '주소 복사' }}
              </button>
            </div>
            <p class="text-slate-600 text-[11px]">
              [{{ s.shipping_postal_code || '00000' }}] {{ s.shipping_address_line1 }} {{ s.shipping_address_line2 || '' }}
            </p>
            <p v-if="s.shipping_memo" class="text-[10px] text-indigo-700 font-semibold">
              요청사항: {{ s.shipping_memo }}
            </p>
          </div>

          <!-- Items Ordered -->
          <div v-if="s.items && s.items.length > 0" class="text-[11px] text-slate-500 border-t border-slate-100 pt-2">
            <span class="font-semibold text-slate-700">주문 품목:</span>
            <span v-for="(it, idx) in s.items" :key="it.id" class="ml-1">
              {{ it.sku_id }} ({{ it.quantity }}개){{ idx < s.items.length - 1 ? ',' : '' }}
            </span>
          </div>

          <!-- Carrier & Tracking Controls -->
          <div class="flex flex-col gap-2 pt-2 border-t border-slate-100">
            <div class="flex gap-2">
              <select v-model="s.carrier_code" class="border border-slate-300 rounded-lg px-2.5 py-1.5 text-xs bg-white">
                <option value="CJ대한통운">CJ대한통운</option>
                <option value="우체국택배">우체국택배</option>
                <option value="한진택배">한진택배</option>
                <option value="롯데택배">롯데택배</option>
              </select>
              <input
                v-model="s.tracking_number"
                placeholder="운송장 번호 입력"
                class="flex-1 border border-slate-300 rounded-lg px-3 py-1.5 text-xs font-mono focus:ring-2 focus:ring-indigo-500 focus:outline-none"
              />
            </div>
            <button
              @click="saveTracking(s)"
              :disabled="isSaving === s.id || !s.tracking_number"
              class="w-full py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-bold text-xs shadow-xs transition disabled:opacity-50 cursor-pointer"
            >
              {{ isSaving === s.id ? '처리 중...' : '송장 저장 및 출고 확정' }}
            </button>
          </div>
        </div>
      </div>

      <!-- 2. Desktop Table Layout (visible on screens >= 768px) -->
      <div class="hidden md:block bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
        <table class="w-full text-left text-xs">
          <thead class="bg-slate-50 text-slate-500 uppercase font-bold border-b border-slate-200">
            <tr>
              <th class="py-3 px-4">주문/하위번호</th>
              <th class="py-3 px-4">수령인 / 연락처</th>
              <th class="py-3 px-4">배송지 주소</th>
              <th class="py-3 px-4">택배사</th>
              <th class="py-3 px-4">운송장 번호</th>
              <th class="py-3 px-4">상태</th>
              <th class="py-3 px-4 text-right">출고 등록</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-slate-100">
            <tr v-for="s in filteredShipments" :key="'desk_' + s.id" class="hover:bg-slate-50/80 transition">
              <td class="py-3.5 px-4 font-mono font-bold text-slate-900">
                {{ s.sub_order_no || s.order_no }}
              </td>
              <td class="py-3.5 px-4 font-medium text-slate-800">
                <div>{{ s.recipient_name }}</div>
                <div class="text-[11px] text-slate-400 font-mono">{{ s.recipient_phone }}</div>
              </td>
              <td class="py-3.5 px-4 text-slate-600 max-w-xs">
                <div class="flex items-center gap-1.5">
                  <span class="truncate">[{{ s.shipping_postal_code || '00000' }}] {{ s.shipping_address_line1 }} {{ s.shipping_address_line2 || '' }}</span>
                  <button
                    @click="copyAddress(s)"
                    title="주소 복사"
                    class="shrink-0 text-slate-400 hover:text-indigo-600 text-[11px]"
                  >
                    <i :class="copyToast === s.id ? 'fa-solid fa-check text-emerald-600' : 'fa-regular fa-copy'"></i>
                  </button>
                </div>
                <div v-if="s.shipping_memo" class="text-[10px] text-indigo-600 truncate mt-0.5">
                  메모: {{ s.shipping_memo }}
                </div>
              </td>
              <td class="py-3.5 px-4">
                <select v-model="s.carrier_code" class="border border-slate-300 rounded px-2 py-1 text-xs bg-white">
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
                  class="px-3.5 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-bold text-[11px] shadow-xs transition disabled:opacity-50 cursor-pointer"
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
