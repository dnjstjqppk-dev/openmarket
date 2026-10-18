<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from 'vue';
import { useRouter } from 'vue-router';
import { API_BASE_URL } from '../config';

const router = useRouter();
const query = ref('');
const isOpen = ref(false);
const trendingKeywords = ref<any[]>([]);
const suggestions = ref<any[]>([]);
const matchedCategories = ref<any[]>([]);
const searchContainer = ref<HTMLElement | null>(null);
let debounceTimer: any = null;

async function loadTrending() {
  try {
    const res = await fetch(`${API_BASE_URL}/api/v1/search/trending`);
    if (res.ok) {
      const json = await res.json();
      trendingKeywords.value = json.trending_keywords || [];
    }
  } catch (_) {}
}

async function fetchSuggestions(val: string) {
  if (!val.trim()) {
    suggestions.value = [];
    matchedCategories.value = [];
    return;
  }
  try {
    const res = await fetch(`${API_BASE_URL}/api/v1/search/autocomplete?q=${encodeURIComponent(val.trim())}`);
    if (res.ok) {
      const json = await res.json();
      suggestions.value = json.suggestions || [];
      matchedCategories.value = json.categories || [];
    }
  } catch (_) {}
}

function handleInput() {
  isOpen.value = true;
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    fetchSuggestions(query.value);
  }, 250);
}

function selectKeyword(kw: string) {
  query.value = kw;
  isOpen.value = false;
  router.push({ path: '/search', query: { q: kw } });
}

function selectCategory(slug: string) {
  isOpen.value = false;
  router.push(`/category/${slug}`);
}

function submitSearch() {
  if (query.value.trim()) {
    selectKeyword(query.value.trim());
  }
}

function handleClickOutside(e: MouseEvent) {
  if (searchContainer.value && !searchContainer.value.contains(e.target as Node)) {
    isOpen.value = false;
  }
}

onMounted(() => {
  loadTrending();
  document.addEventListener('click', handleClickOutside);
});

onBeforeUnmount(() => {
  document.removeEventListener('click', handleClickOutside);
});
</script>

<template>
  <div ref="searchContainer" class="relative w-full max-w-2xl">
    <form @submit.prevent="submitSearch" class="relative flex items-center">
      <input 
        v-model="query"
        type="text" 
        placeholder="무엇이든 검색하세요! 패션, 디지털, 생활용품 등 1억개 상품..."
        @focus="isOpen = true"
        @input="handleInput"
        class="w-full pl-5 pr-14 py-3 rounded-full border-2 border-orange-500 bg-orange-50/20 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400 focus:bg-white transition"
      />
      <button 
        type="submit" 
        class="absolute right-1.5 w-10 h-10 bg-orange-600 hover:bg-orange-700 text-white rounded-full flex items-center justify-center transition shadow-md"
      >
        <i class="fa-solid fa-magnifying-glass text-sm"></i>
      </button>
    </form>

    <!-- Autocomplete Dropdown -->
    <div 
      v-if="isOpen" 
      class="absolute left-0 right-0 top-full mt-2 bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden z-50 text-xs divide-y divide-slate-100"
    >
      <!-- Suggestions List when typing -->
      <div v-if="query.trim().length > 0" class="p-3 space-y-1">
        <div v-if="suggestions.length === 0 && matchedCategories.length === 0" class="py-3 text-center text-slate-400">
          연관 검색어가 없습니다.
        </div>
        <div 
          v-for="s in suggestions" 
          :key="s.keyword"
          @click="selectKeyword(s.keyword)"
          class="flex items-center justify-between px-3 py-2 rounded-xl hover:bg-orange-50 cursor-pointer group transition"
        >
          <div class="flex items-center gap-2">
            <i class="fa-solid fa-magnifying-glass text-slate-300 group-hover:text-orange-500 text-[11px]"></i>
            <span class="font-medium text-slate-800 group-hover:text-orange-600">{{ s.keyword }}</span>
          </div>
          <span v-if="s.category_name" class="px-2 py-0.5 bg-slate-100 text-slate-500 rounded-md text-[10px]">
            {{ s.category_name }}
          </span>
        </div>

        <div v-if="matchedCategories.length > 0" class="pt-2 border-t border-slate-100">
          <div class="text-[10px] text-slate-400 font-bold px-3 py-1">카테고리 바로가기</div>
          <div 
            v-for="cat in matchedCategories" 
            :key="cat.id"
            @click="selectCategory(cat.slug)"
            class="flex items-center gap-2 px-3 py-1.5 rounded-lg hover:bg-slate-50 cursor-pointer text-slate-700 font-medium"
          >
            <i class="fa-solid fa-tag text-orange-400 text-[11px]"></i>
            <span>{{ cat.name }} 카테고리 이동 &rarr;</span>
          </div>
        </div>
      </div>

      <!-- Trending Keywords when empty -->
      <div v-else class="p-4 space-y-3">
        <div class="flex items-center justify-between text-slate-500 font-bold text-[11px]">
          <span><i class="fa-solid fa-fire text-orange-500 mr-1.5"></i>실시간 급상승 인기 키워드</span>
          <span class="text-[10px] text-slate-400 font-normal">D1 실시간 집계</span>
        </div>
        <div class="grid grid-cols-2 gap-1.5">
          <div 
            v-for="(kw, idx) in trendingKeywords" 
            :key="kw.keyword"
            @click="selectKeyword(kw.keyword)"
            class="flex items-center gap-2 px-2.5 py-1.5 rounded-lg hover:bg-orange-50 cursor-pointer group transition"
          >
            <span class="font-bold text-[11px] w-4 text-center" :class="idx < 3 ? 'text-orange-600' : 'text-slate-400'">
              {{ idx + 1 }}
            </span>
            <span class="text-slate-700 group-hover:text-orange-600 truncate">{{ kw.keyword }}</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
