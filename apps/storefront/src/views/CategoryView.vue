<script setup lang="ts">
import { ref, watch, onMounted, computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useCartStore } from '../stores/cart';

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

interface SubCategory {
  id: string;
  name: string;
  slug: string;
}

const route = useRoute();
const router = useRouter();
const cartStore = useCartStore();

const categorySlug = computed(() => (route.params.slug as string) || 'womens-clothing');
const categoryTitle = ref('카테고리 상품');
const subcategories = ref<SubCategory[]>([]);
const products = ref<ProductItem[]>([]);
const loading = ref(true);
const currentSort = ref('popular');

async function loadCategoryData() {
  loading.value = true;
  const slug = categorySlug.value;

  try {
    // 1. Fetch category meta & subcategories
    const catRes = await fetch(`https://olmoa-api.dnjstjqppk.workers.dev/api/v1/categories/${slug}`);
    if (catRes.ok) {
      const catJson = await catRes.json();
      if (catJson.data) {
        categoryTitle.value = catJson.data.name || slug;
        subcategories.value = catJson.data.subcategories || [];
      }
    }

    // 2. Fetch products specifically matching this category
    const prodUrl = `https://olmoa-api.dnjstjqppk.workers.dev/api/v1/products?category=${slug}&sort=${currentSort.value}`;
    const prodRes = await fetch(prodUrl);
    const prodJson = await prodRes.json();
    if (prodJson.success && prodJson.data) {
      products.value = prodJson.data;
    } else {
      products.value = [];
    }
  } catch (err) {
    products.value = [];
  } finally {
    loading.value = false;
  }
}

function handleSortChange(sort: string) {
  currentSort.value = sort;
  loadCategoryData();
}

function calculateDiscount(orig: number, sale: number) {
  if (orig <= 0) return 0;
  return Math.round(((orig - sale) / orig) * 100);
}

watch(() => route.params.slug, () => {
  loadCategoryData();
});

onMounted(() => {
  loadCategoryData();
});
</script>

<template>
  <div class="space-y-6">
    <!-- Breadcrumb & Header -->
    <div class="bg-white rounded-3xl p-6 border border-slate-200 shadow-sm space-y-4">
      <div class="flex items-center gap-2 text-xs text-slate-400">
        <router-link to="/" class="hover:text-slate-700">홈</router-link>
        <i class="fa-solid fa-chevron-right text-[10px]"></i>
        <router-link to="/categories" class="hover:text-slate-700">전체 카테고리</router-link>
        <i class="fa-solid fa-chevron-right text-[10px]"></i>
        <span class="font-bold text-slate-900">{{ categoryTitle }}</span>
      </div>

      <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-100 pb-4">
        <div>
          <h1 class="text-2xl sm:text-3xl font-black text-slate-900">{{ categoryTitle }}</h1>
          <p class="text-xs text-slate-500 mt-1">OLMOA 직구 특가 · 총 {{ products.length }}개 상품 판매중</p>
        </div>

        <!-- Sorting -->
        <div class="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0">
          <button 
            @click="handleSortChange('popular')"
            :class="currentSort === 'popular' ? 'bg-orange-600 text-white font-bold' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'"
            class="px-3 py-1.5 rounded-lg text-xs transition"
          >인기순</button>
          <button 
            @click="handleSortChange('price_asc')"
            :class="currentSort === 'price_asc' ? 'bg-orange-600 text-white font-bold' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'"
            class="px-3 py-1.5 rounded-lg text-xs transition"
          >낮은가격순</button>
          <button 
            @click="handleSortChange('price_desc')"
            :class="currentSort === 'price_desc' ? 'bg-orange-600 text-white font-bold' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'"
            class="px-3 py-1.5 rounded-lg text-xs transition"
          >높은가격순</button>
          <button 
            @click="handleSortChange('newest')"
            :class="currentSort === 'newest' ? 'bg-orange-600 text-white font-bold' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'"
            class="px-3 py-1.5 rounded-lg text-xs transition"
          >최신순</button>
        </div>
      </div>

      <!-- Subcategories Chips -->
      <div v-if="subcategories.length > 0" class="flex flex-wrap gap-2 pt-1">
        <router-link 
          v-for="sub in subcategories" 
          :key="sub.id"
          :to="'/category/' + sub.slug"
          class="px-3 py-1 rounded-full text-xs font-bold transition bg-slate-100 text-slate-700 hover:bg-orange-50 hover:text-orange-600 border border-slate-200"
        >
          {{ sub.name }}
        </router-link>
      </div>
    </div>

    <!-- Loading State -->
    <div v-if="loading" class="py-16 text-center text-slate-400">
      <i class="fa-solid fa-spinner fa-spin text-3xl mb-3 text-orange-500"></i>
      <p class="text-xs font-bold">{{ categoryTitle }} 상품을 불러오는 중입니다...</p>
    </div>

    <!-- Empty State -->
    <div v-else-if="products.length === 0" class="bg-white rounded-3xl p-16 text-center border border-slate-200 space-y-3">
      <i class="fa-solid fa-box-open text-5xl text-slate-300"></i>
      <h3 class="font-bold text-slate-800 text-base">{{ categoryTitle }}에 등록된 상품이 준비 중입니다.</h3>
      <p class="text-xs text-slate-400">다른 카테고리의 인기 상품들을 만나보세요.</p>
      <router-link to="/categories" class="inline-block mt-2 px-6 py-2.5 bg-orange-600 text-white text-xs font-bold rounded-xl shadow-md">
        전체 카테고리 보기 &rarr;
      </router-link>
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
            <span class="text-[10px] font-bold text-slate-400 uppercase tracking-wider">{{ p.category_name || categoryTitle }}</span>
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
            <button 
              @click="cartStore.addItem(p, null, 1)"
              class="w-full py-1.5 bg-orange-50 hover:bg-orange-600 text-orange-600 hover:text-white rounded-lg text-[11px] font-bold transition flex items-center justify-center gap-1 shadow-sm"
            >
              <i class="fa-solid fa-cart-plus"></i>
              <span>장바구니 담기</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
