<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { API_BASE_URL, getAuthHeaders } from '../config';

const orders = ref<any[]>([]);
const loading = ref(true);

onMounted(async () => {
  try {
    const res = await fetch(`${API_BASE_URL}/api/v1/orders`, {
      headers: getAuthHeaders()
    });
    const json = await res.json();
    if (json.success && json.data) {
      orders.value = json.data;
    }
  } catch (_) {
  } finally {
    loading.value = false;
  }
});
</script>

<template>
  <div class="max-w-3xl mx-auto space-y-5">
    <div class="border-b border-slate-200 pb-3 flex items-center justify-between">
      <div>
        <h2 class="text-xl font-black text-slate-900">내 주문 및 배송 조회</h2>
        <p class="text-xs text-slate-500 mt-0.5">올모아(OLMOA)에서 주문하신 모든 내역을 실시간으로 추적합니다.</p>
      </div>
      <router-link to="/" class="text-xs text-orange-600 font-bold hover:underline">
        쇼핑 계속하기 &rarr;
      </router-link>
    </div>

    <div v-if="loading" class="p-16 text-center text-slate-400">
      <i class="fa-solid fa-spinner fa-spin text-3xl mb-3 text-orange-500"></i>
      <p class="text-xs font-bold">주문 내역을 불러오는 중입니다...</p>
    </div>
    
    <div v-else-if="orders.length === 0" class="bg-white rounded-3xl p-16 text-center border border-slate-200 space-y-3">
      <i class="fa-solid fa-clipboard-list text-5xl text-slate-300"></i>
      <h3 class="font-bold text-slate-700">주문 내역이 없습니다.</h3>
      <p class="text-xs text-slate-400">올모아의 특별한 글로벌 핫딜 상품을 만나보세요.</p>
      <router-link to="/" class="inline-block mt-2 px-6 py-2.5 bg-orange-600 text-white text-xs font-bold rounded-xl shadow-md">
        상품 둘러보기
      </router-link>
    </div>

    <div v-else class="space-y-4">
      <div 
        v-for="ord in orders" 
        :key="ord.id" 
        class="bg-white rounded-3xl p-6 border border-slate-200 shadow-sm space-y-4 text-xs"
      >
        <div class="flex justify-between font-mono text-slate-500 text-[11px] border-b border-slate-100 pb-3">
          <span>주문번호: <strong class="text-slate-800">{{ ord.order_no }}</strong></span>
          <span>주문일시: {{ ord.created_at }}</span>
        </div>

        <div class="space-y-3">
          <div v-for="sub in ord.sub_orders" :key="sub.id" class="bg-slate-50/70 p-3 rounded-2xl space-y-2 border border-slate-100">
            <div class="flex items-center justify-between text-[11px]">
              <span class="font-bold text-slate-700">판매자: {{ sub.business_name || 'OLMOA Direct' }}</span>
              <span 
                class="px-2.5 py-0.5 rounded-full font-bold text-[10px]"
                :class="sub.status === 'SHIPPED' ? 'bg-sky-100 text-sky-700' : 'bg-amber-100 text-amber-700'"
              >
                {{ sub.status === 'SHIPPED' ? '출고완료 (배송중)' : '상품 준비중' }}
              </span>
            </div>

            <div v-for="it in sub.items" :key="it.id" class="flex justify-between items-center text-xs">
              <span class="font-medium text-slate-800">{{ it.product_title }} ({{ it.option_summary }}) x {{ it.quantity }}</span>
              <span class="font-bold font-mono text-slate-900">₩{{ it.total_price.toLocaleString() }}</span>
            </div>

            <div v-if="sub.tracking_number" class="text-[11px] text-slate-500 font-mono pt-1 border-t border-slate-200/50">
              운송장: {{ sub.carrier_code || 'CJ대한통운' }} {{ sub.tracking_number }}
            </div>
          </div>
        </div>

        <div class="flex justify-between items-center pt-3 border-t border-slate-100">
          <div>
            <span class="text-slate-400 text-[11px]">총 결제금액: </span>
            <span class="text-base font-black text-orange-600">₩ {{ ord.total_pay_amount?.toLocaleString() }}</span>
          </div>
          <router-link :to="'/order/' + ord.id" class="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl font-bold text-xs transition">
            주문 상세 보기 &rarr;
          </router-link>
        </div>
      </div>
    </div>
  </div>
</template>
