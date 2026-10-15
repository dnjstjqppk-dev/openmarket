<script setup lang="ts">
import { ref, onMounted } from 'vue';

interface ProductItem {
  id: string;
  title: string;
  thumbnail_url: string;
  lowest_original_price: number;
  lowest_sale_price: number;
  total_sold_count: number;
  category_name?: string;
  business_name?: string;
}

const products = ref<ProductItem[]>([]);
const loading = ref(true);

const categories = [
  { id: 'all', name: '전체 추천', icon: 'fa-fire text-orange-500' },
  { id: 'cat_electronics', name: '전자·디지털', icon: 'fa-laptop text-blue-500' },
  { id: 'cat_fashion', name: '패션·의류', icon: 'fa-shirt text-pink-500' },
  { id: 'cat_home', name: '홈·주방', icon: 'fa-couch text-emerald-500' },
  { id: 'cat_beauty', name: '뷰티·케어', icon: 'fa-wand-magic-sparkles text-purple-500' },
  { id: 'cat_sports', name: '스포츠·레저', icon: 'fa-person-running text-teal-500' }
];

const selectedCategory = ref('all');

onMounted(async () => {
  try {
    const res = await fetch('https://openmarket-api.dnjstjqppk.workers.dev/api/v1/products');
    const json = await res.json();
    if (json.success && json.data) {
      products.value = json.data;
    }
  } catch (_) {
    // Fallback seed items
    products.value = [
      {
        id: 'prod_001',
        title: '초경량 액티브 노이즈캔슬링 무선 이어폰 Pro 3',
        thumbnail_url: 'https://images.unsplash.com/photo-1590658268037-6bf12165a8df?w=500',
        lowest_original_price: 129000,
        lowest_sale_price: 49900,
        total_sold_count: 1420,
        category_name: '음향기기'
      },
      {
        id: 'prod_002',
        title: '울트라 슬림 65W GaN 고속 충전기 3포트 멀티허브',
        thumbnail_url: 'https://images.unsplash.com/photo-1583863788434-e58a36330cf0?w=500',
        lowest_original_price: 59000,
        lowest_sale_price: 24500,
        total_sold_count: 3100,
        category_name: '스마트기기'
      }
    ];
  } finally {
    loading.value = false;
  }
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
          <router-link to="/checkout" class="px-6 py-3 bg-white text-orange-600 font-extrabold rounded-full text-sm hover:bg-amber-100 transition shadow-lg">
            지금 특가 쇼핑하기 &rarr;
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
        :key="cat.id"
        @click="selectedCategory = cat.id"
        class="flex items-center gap-2 px-4 py-2.5 rounded-full text-xs font-bold transition whitespace-nowrap border shrink-0"
        :class="selectedCategory === cat.id ? 'bg-orange-600 text-white border-orange-600 shadow-md' : 'bg-white text-slate-700 border-slate-200 hover:border-orange-400'"
      >
        <i :class="['fa-solid', cat.icon]"></i>
        <span>{{ cat.name }}</span>
      </button>
    </div>

    <!-- Live Products Section -->
    <section>
      <div class="flex items-center justify-between mb-4">
        <div class="flex items-center gap-2">
          <span class="w-2.5 h-6 bg-orange-600 rounded-full"></span>
          <h2 class="text-lg font-black text-slate-900">오늘의 OLMOA 베스트 특가</h2>
        </div>
        <span class="text-xs text-orange-600 font-bold flex items-center gap-1">
          <i class="fa-solid fa-bolt animate-pulse"></i>
          <span>실시간 재고 소진 임박</span>
        </span>
      </div>

      <div v-if="loading" class="text-center py-16 text-slate-400 text-xs">
        <i class="fa-solid fa-spinner fa-spin text-2xl text-orange-600 mb-2"></i>
        <p>OLMOA 글로벌 상품 목록을 불러오는 중...</p>
      </div>

      <div v-else class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3 sm:gap-4">
        <div 
          v-for="item in products" 
          :key="item.id" 
          class="bg-white rounded-2xl border border-slate-200 overflow-hidden hover:shadow-xl hover:border-orange-300 transition flex flex-col group"
        >
          <!-- Thumbnail & Discount Tag -->
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

          <!-- Product Details -->
          <div class="p-3 flex-1 flex flex-col justify-between">
            <div>
              <div class="text-[10px] font-bold text-orange-600 uppercase mb-1">{{ item.category_name || '글로벌 특가' }}</div>
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
                <span>{{ (item.total_sold_count || 1200).toLocaleString() }}개 구매</span>
                <router-link to="/checkout" class="px-2.5 py-1 bg-orange-50 hover:bg-orange-600 text-orange-600 hover:text-white rounded-lg font-bold text-[10px] transition">
                  담기
                </router-link>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  </div>
</template>
