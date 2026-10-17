<script setup lang="ts">
import { ref, onMounted } from 'vue';

interface CategoryItem {
  id: string;
  parent_id: string | null;
  name: string;
  slug: string;
  depth: number;
  sort_order: number;
}

interface RootCategoryWithSubs {
  id: string;
  name: string;
  slug: string;
  icon: string;
  subcategories: { id: string; name: string; slug: string }[];
}

const rootCategories = ref<RootCategoryWithSubs[]>([]);
const loading = ref(true);

const iconMap: Record<string, string> = {
  'womens-clothing': 'fa-person-dress text-pink-500',
  'mens-clothing': 'fa-shirt text-blue-500',
  'electronics': 'fa-laptop text-indigo-500',
  'home-kitchen': 'fa-couch text-emerald-500',
  'beauty-health': 'fa-wand-magic-sparkles text-purple-500',
  'sports-outdoors': 'fa-person-running text-teal-500',
  'shoes-bags': 'fa-bag-shopping text-amber-500',
  'toys-games': 'fa-gamepad text-rose-500',
  'automotive': 'fa-car text-cyan-500',
  'jewelry-accessories': 'fa-gem text-yellow-500',
  'bedding-bath': 'fa-bed text-indigo-400',
  'furniture-interior': 'fa-chair text-amber-600',
  'home-appliances': 'fa-blender text-blue-400',
  'cellphones-accessories': 'fa-mobile-screen text-slate-700',
  'smart-home-iot': 'fa-house-signal text-emerald-600',
  'health-fitness': 'fa-heart-pulse text-red-500',
  'baby-maternity': 'fa-baby text-pink-400',
  'pet-supplies': 'fa-paw text-amber-500',
  'office-stationery': 'fa-pen-ruler text-sky-500',
  'books-media': 'fa-book text-emerald-700',
  'arts-crafts-sewing': 'fa-palette text-purple-600',
  'tools-home-improvement': 'fa-wrench text-slate-600',
  'patio-lawn-garden': 'fa-seedling text-green-500',
  'food-beverages': 'fa-utensils text-orange-500',
  'video-games-gaming': 'fa-headset text-indigo-600',
  'musical-instruments': 'fa-guitar text-rose-600',
  'security-surveillance': 'fa-video text-slate-800',
  'travel-outdoor-gear': 'fa-compass text-teal-600',
  'watches-wearables': 'fa-clock text-blue-600',
  'holiday-party-supplies': 'fa-champagne-glasses text-yellow-500',
  'industrial-scientific': 'fa-microscope text-cyan-600',
  'giftcards-digital': 'fa-ticket text-rose-500'
};

onMounted(async () => {
  try {
    const res = await fetch('https://olmoa-api.dnjstjqppk.workers.dev/api/v1/categories');
    const json = await res.json();
    if (json.success && json.data) {
      const all: CategoryItem[] = json.data;
      const roots = all.filter(c => !c.parent_id);
      const subs = all.filter(c => c.parent_id);

      rootCategories.value = roots.map(r => ({
        id: r.id,
        name: r.name,
        slug: r.slug,
        icon: iconMap[r.slug] || 'fa-tag text-slate-500',
        subcategories: subs.filter(s => s.parent_id === r.id)
      }));
    }
  } catch (_) {
  } finally {
    loading.value = false;
  }
});
</script>

<template>
  <div class="space-y-6">
    <div class="bg-gradient-to-r from-orange-600 to-amber-500 text-white rounded-3xl p-6 sm:p-8 shadow-lg">
      <div class="max-w-xl space-y-2">
        <span class="text-xs font-bold text-amber-200 tracking-wider uppercase">OLMOA Global Category Taxonomy</span>
        <h1 class="text-2xl sm:text-3xl font-black">전체 33개 카테고리</h1>
        <p class="text-xs sm:text-sm text-white/90">
          내가 찾는 모든 것, 여기! Temu 수준의 방대한 글로벌 카테고리 상품을 만나보세요.
        </p>
      </div>
    </div>

    <div v-if="loading" class="py-16 text-center text-slate-400">
      <i class="fa-solid fa-spinner fa-spin text-3xl mb-3 text-orange-500"></i>
      <p class="text-xs font-bold">카테고리 트리를 불러오는 중입니다...</p>
    </div>

    <!-- 33 Root Categories Visual Cards Grid -->
    <div v-else class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      <div 
        v-for="cat in rootCategories" 
        :key="cat.id" 
        class="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm hover:shadow-md transition space-y-3"
      >
        <div class="flex items-center justify-between border-b border-slate-100 pb-3">
          <router-link :to="'/category/' + cat.slug" class="flex items-center gap-3 group">
            <div class="w-10 h-10 rounded-xl bg-slate-50 flex items-center justify-center text-lg group-hover:bg-orange-50 transition">
              <i :class="['fa-solid', cat.icon]"></i>
            </div>
            <div>
              <h3 class="font-black text-slate-900 text-sm group-hover:text-orange-600 transition">{{ cat.name }}</h3>
              <span class="text-[10px] text-slate-400 font-mono">{{ cat.slug }}</span>
            </div>
          </router-link>
          <router-link :to="'/category/' + cat.slug" class="text-xs text-orange-600 font-bold hover:underline">
            전체보기 &rarr;
          </router-link>
        </div>

        <!-- Subcategories -->
        <div v-if="cat.subcategories.length > 0" class="flex flex-wrap gap-1.5 pt-1">
          <router-link 
            v-for="sub in cat.subcategories" 
            :key="sub.id"
            :to="'/category/' + sub.slug"
            class="px-2.5 py-1 bg-slate-50 hover:bg-orange-50 text-slate-600 hover:text-orange-600 rounded-lg text-[11px] font-medium transition"
          >
            {{ sub.name }}
          </router-link>
        </div>
        <div v-else class="text-[11px] text-slate-400">
          <router-link :to="'/category/' + cat.slug" class="hover:text-orange-600">
            {{ cat.name }} 특가 상품 바로보기 &rarr;
          </router-link>
        </div>
      </div>
    </div>
  </div>
</template>
