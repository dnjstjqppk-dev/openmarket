<script setup lang="ts">
import { ref, onMounted, computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useCartStore } from '../stores/cart';

const route = useRoute();
const router = useRouter();
const cartStore = useCartStore();

const product = ref<any>(null);
const loading = ref(true);
const selectedSku = ref<any>(null);
const quantity = ref(1);
const addedToCart = ref(false);

const discountRate = computed(() => {
  if (!product.value || product.value.lowest_original_price <= 0) return 0;
  return Math.round(((product.value.lowest_original_price - product.value.lowest_sale_price) / product.value.lowest_original_price) * 100);
});

onMounted(async () => {
  const prodId = route.params.id as string;
  try {
    const res = await fetch(`https://olmoa-api.dnjstjqppk.workers.dev/api/v1/products/${prodId}`);
    const json = await res.json();
    if (json.success && json.data) {
      product.value = json.data;
      if (json.data.skus && json.data.skus.length > 0) {
        selectedSku.value = json.data.skus[0];
      }
    }
  } catch (_) {
  } finally {
    loading.value = false;
  }
});

function handleAddToCart() {
  if (!product.value) return;
  cartStore.addItem(product.value, selectedSku.value, quantity.value);
  addedToCart.value = true;
  setTimeout(() => { addedToCart.value = false; }, 2500);
}

function handleBuyNow() {
  if (!product.value) return;
  cartStore.addItem(product.value, selectedSku.value, quantity.value);
  router.push('/checkout');
}
</script>

<template>
  <div class="max-w-5xl mx-auto space-y-6">
    <div v-if="loading" class="p-12 text-center text-slate-400">
      <i class="fa-solid fa-spinner fa-spin text-3xl mb-3 text-orange-500"></i>
      <p class="text-xs font-bold">상품 정보를 실시간 불러오는 중...</p>
    </div>

    <div v-else-if="!product" class="p-12 text-center bg-white rounded-3xl border border-slate-200">
      <i class="fa-solid fa-triangle-exclamation text-3xl text-amber-500 mb-2"></i>
      <h3 class="font-bold text-slate-800">상품을 찾을 수 없습니다.</h3>
      <router-link to="/" class="mt-4 inline-block px-5 py-2 bg-orange-600 text-white rounded-xl text-xs font-bold">쇼핑 계속하기</router-link>
    </div>

    <div v-else class="bg-white rounded-3xl p-6 sm:p-10 border border-slate-200 shadow-sm grid grid-cols-1 md:grid-cols-2 gap-8">
      <!-- Left: Thumbnail -->
      <div class="space-y-4">
        <div class="aspect-square rounded-2xl overflow-hidden bg-slate-100 border border-slate-100 shadow-inner">
          <img :src="product.thumbnail_url" :alt="product.title" class="w-full h-full object-cover hover:scale-105 transition duration-300" />
        </div>
        <div class="flex items-center gap-2 text-xs font-bold text-emerald-700 bg-emerald-50 px-4 py-2.5 rounded-xl border border-emerald-100">
          <i class="fa-solid fa-truck-fast"></i>
          <span>전국 100% 무료 직배송 (3만원 이상 주문 시) & 90일 무료 반품</span>
        </div>
      </div>

      <!-- Right: Details -->
      <div class="space-y-5">
        <div>
          <span class="text-[11px] font-bold text-orange-600 bg-orange-50 px-2.5 py-1 rounded-full uppercase">
            {{ product.category_name || 'OLMOA 직구' }}
          </span>
          <h1 class="text-xl sm:text-2xl font-black text-slate-900 mt-2 leading-snug">{{ product.title }}</h1>
          <p class="text-xs text-slate-400 mt-1">판매자: <strong class="text-slate-700">{{ product.business_name || 'OLMOA Direct Partner' }}</strong></p>
        </div>

        <div class="flex items-baseline gap-3 border-y border-slate-100 py-3">
          <span class="text-3xl font-black text-orange-600">₩{{ product.lowest_sale_price.toLocaleString() }}</span>
          <span class="text-base text-slate-400 line-through">₩{{ product.lowest_original_price.toLocaleString() }}</span>
          <span class="text-sm font-extrabold text-rose-500 bg-rose-50 px-2 py-0.5 rounded-md">-{{ discountRate }}%</span>
        </div>

        <!-- Sold count & rating -->
        <div class="flex items-center gap-4 text-xs text-slate-500">
          <div class="flex items-center text-amber-500 font-bold gap-1">
            <i class="fa-solid fa-star"></i>
            <span>4.9</span>
          </div>
          <span>누적 판매 <strong class="text-slate-800">{{ product.total_sold_count.toLocaleString() }}</strong>개</span>
          <span class="text-emerald-600 font-bold"><i class="fa-solid fa-shield-halved mr-1"></i>정품 보증</span>
        </div>

        <!-- SKU Options -->
        <div v-if="product.skus && product.skus.length > 0" class="space-y-2">
          <label class="block text-xs font-bold text-slate-700">옵션 선택 (SKU)</label>
          <div class="flex flex-wrap gap-2">
            <button 
              v-for="sku in product.skus" 
              :key="sku.id"
              @click="selectedSku = sku"
              :class="selectedSku?.id === sku.id ? 'border-orange-600 bg-orange-50 text-orange-700 font-bold' : 'border-slate-200 text-slate-700 hover:border-slate-300'"
              class="px-3.5 py-2 rounded-xl border text-xs transition"
            >
              {{ sku.sku_code }} (재고: {{ sku.stock_quantity }}개)
            </button>
          </div>
        </div>

        <!-- Quantity counter -->
        <div class="flex items-center gap-3">
          <label class="text-xs font-bold text-slate-700">수량</label>
          <div class="inline-flex items-center border border-slate-300 rounded-xl overflow-hidden text-xs">
            <button @click="quantity > 1 && quantity--" class="px-3 py-1.5 bg-slate-50 hover:bg-slate-100">-</button>
            <span class="px-4 py-1.5 font-bold font-mono">{{ quantity }}</span>
            <button @click="quantity++" class="px-3 py-1.5 bg-slate-50 hover:bg-slate-100">+</button>
          </div>
        </div>

        <!-- Actions -->
        <div class="pt-2 flex gap-3">
          <button 
            @click="handleAddToCart"
            class="flex-1 py-3.5 px-6 rounded-2xl bg-amber-400 hover:bg-amber-500 text-slate-900 font-black text-xs sm:text-sm transition shadow-md"
          >
            <i class="fa-solid fa-cart-shopping mr-2"></i>장바구니 담기
          </button>
          <button 
            @click="handleBuyNow"
            class="flex-1 py-3.5 px-6 rounded-2xl bg-orange-600 hover:bg-orange-700 text-white font-black text-xs sm:text-sm transition shadow-lg shadow-orange-600/30"
          >
            즉시 바로구매 &rarr;
          </button>
        </div>

        <div v-if="addedToCart" class="p-3 bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs rounded-xl font-bold text-center">
          <i class="fa-solid fa-circle-check mr-1.5 text-emerald-600"></i>장바구니에 상품이 안전하게 담겼습니다!
        </div>

        <!-- Product Description HTML -->
        <div class="border-t border-slate-100 pt-4 text-xs text-slate-600 space-y-2">
          <h4 class="font-bold text-slate-800">상품 상세 설명</h4>
          <div v-html="product.description_html" class="prose prose-sm text-slate-600"></div>
        </div>
      </div>
    </div>
  </div>
</template>
