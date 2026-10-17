<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useRoute } from 'vue-router';
import { API_BASE_URL, getAuthHeaders } from '../config';

const route = useRoute();
const order = ref<any>(null);
const loading = ref(true);

onMounted(async () => {
  const ordId = route.params.id as string;
  try {
    const res = await fetch(`${API_BASE_URL}/api/v1/orders/${ordId}`, {
      headers: getAuthHeaders()
    });
    const json = await res.json();
    if (json.success && json.data) {
      order.value = json.data;
    }
  } catch (_) {
  } finally {
    loading.value = false;
  }
});
</script>

<template>
  <div class="max-w-3xl mx-auto space-y-6">
    <div v-if="loading" class="p-16 text-center text-slate-400">
      <i class="fa-solid fa-spinner fa-spin text-3xl mb-3 text-orange-500"></i>
      <p class="text-xs font-bold">주문 정보를 불러오는 중입니다...</p>
    </div>

    <div v-else-if="!order" class="bg-white rounded-3xl p-12 text-center border border-slate-200 space-y-3">
      <i class="fa-solid fa-file-circle-question text-4xl text-slate-300"></i>
      <h3 class="font-bold text-slate-800">주문 내역을 찾을 수 없습니다.</h3>
      <router-link to="/orders" class="inline-block mt-2 px-5 py-2.5 bg-orange-600 text-white text-xs font-bold rounded-xl shadow-md">
        내 전체 주문 내역 보기
      </router-link>
    </div>

    <div v-else class="space-y-6">
      <!-- Order Header Banner -->
      <div class="bg-white rounded-3xl p-6 border border-slate-200 shadow-sm space-y-3">
        <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100 pb-3">
          <div>
            <div class="inline-flex items-center gap-1.5 text-xs font-bold text-emerald-600 bg-emerald-50 px-3 py-1 rounded-full mb-1">
              <i class="fa-solid fa-circle-check"></i>
              <span>결제 및 주문 승인 완료</span>
            </div>
            <h1 class="text-xl font-black text-slate-900">주문번호: {{ order.order_no }}</h1>
          </div>
          <div class="text-xs text-slate-500 font-mono">
            주문일시: {{ order.created_at }}
          </div>
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs text-slate-600 pt-1">
          <div>
            <h4 class="font-bold text-slate-800 mb-1">배송지 정보</h4>
            <p><strong>수령인:</strong> {{ order.recipient_name }} ({{ order.recipient_phone }})</p>
            <p><strong>주소:</strong> ({{ order.shipping_postal_code }}) {{ order.shipping_address_line1 }} {{ order.shipping_address_line2 }}</p>
          </div>
          <div class="sm:text-right">
            <h4 class="font-bold text-slate-800 mb-1">결제 내역</h4>
            <p>상품금액: ₩{{ order.total_goods_amount?.toLocaleString() }}</p>
            <p>배송비: ₩{{ order.total_shipping_amount?.toLocaleString() }}</p>
            <p class="text-sm font-black text-orange-600 mt-1">총 결제금액: ₩{{ order.total_pay_amount?.toLocaleString() }}</p>
          </div>
        </div>
      </div>

      <!-- Sub-Orders by Partner -->
      <div class="space-y-4">
        <h3 class="text-sm font-bold text-slate-800">판매자별 출고 및 배송 현황</h3>
        <div 
          v-for="sub in order.sub_orders" 
          :key="sub.id" 
          class="bg-white rounded-2xl p-5 border border-slate-200 shadow-sm space-y-3"
        >
          <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100 pb-3 text-xs">
            <div>
              <span class="text-slate-400 font-medium">판매 파트너: </span>
              <strong class="text-slate-800">{{ sub.business_name || 'OLMOA Direct' }}</strong>
              <span class="ml-2 font-mono text-slate-400">({{ sub.sub_order_no }})</span>
            </div>
            <div class="flex items-center gap-2">
              <span 
                class="px-3 py-1 rounded-full font-bold text-[11px]"
                :class="sub.status === 'SHIPPED' ? 'bg-sky-50 text-sky-700 border border-sky-200' : 'bg-amber-50 text-amber-700 border border-amber-200'"
              >
                <i class="fa-solid fa-truck mr-1"></i>
                {{ sub.status === 'SHIPPED' ? '출고완료 (배송중)' : '상품 준비중' }}
              </span>
              <span v-if="sub.tracking_number" class="text-slate-600 font-mono">
                {{ sub.carrier_code || 'CJ대한통운' }} {{ sub.tracking_number }}
              </span>
            </div>
          </div>

          <div class="divide-y divide-slate-100">
            <div v-for="it in sub.items" :key="it.id" class="py-2.5 flex items-center justify-between text-xs">
              <div class="space-y-0.5">
                <div class="font-bold text-slate-900">{{ it.product_title }}</div>
                <div class="text-slate-400 text-[11px]">옵션: {{ it.option_summary }} | 수량: {{ it.quantity }}개</div>
              </div>
              <div class="font-bold text-slate-800 font-mono">
                ₩{{ it.total_price.toLocaleString() }}
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Action Footer -->
      <div class="flex justify-between items-center pt-2">
        <router-link to="/orders" class="text-xs font-bold text-slate-600 hover:text-slate-900">
          &larr; 전체 주문 내역으로
        </router-link>
        <router-link to="/" class="px-6 py-2.5 bg-orange-600 hover:bg-orange-700 text-white text-xs font-bold rounded-xl shadow-md">
          쇼핑 계속하기 &rarr;
        </router-link>
      </div>
    </div>
  </div>
</template>
