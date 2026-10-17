<script setup lang="ts">
import { ref, onMounted } from 'vue';
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
  rating?: number;
}

interface CategoryItem {
  id: string;
  name: string;
  slug: string;
  icon?: string;
}

const products = ref<ProductItem[]>([]);
const categories = ref<CategoryItem[]>([
  { id: 'all', slug: 'all', name: '전체 핫딜', icon: 'fa-fire text-orange-500' }
]);
const loading = ref(true);
const loadingCats = ref(true);
const selectedCategory = ref('all');
const apiError = ref('');

const fallbackImage = 'https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=500';

function onImgError(e: Event) {
  const target = e.target as HTMLImageElement;
  if (target && target.src !== fallbackImage) {
    target.src = fallbackImage;
  }
}

async function loadCategories() {
  loadingCats.value = true;
  try {
    const res = await fetch(`${API_BASE_URL}/api/v1/categories`);
    const json = await res.json();
    if (json.success && Array.isArray(json.data)) {
      const roots = json.data.filter((c: any) => !c.parent_id || c.depth === 1);
      categories.value = [
        { id: 'all', slug: 'all', name: '전체 핫딜', icon: 'fa-fire text-orange-500' },
        ...roots.map((c: any) => ({
          id: c.id,
          name: c.name,
          slug: c.slug,
          icon: 'fa-layer-group text-slate-400'
        }))
      ];
    }
  } catch (_) {
  } finally {
    loadingCats.value = false;
  }
}

async function loadProducts(catSlug: string = 'all') {
  selectedCategory.value = catSlug;
  loading.value = true;
  apiError.value = '';
  try {
    const url = catSlug === 'all' 
      ? `${API_BASE_URL}/api/v1/products?sort=popular`
      : `${API_BASE_URL}/api/v1/products?category=${catSlug}&sort=popular`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    if (json.success && Array.isArray(json.data)) {
      products.value = json.data;
    } else {
      products.value = [];
    }
  } catch (err: any) {
    apiError.value = '상품 목록을 불러오는 중 네트워크 오류가 발생했습니다.';
    products.value = [];
  } finally {
    loading.value = false;
  }
}

onMounted(() => {
  loadCategories();
  loadProducts('all');
});

function calculateDiscount(orig: number, sale: number) {
  if (orig <= 0) return 0;
  return Math.max(0, Math.round(((orig - sale) / orig) * 100));
}
</script>

<template>
  <div class="space-y-6">
    <!-- Verified Policy Hero Banner -->
    <section class="rounded-3xl bg-gradient-to-r from-orange-600 via-rose-500 to-amber-500 text-white p-6 sm:p-10 shadow-xl overflow-hidden relative">
      <div class="relative z-10 max-w-2xl space-y-3">
        <div class="inline-flex items-center gap-2 bg-black/25 backdrop-blur-md px-3 py-1 rounded-full text-xs font-bold text-amber-200">
          <i class="fa-solid fa-crown"></i>
          <span>OLMOA 글로벌 오픈마켓 직배송</span>
        </div>
        <h1 class="text-3xl sm:text-5xl font-black tracking-tight leading-tight">
          내가 찾는 모든 것, 여기.<br>
          <span class="text-amber-200">스마트 글로벌 특가 쇼핑</span>
        </h1>
        <p class="text-white/90 text-sm sm:text-base font-medium">
          3만원 이상 주문 시 무료배송 · 입점사 100% 정품 보증 · 실시간 배송 추적
        </p>
        <div class="pt-2 flex flex-wrap gap-3">
          <router-link to="/categories" class="px-6 py-3 bg-white text-orange-600 font-extrabold rounded-full text-sm hover:bg-amber-100 transition shadow-lg">
            전체 33개 카테고리 전체보기 &rarr;
          </router-link>
        </div>
      </div>
      <div class="absolute right-4 bottom-0 opacity-20 sm:opacity-40 pointer-events-none transform translate-y-4">
        <i class="fa-solid fa-gift text-[180px] sm:text-[240px]"></i>
      </div>
    </section>

    <!-- Dynamic 33 Categories Scrollbar -->
    <div class="flex items-center gap-2 overflow-x-auto pb-2 scrollbar-thin">
      <button 
        v-for="cat in categories" 
        :key="cat.slug"
        @click="loadProducts(cat.slug)"
        :class="selectedCategory === cat.slug ? 'bg-orange-600 text-white shadow-md' : 'bg-white text-slate-700 hover:bg-slate-100 border border-slate-200'"
        class="px-3.5 py-1.5 rounded-full text-xs font-bold whitespace-nowrap transition flex items-center gap-1.5 shrink-0"
      >
        <i :class="['fa-solid', cat.icon || 'fa-tag text-slate-400']"></i>
        <span>{{ cat.name }}</span>
      </button>
    </div>

    <!-- Error State -->
    <div v-if="apiError" class="p-6 bg-rose-50 border border-rose-200 rounded-2xl text-center space-y-2">
      <i class="fa-solid fa-triangle-exclamation text-rose-500 text-xl"></i>
      <p class="text-xs text-rose-700 font-bold">{{ apiError }}</p>
      <button @click="loadProducts(selectedCategory)" class="px-4 py-1.5 bg-rose-600 text-white text-xs rounded-xl font-bold">다시 시도</button>
    </div>

    <!-- Loading State -->
    <div v-else-if="loading" class="py-16 text-center text-slate-400">
      <i class="fa-solid fa-spinner fa-spin text-3xl mb-3 text-orange-500"></i>
      <p class="text-xs font-bold">상품 정보를 실시간 불러오는 중입니다...</p>
    </div>

    <!-- Empty State -->
    <div v-else-if="products.length === 0" class="py-16 text-center bg-white rounded-3xl border border-slate-200 space-y-3">
      <i class="fa-solid fa-box-open text-4xl text-slate-300"></i>
      <p class="text-sm font-bold text-slate-700">해당 카테고리의 상품이 준비 중입니다.</p>
      <button @click="loadProducts('all')" class="px-5 py-2 bg-orange-600 text-white text-xs rounded-xl font-bold">전체 상품 보기</button>
    </div>

    <!-- High Density Product Grid -->
    <div v-else class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3 sm:gap-4">
      <div 
        v-for="p in products" 
        :key="p.id" 
        class="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm hover:shadow-xl transition duration-300 flex flex-col group"
      >
        <router-link :to="'/product/' + p.id" class="aspect-square bg-slate-100 overflow-hidden relative block">
          <img :src="p.thumbnail_url" :alt="p.title" @error="onImgError" class="w-full h-full object-cover group-hover:scale-105 transition duration-300" loading="lazy" />
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

          <div class="space-y-1.5 pt-1 border-t border-slate-100">
            <div class="flex items-baseline gap-1.5">
              <span class="text-sm sm:text-base font-black text-orange-600">₩{{ p.lowest_sale_price.toLocaleString() }}</span>
              <span v-if="p.lowest_original_price > p.lowest_sale_price" class="text-[10px] text-slate-400 line-through">
                ₩{{ p.lowest_original_price.toLocaleString() }}
              </span>
            </div>
            <div class="flex items-center justify-between text-[10px] text-slate-400">
              <span>판매 <strong class="text-slate-700">{{ p.total_sold_count.toLocaleString() }}</strong></span>
              <!-- Only display rating if present in data, otherwise show badge -->
              <span v-if="p.rating" class="text-amber-500 font-bold"><i class="fa-solid fa-star"></i> {{ p.rating }}</span>
              <span v-else class="text-emerald-600 font-medium">OLMOA 직송</span>
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
