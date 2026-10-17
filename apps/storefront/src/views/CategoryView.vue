<script setup lang="ts">
import { ref, watch, onMounted, computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';

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

const categorySlug = computed(() => (route.params.slug as string) || 'all');
const categoryTitle = ref('카테고리 상품');
const subcategories = ref<SubCategory[]>([]);
const products = ref<ProductItem[]>([]);
const loading = ref(true);
const currentSort = ref('popular');
const minPrice = ref<number | null>(null);
const maxPrice = ref<number | null>(null);

// Category display mapping dictionary
const categoryNames: Record<string, string> = {
  'womens-clothing': '여성의류',
  'mens-clothing': '남성의류',
  'electronics': '디지털/가전',
  'home-kitchen': '홈/주방',
  'beauty-health': '뷰티/헬스',
  'sports-outdoors': '스포츠/레저',
  'shoes-bags': '신발/가방',
  'toys-games': '완구/취미',
  'automotive': '차량용품',
  'jewelry-accessories': '주얼리/시계',
  'fashion': '패션/의류',
  'home': '홈/인테리어'
};

async function loadCategoryData() {
  loading.value = true;
  const slug = categorySlug.value;
  categoryTitle.value = categoryNames[slug] || slug;

  try {
    // 1. Fetch category meta & subcategories
    const catRes = await fetch(`https://openmarket-api.dnjstjqppk.workers.dev/api/v1/categories/${slug}`);
    if (catRes.ok) {
      const catJson = await catRes.json();
      if (catJson.data) {
        categoryTitle.value = catJson.data.name || categoryTitle.value;
        subcategories.value = catJson.data.subcategories || [];
      }
    }

    // 2. Fetch products for this category
    let prodUrl = `https://openmarket-api.dnjstjqppk.workers.dev/api/v1/products?category=${slug}&sort=${currentSort.value}`;
    if (minPrice.value) prodUrl += `&min_price=${minPrice.value}`;
    if (maxPrice.value) prodUrl += `&max_price=${maxPrice.value}`;

    const prodRes = await fetch(prodUrl);
    const prodJson = await prodRes.json();
    if (prodJson.success && prodJson.data && prodJson.data.length > 0) {
      products.value = prodJson.data;
    } else {
      // Fallback: If category has no items yet, show general catalog to prevent empty shell
      const allRes = await fetch('https://openmarket-api.dnjstjqppk.workers.dev/api/v1/products');
      const allJson = await allRes.json();
      products.value = allJson.data || [];
    }
  } catch (err) {
    console.error('Failed to load category products', err);
  } finally {
    loading.value = false;
  }
}

function handleSortChange(sort: string) {
  currentSort.value = sort;
  loadCategoryData();
}

function selectSubCategory(subSlug: string) {
  router.push(`/category/${subSlug}`);
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
    <!-- Breadcrumb Navigation -->
    <nav class="flex items-center gap-2 text-xs text-slate-500 py-1">
      <router-link to="/" class="hover:text-orange-600 transition">홈</router-link>
      <i class="fa-solid fa-chevron-right text-[10px]"></i>
      <router-link to="/categories" class="hover:text-orange-600 transition">전체 카테고리</router-link>
      <i class="fa-solid fa-chevron-right text-[10px]"></i>
      <span class="font-bold text-slate-900">{{ categoryTitle }}</span>
    </nav>

    <!-- Category Header Banner -->
    <div class="bg-gradient-to-r from-orange-500 via-rose-500 to-amber-500 rounded-3xl p-6 sm:p-8 text-white shadow-md relative overflow-hidden">
      <div class="relative z-10 space-y-2">
        <span class="bg-white/20 backdrop-blur-md px-3 py-1 rounded-full text-[11px] font-bold">OLMOA CATEGORY</span>
        <h1 class="text-2xl sm:text-3xl font-black tracking-tight">{{ categoryTitle }}</h1>
        <p class="text-xs sm:text-sm text-white/90">엄선된 글로벌 직구 특가 상품을 가장 저렴한 가격으로 만나보세요.</p>
      </div>
      <i class="fa-solid fa-tags absolute right-6 bottom-2 text-white/15 text-8xl pointer-events-none"></i>
    </div>

    <!-- Subcategories Chips (if available) -->
    <div v-if="subcategories.length > 0" class="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-none">
      <button 
        v-for="sub in subcategories" 
        :key="sub.id"
        @click="selectSubCategory(sub.slug)"
        class="px-3.5 py-1.5 bg-white hover:bg-orange-50 text-slate-700 hover:text-orange-600 border border-slate-200 hover:border-orange-400 rounded-full text-xs font-semibold shrink-0 transition"
      >
        {{ sub.name }}
      </button>
    </div>

    <!-- Filters & Sort Bar -->
    <div class="bg-white p-4 rounded-2xl border border-slate-200 flex flex-wrap items-center justify-between gap-4 text-xs">
      <div class="flex items-center gap-2">
        <span class="font-bold text-slate-500 mr-1">정렬:</span>
        <button 
          v-for="s in [
            { key: 'popular', label: '인기순' },
            { key: 'price_asc', label: '낮은 가격순' },
            { key: 'price_desc', label: '높은 가격순' },
            { key: 'newest', label: '신상품순' }
          ]"
          :key="s.key"
          @click="handleSortChange(s.key)"
          class="px-3 py-1.5 rounded-lg font-bold transition"
          :class="currentSort === s.key ? 'bg-orange-600 text-white shadow-sm' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'"
        >
          {{ s.label }}
        </button>
      </div>

      <div class="text-slate-500 font-medium">
        총 <strong class="text-orange-600">{{ products.length }}</strong>개의 특가 상품
      </div>
    </div>

    <!-- Loading State -->
    <div v-if="loading" class="text-center py-20 text-slate-400 text-xs">
      <i class="fa-solid fa-spinner fa-spin text-3xl text-orange-600 mb-3"></i>
      <p>상품 목록을 불러오는 중입니다...</p>
    </div>

    <!-- Product Grid -->
    <div v-else class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3 sm:gap-4">
      <div 
        v-for="item in products" 
        :key="item.id" 
        class="bg-white rounded-2xl border border-slate-200 overflow-hidden hover:shadow-xl hover:border-orange-300 transition flex flex-col group"
      >
        <!-- Thumbnail -->
        <div class="relative pt-[100%] bg-slate-100 overflow-hidden">
          <img 
            :src="item.thumbnail_url" 
            :alt="item.title"
            class="absolute inset-0 w-full h-full object-cover group-hover:scale-105 transition duration-300"
          />
          <div class="absolute top-2 left-2 bg-orange-600 text-white font-black text-[10px] px-2 py-0.5 rounded-md shadow">
            -{{ calculateDiscount(item.lowest_original_price, item.lowest_sale_price) }}%
          </div>
          <div class="absolute bottom-2 right-2 bg-black/60 backdrop-blur text-white text-[9px] px-2 py-0.5 rounded-full font-medium">
            무료배송
          </div>
        </div>

        <!-- Product Info -->
        <div class="p-3 flex-1 flex flex-col justify-between">
          <div>
            <div class="text-[10px] font-bold text-orange-600 uppercase mb-1">{{ item.category_name || categoryTitle }}</div>
            <h3 class="text-xs font-medium text-slate-800 line-clamp-2 leading-snug mb-2 group-hover:text-orange-600 transition">
              {{ item.title }}
            </h3>
          </div>

          <div>
            <div class="flex items-baseline gap-1.5 mb-1">
              <span class="text-base font-black text-orange-600">
                ₩{{ item.lowest_sale_price.toLocaleString() }}
              </span>
              <span v-if="item.lowest_original_price > item.lowest_sale_price" class="text-[11px] text-slate-400 line-through">
                ₩{{ item.lowest_original_price.toLocaleString() }}
              </span>
            </div>

            <div class="flex items-center justify-between text-[10px] text-slate-400 pt-1 border-t border-slate-100">
              <span>{{ (item.total_sold_count || 500).toLocaleString() }}개 구매</span>
              <router-link to="/checkout" class="px-2.5 py-1 bg-orange-50 hover:bg-orange-600 text-orange-600 hover:text-white rounded-lg font-bold text-[10px] transition">
                담기
              </router-link>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
