<script setup lang="ts">
import { ref } from 'vue';
import { useRouter } from 'vue-router';

const router = useRouter();
const recipientName = ref('홍길동');
const phone = ref('010-9876-5432');
const address = ref('서울특별시 강남구 테헤란로 152 강남파이낸스센터 18층');
const paymentMethod = ref('KAKAOPAY');
const orderCompleted = ref(false);

const handleOrder = () => {
  orderCompleted.value = true;
  setTimeout(() => {
    router.push('/orders');
  }, 1500);
};
</script>

<template>
  <div class="max-w-2xl mx-auto bg-white rounded-2xl p-6 border border-gray-200 shadow-sm space-y-6">
    <h2 class="text-xl font-black text-gray-900 border-b pb-3">📦 주문서 작성 및 결제</h2>
    
    <div class="space-y-4 text-xs">
      <div>
        <label class="block font-bold text-gray-700 mb-1">수령인</label>
        <input v-model="recipientName" type="text" class="w-full bg-gray-50 p-2.5 rounded-lg border" />
      </div>
      <div>
        <label class="block font-bold text-gray-700 mb-1">연락처</label>
        <input v-model="phone" type="text" class="w-full bg-gray-50 p-2.5 rounded-lg border font-mono" />
      </div>
      <div>
        <label class="block font-bold text-gray-700 mb-1">배송 주소</label>
        <input v-model="address" type="text" class="w-full bg-gray-50 p-2.5 rounded-lg border" />
      </div>
      <div>
        <label class="block font-bold text-gray-700 mb-1">결제 수단</label>
        <div class="grid grid-cols-3 gap-2">
          <button @click="paymentMethod = 'KAKAOPAY'" :class="paymentMethod === 'KAKAOPAY' ? 'bg-yellow-400 font-bold border-yellow-500' : 'bg-gray-50'" class="p-3 rounded-lg border text-center transition">카카오페이</button>
          <button @click="paymentMethod = 'TOSSPAY'" :class="paymentMethod === 'TOSSPAY' ? 'bg-blue-600 text-white font-bold' : 'bg-gray-50'" class="p-3 rounded-lg border text-center transition">토스페이</button>
          <button @click="paymentMethod = 'CARD'" :class="paymentMethod === 'CARD' ? 'bg-gray-900 text-white font-bold' : 'bg-gray-50'" class="p-3 rounded-lg border text-center transition">신용카드</button>
        </div>
      </div>
    </div>

    <div class="border-t pt-4 flex justify-between items-center">
      <span class="text-xl font-black text-red-600">₩ 49,900</span>
      <button @click="handleOrder" class="bg-red-600 hover:bg-red-700 text-white font-bold px-8 py-3 rounded-xl text-sm transition">
        결제 승인
      </button>
    </div>

    <div v-if="orderCompleted" class="p-3 bg-green-50 border border-green-200 text-green-900 text-xs rounded-xl text-center">
      ✓ 주문이 성공적으로 승인되었습니다. 주문 내역 화면으로 이동합니다.
    </div>
  </div>
</template>
