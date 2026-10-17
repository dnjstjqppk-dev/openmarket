<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useCartStore } from '../stores/cart';
import { API_BASE_URL } from '../config';

interface ProductItem {
  id: string;
  title: string;
  thumbnail_url: string;
  lowest_original_price: number;
  lowest_sale_price: number;
  total_sold_count: number;
  category_name?: string;
  category_slug?: string;
  business_name?: string;
}

const cartStore = useCartStore();
const products = ref<ProductItem[]>([]);
const loading = ref(true);

const categories = [
  { slug: 'all', name: '전체 추천', icon: 'fa-fire text-orange-500' },
  { slug: 'womens-clothing', name: '여성의류', icon: 'fa-shirt text-pink-500' },
  { slug: 'mens-clothing', name: '남성의류', icon: 'fa-user-tie text-blue-500' },
  { slug: 'electronics', name: '디지털/가전', icon: 'fa-laptop text-indigo-500' },
  { slug: 'home-kitchen', name: '홈/주방', icon: 'fa-couch text-emerald-500' },
  { slug: 'beauty-health', name: '뷰티/헬스', icon: 'fa-wand-magic-sparkles text-purple-500' },
  { slug: 'sports-outdoors', name: '스포츠/레저', icon: 'fa-person-running text-teal-500' },
  { slug: 'shoes-bags', name: '신발/가방', icon: 'fa-shoe-prints text-amber-500' },
  { slug: 'toys-games', name: '완구/취미', icon: 'fa-gamepad text-rose-500' }
];

const selectedCategory = ref('all');

async function loadProducts(catSlug: string = 'all') {
  selectedCategory.value = catSlug;
  loading.value = true;
  try {
    const url = catSlug === 'all' 
      ? `${API_BASE_URL}/api/v1/products?sort=popular`
      : `${API_BASE_URL}/api/v1/products?category=${catSlug}&sort=popular`;
    const res = await fetch(url);
    const json = await res.json();
    if (json.success && json.data) {
      products.value = json.data;
    }
  } catch (_) {
    products.value = [];
  } finally {
    loading.value = false;
  }
}

onMounted(() => {
  loadProducts('all');
});

function calculateDiscount(orig: number, sale: number) {
  if (orig <= 0) return 0;
  return Math.round(((orig - sale) / orig) * 100);
}
</script>

<template>
  <div class="space-y-6">
    <!-- Hero Promotion Banner (Temu Style) -->
    <section class="rounded-3xl bg-gradient-to-r from-orange-600 via-rose-500 to-amber-500 text-white p-6 sm:p-10 shadow-xl overflow-hidden relative">
      <div class="relative z-10 max-w-2xl space-y-3">
        <div class="inline-flex items-center gap-2 bg-black/25 backdrop-blur-md px-3 py-1 rounded-full text-xs font-bold text-amber-200">
          <i class="fa-solid fa-crown"></i>
          <span>OLMOA GLOBAL LAUNCHING FESTIVAL</span>
        </div>
        <h1 class="text-3xl sm:text-5xl font-black tracking-tight leading-tight">
          내가 찾는 모든 것, 여기.<br>
          <span class="text-amber-200">최대 90% 슈퍼 세일</span>
        </h1>
        <p class="text-white/90 text-sm sm:text-base font-medium">
          공장 직배송 최저가 + 전 품목 100% 무료배송 & 90일 무료 반품 보증
        </p>
        <div class="pt-2 flex flex-wrap gap-3">
          <router-link to="/categories" class="px-6 py-3 bg-white text-orange-600 font-extrabold rounded-full text-sm hover:bg-amber-100 transition shadow-lg">
            전체 33개 카테고리 둘러보기 &rarr;
          </router-link>
        </div>
      </div>
      <div class="absolute right-4 bottom-0 opacity-20 sm:opacity-40 pointer-events-none transform translate-y-4">
        <i class="fa-solid fa-gift text-[180px] sm:text-[240px]"></i>
      </div>
    </section>

    <!-- Quick Categories Bar -->
    <div class="flex items-center gap-2 overflow-x-auto pb-2 scrollbar-none">
      <button 
        v-for="cat in categories" 
        :key="cat.slug"
        @click="loadProducts(cat.slug)"
        :class="selectedCategory === cat.slug ? 'bg-orange-600 text-white shadow-md' : 'bg-white text-slate-700 hover:bg-slate-100 border border-slate-200'"
        class="px-4 py-2 rounded-full text-xs font-bold whitespace-nowrap transition flex items-center gap-1.5"
      >
        <i :class="['fa-solid', cat.icon]"></i>
        <span>{{ cat.name }}</span>
      </button>
    </div>

    <!-- Loading State -->
    <div v-if="loading" class="py-16 text-center text-slate-400">
      <i class="fa-solid fa-spinner fa-spin text-3xl mb-3 text-orange-500"></i>
      <p class="text-xs font-bold">인기 상품을 실시간 불러오는 중입니다...</p>
    </div>

    <!-- Product Grid -->
    <div v-else class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3 sm:gap-4">
      <div 
        v-for="p in products" 
        :key="p.id" 
        class="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm hover:shadow-xl transition duration-300 flex flex-col group"
      >
        <router-link :to="'/product/' + p.id" class="aspect-square bg-slate-100 overflow-hidden relative block">
          <img :src="p.thumbnail_url" :alt="p.title" class="w-full h-full object-cover group-hover:scale-105 transition duration-300" loading="lazy" />
          <span v-if="calculateDiscount(p.lowest_original_price, p.lowest_sale_price) > 0" class="absolute top-2 left-2 bg-orange-600 text-white text-[10px] font-black px-2 py-0.5 rounded-md shadow-sm">
            -{{ calculateDiscount(p.lowest_original_price, p.lowest_sale_price) }}%
          </span>
        </router-link>

        <div class="p-3 flex-1 flex flex-col justify-between space-y-2">
          <div>
            <span class="text-[10px] font-bold text-slate-400 uppercase tracking-wider">{{ p.category_name || 'OLMOA' }}</span>
            <router-link :to="'/product/' + p.id" class="font-bold text-slate-900 text-xs line-clamp-2 mt-0.5 hover:text-orange-600 transition">
              {{ p.title }}
            </router-link>
          </div>

          <div class="space-y-1 pt-1 border-t border-slate-100">
            <div class="flex items-baseline gap-1.5">
              <span class="text-sm sm:text-base font-black text-orange-600">₩{{ p.lowest_sale_price.toLocaleString() }}</span>
              <span class="text-[10px] text-slate-400 line-through">₩{{ p.lowest_original_price.toLocaleString() }}</span>
            </div>
            <div class="flex items-center justify-between text-[10px] text-slate-400">
              <span>판매 <strong class="text-slate-700">{{ p.total_sold_count.toLocaleString() }}</strong></span>
              <span class="text-amber-500 font-bold"><i class="fa-solid fa-star"></i> 4.9</span>
            </div>
            <router-link 
              :to="'/product/' + p.id"
              class="w-full py-1.5 bg-orange-50 hover:bg-orange-600 text-orange-600 hover:text-white rounded-lg text-[11px] font-bold transition flex items-center justify-center gap-1 shadow-sm"
            >
              <i class="fa-solid fa-sliders"></i>
              <span>옵션 선택 / 구매</span>
            </router-link>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
