<script setup lang="ts">
import { useCartStore } from '../stores/cart';
import { useRouter } from 'vue-router';

const cartStore = useCartStore();
const router = useRouter();

function handleCheckout() {
  if (cartStore.items.length === 0) return;
  router.push('/checkout');
}
</script>

<template>
  <div class="max-w-4xl mx-auto space-y-6">
    <div class="flex items-center justify-between border-b border-slate-200 pb-4">
      <div>
        <h1 class="text-xl sm:text-2xl font-black text-slate-900">장바구니 ({{ cartStore.totalCount }}개)</h1>
        <p class="text-xs text-slate-500 mt-0.5">내가 찾는 모든 것, 여기! 올모아 직배송 장바구니</p>
      </div>
      <button 
        v-if="cartStore.items.length > 0" 
        @click="cartStore.clearCart" 
        class="text-xs text-slate-400 hover:text-rose-600 transition"
      >
        전체 비우기
      </button>
    </div>

    <!-- Free shipping status banner -->
    <div class="bg-amber-50 border border-amber-200 rounded-2xl p-4 flex items-center justify-between text-xs">
      <div class="flex items-center gap-2">
        <i class="fa-solid fa-truck-fast text-orange-600 text-base"></i>
        <span v-if="cartStore.freeShippingRemaining === 0" class="font-bold text-emerald-700">
          🎉 축하합니다! 전 품목 100% 무료배송 혜택이 적용되었습니다.
        </span>
        <span v-else class="text-slate-700">
          <strong>₩{{ cartStore.freeShippingRemaining.toLocaleString() }}</strong> 추가 주문 시 <strong>무료배송!</strong>
        </span>
      </div>
      <router-link to="/categories" class="font-bold text-orange-600 hover:underline shrink-0">
        더 둘러보기 &rarr;
      </router-link>
    </div>

    <!-- Empty State -->
    <div v-if="cartStore.items.length === 0" class="bg-white rounded-3xl p-16 text-center border border-slate-200 space-y-4">
      <i class="fa-solid fa-cart-arrow-down text-5xl text-slate-300"></i>
      <h3 class="font-bold text-slate-800 text-base">장바구니에 담긴 상품이 없습니다.</h3>
      <p class="text-xs text-slate-400">초특가 번개세일과 다양한 글로벌 상품을 지금 확인해 보세요.</p>
      <router-link to="/" class="inline-block px-6 py-3 bg-orange-600 text-white text-xs font-black rounded-2xl shadow-lg shadow-orange-600/30">
        인기 특가 상품 쇼핑하기 &rarr;
      </router-link>
    </div>

    <!-- Cart Items Grid + Order Summary -->
    <div v-else class="grid grid-cols-1 md:grid-cols-3 gap-6">
      <!-- Items List -->
      <div class="md:col-span-2 space-y-3">
        <div 
          v-for="item in cartStore.items" 
          :key="item.sku_id" 
          class="bg-white rounded-2xl p-4 border border-slate-200 shadow-sm flex gap-4 items-center"
        >
          <img :src="item.thumbnail_url" :alt="item.title" class="w-20 h-20 rounded-xl object-cover bg-slate-100 shrink-0" />
          <div class="flex-1 min-w-0 space-y-1">
            <h4 class="font-bold text-slate-900 text-xs sm:text-sm line-clamp-1">{{ item.title }}</h4>
            <div class="text-[11px] text-slate-400 font-medium">옵션: {{ item.option_summary }}</div>
            <div class="flex items-baseline gap-2">
              <span class="font-black text-orange-600 text-sm">₩{{ item.price.toLocaleString() }}</span>
              <span v-if="item.original_price > item.price" class="text-[10px] text-slate-400 line-through">
                ₩{{ item.original_price.toLocaleString() }}
              </span>
            </div>
          </div>

          <!-- Quantity Counter & Delete -->
          <div class="flex flex-col items-end gap-2 shrink-0">
            <button @click="cartStore.removeItem(item.sku_id)" class="text-slate-300 hover:text-rose-500 text-xs">
              <i class="fa-solid fa-trash-can"></i>
            </button>
            <div class="inline-flex items-center border border-slate-200 rounded-lg overflow-hidden text-xs">
              <button @click="cartStore.updateQuantity(item.sku_id, item.quantity - 1)" class="px-2 py-0.5 bg-slate-50 hover:bg-slate-100">-</button>
              <span class="px-3 py-0.5 font-bold font-mono">{{ item.quantity }}</span>
              <button @click="cartStore.updateQuantity(item.sku_id, item.quantity + 1)" class="px-2 py-0.5 bg-slate-50 hover:bg-slate-100">+</button>
            </div>
          </div>
        </div>
      </div>

      <!-- Order Summary Card -->
      <div class="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm space-y-4 h-fit">
        <h3 class="font-bold text-slate-900 text-sm border-b pb-3">결제 예상 금액</h3>
        
        <div class="space-y-2 text-xs">
          <div class="flex justify-between text-slate-600">
            <span>상품 금액</span>
            <span class="font-bold">₩{{ cartStore.totalGoodsAmount.toLocaleString() }}</span>
          </div>
          <div class="flex justify-between text-slate-600">
            <span>배송비</span>
            <span :class="cartStore.shippingFee === 0 ? 'text-emerald-600 font-bold' : 'font-bold'">
              {{ cartStore.shippingFee === 0 ? '무료' : '₩' + cartStore.shippingFee.toLocaleString() }}
            </span>
          </div>
          <div class="flex justify-between text-slate-600">
            <span>글로벌 직구 관부가세</span>
            <span class="text-emerald-600 font-bold">면세 범위</span>
          </div>
          <div class="border-t pt-3 flex justify-between items-baseline">
            <span class="font-bold text-slate-800">최종 결제 금액</span>
            <span class="text-xl font-black text-orange-600">₩{{ cartStore.totalPayAmount.toLocaleString() }}</span>
          </div>
        </div>

        <button 
          @click="handleCheckout" 
          class="w-full py-3.5 bg-orange-600 hover:bg-orange-700 text-white font-black rounded-xl text-xs sm:text-sm transition shadow-lg shadow-orange-600/30 flex items-center justify-center gap-2"
        >
          <span>주문서 작성하기 ({{ cartStore.totalCount }}개)</span>
          <i class="fa-solid fa-arrow-right"></i>
        </button>

        <div class="text-[11px] text-slate-400 space-y-1">
          <div><i class="fa-solid fa-shield-halved text-emerald-500 mr-1"></i>OLMOA 에스크로 100% 안심 결제</div>
          <div><i class="fa-solid fa-rotate-left text-sky-500 mr-1"></i>수령 후 90일 이내 무조건 무료 반품</div>
        </div>
      </div>
    </div>
  </div>
</template>
