<script setup lang="ts">
import { ref, watch, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useCartStore } from '../stores/cart';
import { API_BASE_URL } from '../config';

const route = useRoute();
const router = useRouter();
const cartStore = useCartStore();

const query = ref((route.query.q as string) || '');
const currentSort = ref((route.query.sort as string) || 'popular');
const products = ref<any[]>([]);
const loading = ref(true);

async function fetchSearchResults() {
  loading.value = true;
  try {
    const q = query.value.trim();
    const sort = currentSort.value;
    const url = `${API_BASE_URL}/api/v1/products?q=${encodeURIComponent(q)}&sort=${sort}`;
    const res = await fetch(url);
    const json = await res.json();
    if (json.success && json.data) {
      products.value = json.data;
    } else {
      products.value = [];
    }
  } catch (_) {
    products.value = [];
  } finally {
    loading.value = false;
  }
}

function handleSearch() {
  router.push({ path: '/search', query: { q: query.value, sort: currentSort.value } });
}

function changeSort(sort: string) {
  currentSort.value = sort;
  handleSearch();
}

watch(() => route.query, () => {
  query.value = (route.query.q as string) || '';
  currentSort.value = (route.query.sort as string) || 'popular';
  fetchSearchResults();
});

onMounted(() => {
  fetchSearchResults();
});
</script>

<template>
  <div class="space-y-6">
    <!-- Search Bar & Stats Header -->
    <div class="bg-white rounded-3xl p-6 border border-slate-200 shadow-sm space-y-4">
      <form @submit.prevent="handleSearch" class="flex gap-2">
        <div class="relative flex-1">
          <input 
            v-model="query" 
            placeholder="상품명, 카테고리, 브랜드 검색..." 
            class="w-full bg-slate-50 border border-slate-300 rounded-2xl py-3 pl-11 pr-4 text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-orange-500 font-medium"
          />
          <i class="fa-solid fa-magnifying-glass absolute left-4 top-3.5 text-slate-400"></i>
        </div>
        <button type="submit" class="px-6 py-3 bg-orange-600 hover:bg-orange-700 text-white font-black rounded-2xl text-xs sm:text-sm transition shadow-md">
          검색
        </button>
      </form>

      <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs border-t border-slate-100 pt-3">
        <div class="text-slate-600">
          <span v-if="query">
            '<strong>{{ query }}</strong>' 검색 결과: 총 <strong>{{ products.length }}</strong>개
          </span>
          <span v-else>
            전체 상품 목록: 총 <strong>{{ products.length }}</strong>개
          </span>
        </div>
        <div class="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0">
          <button 
            @click="changeSort('popular')"
            :class="currentSort === 'popular' ? 'bg-orange-600 text-white font-bold' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'"
            class="px-3 py-1.5 rounded-lg text-[11px] transition"
          >인기순</button>
          <button 
            @click="changeSort('price_asc')"
            :class="currentSort === 'price_asc' ? 'bg-orange-600 text-white font-bold' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'"
            class="px-3 py-1.5 rounded-lg text-[11px] transition"
          >낮은가격순</button>
          <button 
            @click="changeSort('price_desc')"
            :class="currentSort === 'price_desc' ? 'bg-orange-600 text-white font-bold' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'"
            class="px-3 py-1.5 rounded-lg text-[11px] transition"
          >높은가격순</button>
          <button 
            @click="changeSort('newest')"
            :class="currentSort === 'newest' ? 'bg-orange-600 text-white font-bold' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'"
            class="px-3 py-1.5 rounded-lg text-[11px] transition"
          >최신순</button>
        </div>
      </div>
    </div>

    <!-- Loading State -->
    <div v-if="loading" class="p-16 text-center text-slate-400">
      <i class="fa-solid fa-spinner fa-spin text-3xl mb-3 text-orange-500"></i>
      <p class="text-xs font-bold">검색 결과를 집계하는 중입니다...</p>
    </div>

    <!-- Empty State -->
    <div v-else-if="products.length === 0" class="bg-white rounded-3xl p-12 text-center border border-slate-200 space-y-3">
      <i class="fa-solid fa-box-open text-4xl text-slate-300"></i>
      <h3 class="font-bold text-slate-700">일치하는 검색 결과가 없습니다.</h3>
      <p class="text-xs text-slate-400">단어의 철자가 맞는지 확인하거나 다른 검색어를 입력해 보세요.</p>
      <router-link to="/categories" class="inline-block mt-2 px-5 py-2.5 bg-orange-600 text-white text-xs font-bold rounded-xl shadow-md">
        전체 카테고리 둘러보기
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
          <span class="absolute top-2 left-2 bg-orange-600 text-white text-[10px] font-black px-2 py-0.5 rounded-md shadow-sm">
            OLMOA 특가
          </span>
        </router-link>
        <div class="p-3 flex-1 flex flex-col justify-between space-y-2">
          <div>
            <span class="text-[10px] font-bold text-slate-400 uppercase">{{ p.category_name }}</span>
            <router-link :to="'/product/' + p.id" class="font-bold text-slate-900 text-xs line-clamp-2 mt-0.5 hover:text-orange-600 transition">
              {{ p.title }}
            </router-link>
          </div>
          <div class="space-y-1 pt-1 border-t border-slate-100">
            <div class="flex items-baseline gap-1.5">
              <span class="text-sm sm:text-base font-black text-orange-600">₩{{ p.lowest_sale_price.toLocaleString() }}</span>
              <span class="text-[10px] text-slate-400 line-through">₩{{ p.lowest_original_price.toLocaleString() }}</span>
            </div>
            <div class="text-[10px] text-slate-400">
              판매 <strong class="text-slate-700">{{ p.total_sold_count.toLocaleString() }}</strong>개
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
