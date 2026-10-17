<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { useCartStore } from '../stores/cart';

const router = useRouter();
const cartStore = useCartStore();

const recipientName = ref('홍길동');
const phone = ref('010-9876-5432');
const postalCode = ref('06236');
const addressLine1 = ref('서울특별시 강남구 테헤란로 152');
const addressLine2 = ref('강남파이낸스센터 18층');
const paymentMethod = ref('KAKAOPAY');
const isSubmitting = ref(false);
const errorMessage = ref('');

onMounted(() => {
  if (cartStore.items.length === 0) {
    // If cart is empty, redirect to categories or home
    router.replace('/cart');
  }
});

const handleOrder = async () => {
  if (cartStore.items.length === 0) return;
  isSubmitting.value = true;
  errorMessage.value = '';

  try {
    const payload = {
      customer_id: 'u_customer_001',
      recipient_name: recipientName.value,
      recipient_phone: phone.value,
      shipping_postal_code: postalCode.value,
      shipping_address_line1: addressLine1.value,
      shipping_address_line2: addressLine2.value,
      items: cartStore.items.map(it => ({
        sku_id: it.sku_id,
        product_id: it.product_id,
        title: it.title,
        option_summary: it.option_summary,
        price: it.price,
        quantity: it.quantity,
        partner_id: it.partner_id || 'pt_001'
      }))
    };

    const res = await fetch('https://olmoa-api.dnjstjqppk.workers.dev/api/v1/orders/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const data = await res.json();
    if (res.ok && data.success) {
      const orderId = data.order_id;
      cartStore.clearCart();
      router.push(`/order/${orderId}`);
    } else {
      errorMessage.value = data.error || '주문 처리 중 오류가 발생했습니다.';
    }
  } catch (err: any) {
    errorMessage.value = '네트워크 통신 오류: ' + (err.message || String(err));
  } finally {
    isSubmitting.value = false;
  }
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

    <!-- Ordered items preview -->
    <div class="bg-slate-50 rounded-2xl p-4 border border-slate-200/60 space-y-2">
      <div class="text-xs font-bold text-slate-700">주문 상품 (총 {{ cartStore.totalCount }}개)</div>
      <div class="divide-y divide-slate-200/60 max-h-48 overflow-y-auto">
        <div v-for="it in cartStore.items" :key="it.sku_id" class="py-2 flex items-center justify-between text-xs">
          <div class="flex items-center gap-2.5 truncate max-w-xs sm:max-w-md">
            <img :src="it.thumbnail_url" class="w-8 h-8 rounded-lg object-cover" />
            <span class="truncate font-medium text-slate-800">{{ it.title }} ({{ it.option_summary }}) x {{ it.quantity }}</span>
          </div>
          <span class="font-bold font-mono text-slate-900 shrink-0">₩{{ (it.price * it.quantity).toLocaleString() }}</span>
        </div>
      </div>
    </div>
    
    <div class="space-y-4 text-xs">
      <div class="grid grid-cols-2 gap-3">
        <div>
          <label class="block font-bold text-slate-700 mb-1">수령인</label>
          <input v-model="recipientName" type="text" class="w-full bg-slate-50 p-3 rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-orange-500" />
        </div>
        <div>
          <label class="block font-bold text-slate-700 mb-1">연락처</label>
          <input v-model="phone" type="text" class="w-full bg-slate-50 p-3 rounded-xl border border-slate-300 font-mono focus:outline-none focus:ring-2 focus:ring-orange-500" />
        </div>
      </div>

      <div class="space-y-2">
        <label class="block font-bold text-slate-700">배송 주소</label>
        <div class="grid grid-cols-3 gap-2">
          <input v-model="postalCode" placeholder="우편번호" class="bg-slate-50 p-3 rounded-xl border border-slate-300 font-mono focus:outline-none focus:ring-2 focus:ring-orange-500" />
          <input v-model="addressLine1" placeholder="기본 주소" class="col-span-2 bg-slate-50 p-3 rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-orange-500" />
        </div>
        <input v-model="addressLine2" placeholder="상세 주소 (동/호수)" class="w-full bg-slate-50 p-3 rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-orange-500" />
      </div>

      <div>
        <label class="block font-bold text-slate-700 mb-1">결제 수단</label>
        <div class="grid grid-cols-3 gap-2">
          <button @click="paymentMethod = 'KAKAOPAY'" :class="paymentMethod === 'KAKAOPAY' ? 'bg-amber-400 font-bold border-amber-500 shadow-sm' : 'bg-slate-50'" class="p-3 rounded-xl border text-center transition">카카오페이</button>
          <button @click="paymentMethod = 'TOSSPAY'" :class="paymentMethod === 'TOSSPAY' ? 'bg-blue-600 text-white font-bold shadow-sm' : 'bg-slate-50'" class="p-3 rounded-xl border text-center transition">토스페이</button>
          <button @click="paymentMethod = 'CARD'" :class="paymentMethod === 'CARD' ? 'bg-slate-900 text-white font-bold shadow-sm' : 'bg-slate-50'" class="p-3 rounded-xl border text-center transition">글로벌 신용카드</button>
        </div>
      </div>
    </div>

    <div v-if="errorMessage" class="p-3 bg-rose-50 border border-rose-200 text-rose-700 text-xs rounded-xl font-bold">
      <i class="fa-solid fa-triangle-exclamation mr-1.5"></i>{{ errorMessage }}
    </div>

    <div class="border-t pt-5 flex justify-between items-center">
      <div>
        <div class="text-[11px] text-slate-400">
          최종 결제 금액 (배송비: {{ cartStore.shippingFee === 0 ? '무료' : '₩' + cartStore.shippingFee.toLocaleString() }})
        </div>
        <div class="text-2xl font-black text-orange-600">₩ {{ cartStore.totalPayAmount.toLocaleString() }}</div>
      </div>
      <button 
        @click="handleOrder" 
        :disabled="isSubmitting || cartStore.items.length === 0"
        class="bg-orange-600 hover:bg-orange-700 text-white font-black px-8 py-3.5 rounded-2xl text-sm transition shadow-lg shadow-orange-600/30 disabled:opacity-50"
      >
        <span v-if="isSubmitting"><i class="fa-solid fa-spinner fa-spin mr-2"></i>결제 승인 중...</span>
        <span v-else>즉시 결제 승인 &rarr;</span>
      </button>
    </div>
  </div>
</template>
