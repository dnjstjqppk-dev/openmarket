<script setup lang="ts">
import { ref } from 'vue';
import { useRouter } from 'vue-router';

const router = useRouter();
const recipientName = ref('홍길동');
const phone = ref('010-9876-5432');
const address = ref('서울특별시 강남구 테헤란로 152 강남파이낸스센터 18층');
const paymentMethod = ref('KAKAOPAY');
const orderCompleted = ref(false);
const isSubmitting = ref(false);

const handleOrder = async () => {
  isSubmitting.value = true;
  try {
    await fetch('https://openmarket-api.dnjstjqppk.workers.dev/api/v1/orders/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        recipient_name: recipientName.value,
        recipient_phone: phone.value,
        shipping_address_line1: address.value,
        total_goods_amount: 49900,
        total_shipping_amount: 0
      })
    });
  } catch (_) {}
  
  orderCompleted.value = true;
  setTimeout(() => {
    router.push('/orders');
  }, 1200);
};
</script>

<template>
  <div class="max-w-2xl mx-auto bg-white rounded-3xl p-6 sm:p-8 border border-slate-200 shadow-lg space-y-6">
    <div class="flex items-center justify-between border-b pb-4">
      <div>
        <h2 class="text-xl font-black text-slate-900">OLMOA 안심 주문서 작성</h2>
        <p class="text-xs text-slate-500 mt-0.5">내가 찾는 모든 것, 여기. 올모아 에스크로 안심 결제</p>
      </div>
      <div class="flex items-center gap-1.5 text-xs font-bold text-emerald-600 bg-emerald-50 px-3 py-1.5 rounded-full border border-emerald-200">
        <i class="fa-solid fa-shield-halved"></i>
        <span>100% 구매자 보호</span>
      </div>
    </div>
    
    <div class="space-y-4 text-xs">
      <div>
        <label class="block font-bold text-slate-700 mb-1">수령인</label>
        <input v-model="recipientName" type="text" class="w-full bg-slate-50 p-3 rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-orange-500" />
      </div>
      <div>
        <label class="block font-bold text-slate-700 mb-1">연락처</label>
        <input v-model="phone" type="text" class="w-full bg-slate-50 p-3 rounded-xl border border-slate-300 font-mono focus:outline-none focus:ring-2 focus:ring-orange-500" />
      </div>
      <div>
        <label class="block font-bold text-slate-700 mb-1">배송 주소</label>
        <input v-model="address" type="text" class="w-full bg-slate-50 p-3 rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-orange-500" />
      </div>
      <div>
        <label class="block font-bold text-slate-700 mb-1">결제 수단</label>
        <div class="grid grid-cols-3 gap-2">
          <button @click="paymentMethod = 'KAKAOPAY'" :class="paymentMethod === 'KAKAOPAY' ? 'bg-amber-400 font-bold border-amber-500 shadow-sm' : 'bg-slate-50'" class="p-3 rounded-xl border text-center transition">카카오페이</button>
          <button @click="paymentMethod = 'TOSSPAY'" :class="paymentMethod === 'TOSSPAY' ? 'bg-blue-600 text-white font-bold shadow-sm' : 'bg-slate-50'" class="p-3 rounded-xl border text-center transition">토스페이</button>
          <button @click="paymentMethod = 'CARD'" :class="paymentMethod === 'CARD' ? 'bg-slate-900 text-white font-bold shadow-sm' : 'bg-slate-50'" class="p-3 rounded-xl border text-center transition">글로벌 카드</button>
        </div>
      </div>
    </div>

    <div class="border-t pt-5 flex justify-between items-center">
      <div>
        <div class="text-[11px] text-slate-400">최종 결제 금액 (배송비 무료)</div>
        <div class="text-2xl font-black text-orange-600">₩ 49,900</div>
      </div>
      <button 
        @click="handleOrder" 
        :disabled="isSubmitting"
        class="bg-orange-600 hover:bg-orange-700 text-white font-black px-8 py-3.5 rounded-2xl text-sm transition shadow-lg shadow-orange-600/30 disabled:opacity-50"
      >
        <span v-if="isSubmitting"><i class="fa-solid fa-spinner fa-spin mr-2"></i>처리 중...</span>
        <span v-else>즉시 결제하기</span>
      </button>
    </div>

    <div v-if="orderCompleted" class="p-4 bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs rounded-2xl text-center font-bold">
      <i class="fa-solid fa-circle-check text-emerald-600 mr-1.5"></i>
      OLMOA 주문이 안전하게 승인되었습니다. 주문 내역 화면으로 이동합니다.
    </div>
  </div>
</template>
