<script setup lang="ts">
import { ref, computed } from 'vue';

const searchQuery = ref('');
const currency = ref('KRW');
const cartOpen = ref(false);

interface CartItem {
  id: string;
  brand: string;
  name: string;
  price: number;
  qty: number;
}

const cart = ref<CartItem[]>([
  { id: 'sku-1', brand: 'Anker Official', name: 'Soundcore Space Q45 ANC 헤드폰', price: 49900, qty: 1 }
]);

const cartCount = computed(() => cart.value.reduce((sum, item) => sum + item.qty, 0));
const subTotal = computed(() => cart.value.reduce((sum, item) => sum + (item.price * item.qty), 0));
</script>

<template>
  <div class="min-h-screen flex flex-col bg-gray-50 text-gray-900 font-sans">
    <!-- Top Global Banner -->
    <div class="bg-gradient-to-r from-red-600 via-orange-600 to-amber-500 text-white text-xs font-semibold py-1.5 px-4 text-center">
      <span>⚡ 신규 회원 10만원 쿠폰팩 즉시 증정 & 3만원 이상 전 상품 무료배송 (90일 무조건 무료 반품)</span>
    </div>

    <!-- Main Header -->
    <header class="bg-white border-b border-gray-200 sticky top-0 z-40 shadow-sm">
      <div class="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between gap-4">
        <router-link to="/" class="text-2xl sm:text-3xl font-black text-red-600 tracking-tighter">
          OPENMARKET
        </router-link>
        <!-- Search -->
        <div class="flex-1 max-w-2xl relative">
          <input
            v-model="searchQuery"
            type="text"
            placeholder="수천만 개 글로벌 초특가 상품을 검색하세요..."
            class="w-full text-xs bg-gray-100 border border-gray-300 rounded-full py-2.5 pl-4 pr-12 focus:bg-white focus:outline-none focus:ring-2 focus:ring-red-500"
          />
          <button class="absolute right-2 top-2 bg-red-600 hover:bg-red-700 text-white w-7 h-7 rounded-full flex items-center justify-center text-xs">
            🔍
          </button>
        </div>
        <!-- Actions -->
        <div class="flex items-center gap-3 sm:gap-4 text-xs font-medium">
          <select v-model="currency" class="bg-gray-100 text-gray-700 rounded px-2 py-1 text-xs border border-gray-300">
            <option value="KRW">₩ KRW</option>
            <option value="USD">$ USD</option>
            <option value="JPY">¥ JPY</option>
          </select>
          <router-link to="/orders" class="text-gray-700 hover:text-red-600 flex items-center gap-1">
            <span>📦</span><span class="hidden sm:inline">주문배송</span>
          </router-link>
          <button @click="cartOpen = true" class="bg-red-600 hover:bg-red-700 text-white px-3.5 py-1.5 rounded-full flex items-center gap-1.5 font-bold shadow-sm">
            <span>🛒</span><span class="hidden sm:inline">장바구니</span>
            <span class="bg-white text-red-600 text-[11px] px-1.5 py-0.2 rounded-full">{{ cartCount }}</span>
          </button>
        </div>
      </div>
    </header>

    <!-- Page Content via Vue Router -->
    <main class="flex-1 max-w-7xl mx-auto px-4 py-6 w-full">
      <router-view />
    </main>

    <!-- Cart Slide-Over -->
    <div v-if="cartOpen" class="fixed inset-0 z-50 overflow-hidden bg-black/50 flex justify-end" @click.self="cartOpen = false">
      <div class="w-full max-w-md bg-white h-full shadow-2xl flex flex-col justify-between p-5">
        <div>
          <div class="flex items-center justify-between border-b pb-3">
            <h3 class="font-bold text-sm text-gray-900">장바구니 ({{ cart.length }})</h3>
            <button @click="cartOpen = false" class="text-gray-400 hover:text-gray-700">✕</button>
          </div>
          <div class="mt-3 space-y-3 overflow-y-auto max-h-[65vh]">
            <div v-for="(item, idx) in cart" :key="item.id" class="p-3 bg-gray-50 rounded-xl border border-gray-200 text-xs flex justify-between items-center">
              <div>
                <span class="text-[10px] font-bold text-blue-600">{{ item.brand }}</span>
                <div class="font-bold text-gray-800">{{ item.name }}</div>
                <div class="text-red-600 font-black mt-0.5">₩ {{ (item.price * item.qty).toLocaleString() }}</div>
              </div>
              <div class="flex items-center gap-2">
                <span class="font-mono text-gray-600">수량: {{ item.qty }}</span>
                <button @click="cart.splice(idx, 1)" class="text-gray-400 hover:text-red-600">🗑</button>
              </div>
            </div>
          </div>
        </div>
        <div class="border-t pt-4 space-y-2 text-xs">
          <div class="flex justify-between font-black text-sm text-gray-900">
            <span>총 결제금액</span>
            <span class="text-red-600 font-mono text-base">₩ {{ subTotal.toLocaleString() }}</span>
          </div>
          <router-link to="/checkout" @click="cartOpen = false" class="block text-center w-full bg-red-600 hover:bg-red-700 text-white font-bold py-3 rounded-xl text-sm transition mt-2">
            주문서 작성 및 결제
          </router-link>
        </div>
      </div>
    </div>

    <!-- Global Footer -->
    <footer class="bg-white border-t border-gray-200 text-xs text-gray-500 py-8">
      <div class="max-w-7xl mx-auto px-4 space-y-2">
        <div class="flex flex-wrap gap-4 text-gray-700 font-medium">
          <a href="#" class="hover:underline">회사소개</a>
          <a href="#" class="hover:underline">이용약관</a>
          <a href="#" class="hover:underline font-bold text-gray-900">개인정보처리방침</a>
          <a href="#" class="hover:underline">고객센터</a>
        </div>
        <div class="text-[11px] leading-relaxed">
          (주)오픈마켓 | 대표이사: 홍길동 | 사업자등록번호: 214-88-01928 | 통신판매업신고: 제2026-서울강남-01928호
        </div>
        <div class="text-[10px] text-gray-400">© 2026 OpenMarket Global Platform. Powered by Vue 3 + TypeScript.</div>
      </div>
    </footer>
  </div>
</template>
