<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue';
import { useRouter } from 'vue-router';
import { API_BASE_URL } from '../config';
import { useLocaleStore } from '../stores/locale';

const router = useRouter();
const localeStore = useLocaleStore();

const searchQuery = ref('');
const isOpen = ref(false);
const loading = ref(false);
const containerRef = ref<HTMLElement | null>(null);

const trendingKeywords = ref<any[]>([]);
const recommendedCategories = ref<any[]>([]);
const suggestions = ref<any[]>([]);
const matchedCategories = ref<any[]>([]);
const previewProducts = ref<any[]>([]);
const recentKeywords = ref<string[]>([]);

let debounceTimer: any = null;

try {
  const saved = localStorage.getItem('olmoa_recent_searches');
  if (saved) recentKeywords.value = JSON.parse(saved);
} catch (_) {}

function saveRecent(kw: string) {
  const clean = kw.trim();
  if (!clean) return;
  recentKeywords.value = [clean, ...recentKeywords.value.filter(k => k !== clean)].slice(0, 8);
  try {
    localStorage.setItem('olmoa_recent_searches', JSON.stringify(recentKeywords.value));
  } catch (_) {}
}

function clearRecent() {
  recentKeywords.value = [];
  try { localStorage.removeItem('olmoa_recent_searches'); } catch (_) {}
}

async function fetchAutocomplete(q: string) {
  loading.value = true;
  try {
    const res = await fetch(`${API_BASE_URL}/api/v1/search/autocomplete?q=${encodeURIComponent(q)}`);
    const json = await res.json();
    if (json.success) {
      if (!q) {
        trendingKeywords.value = json.trending_keywords || [];
        recommendedCategories.value = json.recommended_categories || [];
      } else {
        suggestions.value = json.suggestions || [];
        matchedCategories.value = json.categories || [];
        previewProducts.value = json.products || [];
      }
    }
  } catch (_) {
  } finally {
    loading.value = false;
  }
}

function onFocus() {
  isOpen.value = true;
  if (!searchQuery.value.trim() && trendingKeywords.value.length === 0) {
    fetchAutocomplete('');
  }
}

function onInput() {
  isOpen.value = true;
  if (debounceTimer) clearTimeout(debounceTimer);
  const q = searchQuery.value.trim();
  debounceTimer = setTimeout(() => {
    fetchAutocomplete(q);
  }, 180);
}

async function executeSearch(kw?: string) {
  const targetKw = (kw !== undefined ? kw : searchQuery.value).trim();
  if (!targetKw) return;
  searchQuery.value = targetKw;
  saveRecent(targetKw);
  isOpen.value = false;

  fetch(`${API_BASE_URL}/api/v1/search/log`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ keyword: targetKw })
  }).catch(() => {});

  router.push({ path: '/search', query: { q: targetKw } });
}

function goProduct(id: string) {
  isOpen.value = false;
  router.push(`/product/${id}`);
}

function goCategory(slug: string) {
  isOpen.value = false;
  router.push(`/category/${slug}`);
}

function handleClickOutside(e: MouseEvent) {
  if (containerRef.value && !containerRef.value.contains(e.target as Node)) {
    isOpen.value = false;
  }
}

onMounted(() => {
  document.addEventListener('mousedown', handleClickOutside);
});

onUnmounted(() => {
  document.removeEventListener('mousedown', handleClickOutside);
});
</script>

