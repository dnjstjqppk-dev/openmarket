<script setup lang="ts">
import { ref } from 'vue';

interface OrderItem {
  id: string;
  date: string;
  product: string;
  total: number;
  status: string;
  tracking: string;
}

const orders = ref<OrderItem[]>([
  {
    id: 'ORD-2026-98124',
    date: '2026-10-15',
    product: 'Anker Soundcore Space Q45 ANC 헤드폰 (블랙)',
    total: 49900,
    status: '배송중 (출고 완료)',
    tracking: 'CJ대한통운 6891024819'
  }
]);
</script>

<template>
  <div class="max-w-3xl mx-auto space-y-4">
    <h2 class="text-xl font-black text-gray-900 border-b pb-3">내 주문 및 배송 현황</h2>
    
    <div v-for="ord in orders" :key="ord.id" class="bg-white rounded-2xl p-5 border border-gray-200 shadow-sm space-y-3 text-xs">
      <div class="flex justify-between font-mono text-gray-500 text-[11px] border-b pb-2">
        <span>주문번호: {{ ord.id }}</span>
        <span>주문일자: {{ ord.date }}</span>
      </div>
      <div class="font-bold text-gray-900 text-sm">{{ ord.product }}</div>
      <div class="flex justify-between items-center pt-2">
        <span class="text-base font-black text-red-600">₩ {{ ord.total.toLocaleString() }}</span>
        <span class="bg-blue-100 text-blue-800 font-bold px-3 py-1 rounded-full text-[11px]">
          {{ ord.status }} ({{ ord.tracking }})
        </span>
      </div>
    </div>
  </div>
</template>