<template>
  <div ref="containerRef" class="relative w-full">
    <form @submit.prevent="executeSearch()" class="relative flex items-center">
      <input
        v-model="searchQuery"
        @focus="onFocus"
        @input="onInput"
        type="text"
        placeholder="초성(ㅇㅇㅍ), 브랜드, 카테고리, 특가 상품 실시간 검색..."
        class="w-full pl-5 pr-20 py-2.5 sm:py-3 rounded-full border-2 border-orange-500 bg-orange-50/20 text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-orange-400 focus:bg-white transition"
      />
      <button
        v-if="searchQuery"
        type="button"
        @click="searchQuery = ''; onInput()"
        class="absolute right-12 text-slate-400 hover:text-slate-600 px-1.5"
      >
        <i class="fa-solid fa-circle-xmark text-sm"></i>
      </button>
      <button
        type="submit"
        class="absolute right-1.5 w-9 h-9 sm:w-10 sm:h-10 bg-orange-600 hover:bg-orange-700 text-white rounded-full flex items-center justify-center transition shadow-md"
      >
        <i class="fa-solid fa-magnifying-glass text-xs sm:text-sm"></i>
      </button>
    </form>

    <!-- Autocomplete Dropdown Panel -->
    <div
      v-if="isOpen"
      class="absolute left-0 right-0 top-full mt-2 bg-white rounded-2xl shadow-2xl border border-slate-200 z-50 overflow-hidden max-h-[75vh] overflow-y-auto"
    >
      <!-- Empty Query: Recent & Trending Keywords -->
      <div v-if="!searchQuery.trim()" class="p-4 space-y-4 text-xs">
        <div v-if="recentKeywords.length > 0" class="space-y-2">
          <div class="flex items-center justify-between text-slate-500 font-bold">
            <span><i class="fa-regular fa-clock mr-1"></i>최근 검색어</span>
            <button @click="clearRecent" class="text-[11px] text-slate-400 hover:text-rose-500">전체삭제</button>
          </div>
          <div class="flex flex-wrap gap-1.5">
            <button
              v-for="rk in recentKeywords"
              :key="rk"
              @click="executeSearch(rk)"
              class="px-3 py-1 bg-slate-100 hover:bg-orange-50 hover:text-orange-600 rounded-full text-slate-700 font-medium transition"
            >
              {{ rk }}
            </button>
          </div>
        </div>

        <div class="space-y-2">
          <div class="text-slate-800 font-black flex items-center gap-1.5">
            <i class="fa-solid fa-fire text-orange-600"></i>
            <span>실시간 급상승 인기 검색어</span>
          </div>
          <div class="grid grid-cols-2 gap-1.5">
            <button
              v-for="(tk, idx) in trendingKeywords"
              :key="tk.keyword"
              @click="executeSearch(tk.keyword)"
              class="flex items-center justify-between p-2 rounded-xl hover:bg-slate-50 text-left transition"
            >
              <div class="flex items-center gap-2 truncate">
                <span :class="idx < 3 ? 'text-orange-600 font-black' : 'text-slate-400 font-bold'" class="w-4 text-center">{{ idx + 1 }}</span>
                <span class="font-semibold text-slate-800 truncate">{{ tk.keyword }}</span>
                <span v-if="tk.is_promoted" class="px-1.5 py-0.5 bg-rose-50 text-rose-600 text-[9px] font-bold rounded">HOT</span>
              </div>
              <span class="text-[10px] text-slate-400 font-mono">{{ tk.search_count }}회</span>
            </button>
          </div>
        </div>

        <div v-if="recommendedCategories.length > 0" class="border-t border-slate-100 pt-3 space-y-2">
          <div class="text-slate-500 font-bold text-[11px]">추천 카테고리 바로가기</div>
          <div class="flex flex-wrap gap-1.5">
            <button
              v-for="cat in recommendedCategories"
              :key="cat.slug"
              @click="goCategory(cat.slug)"
              class="px-2.5 py-1 bg-orange-50/70 hover:bg-orange-100 text-orange-700 rounded-lg text-[11px] font-bold transition"
            >
              {{ cat.name }}
            </button>
          </div>
        </div>
      </div>

      <!-- Typed Query: Suggestions + Categories + Live Product Previews -->
      <div v-else class="divide-y divide-slate-100 text-xs">
        <div v-if="suggestions.length > 0" class="p-3 space-y-1">
          <div class="text-[10px] font-bold text-slate-400 px-2 uppercase">추천 키워드 자동완성</div>
          <button
            v-for="sug in suggestions"
            :key="sug.keyword"
            @click="executeSearch(sug.keyword)"
            class="w-full flex items-center justify-between px-3 py-2 rounded-xl hover:bg-orange-50/60 text-left transition"
          >
            <div class="flex items-center gap-2">
              <i class="fa-solid fa-magnifying-glass text-slate-400 text-[11px]"></i>
              <span class="font-bold text-slate-800">{{ sug.keyword }}</span>
            </div>
            <span v-if="sug.category_name" class="text-[10px] text-orange-600 bg-orange-50 px-2 py-0.5 rounded-full font-semibold">
              {{ sug.category_name }}
            </span>
          </button>
        </div>

        <div v-if="matchedCategories.length > 0" class="p-3 space-y-1.5">
          <div class="text-[10px] font-bold text-slate-400 px-2 uppercase">연관 카테고리</div>
          <div class="flex flex-wrap gap-1.5 px-2">
            <button
              v-for="mc in matchedCategories"
              :key="mc.slug"
              @click="goCategory(mc.slug)"
              class="px-3 py-1 bg-slate-100 hover:bg-orange-600 hover:text-white rounded-full text-slate-700 font-bold text-[11px] transition"
            >
              <i class="fa-solid fa-folder-open mr-1 text-[10px]"></i>{{ mc.name }}
            </button>
          </div>
        </div>

        <div v-if="previewProducts.length > 0" class="p-3 space-y-2">
          <div class="text-[10px] font-bold text-slate-400 px-2 uppercase">실시간 상품 미리보기</div>
          <div
            v-for="prod in previewProducts"
            :key="prod.id"
            @click="goProduct(prod.id)"
            class="flex items-center gap-3 p-2 rounded-xl hover:bg-slate-50 cursor-pointer transition"
          >
            <img :src="prod.thumbnail_url" :alt="prod.title" class="w-11 h-11 rounded-lg object-cover bg-slate-100 shrink-0" />
            <div class="flex-1 min-w-0">
              <div class="font-bold text-slate-800 truncate">{{ prod.title }}</div>
              <div class="flex items-baseline gap-2 mt-0.5">
                <span class="font-black text-orange-600">{{ localeStore.formatPrice(prod.lowest_sale_price) }}</span>
                <span class="text-[10px] text-slate-400 line-through">{{ localeStore.formatPrice(prod.lowest_original_price) }}</span>
                <span class="text-[10px] text-slate-400">· 판매 {{ prod.total_sold_count?.toLocaleString() }}개</span>
              </div>
            </div>
            <i class="fa-solid fa-chevron-right text-slate-300 text-[10px]"></i>
          </div>
        </div>

        <div v-if="!loading && suggestions.length === 0 && previewProducts.length === 0" class="p-6 text-center text-slate-400">
          '<strong>{{ searchQuery }}</strong>' 전체 검색 결과 보러가기 (Enter)
        </div>
      </div>
    </div>
  </div>
</template>
