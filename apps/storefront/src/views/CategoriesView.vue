<script setup lang="ts">
import { ref } from 'vue';

interface CategoryCard {
  id: string;
  name: string;
  slug: string;
  icon: string;
  subcategories: { name: string; slug: string }[];
}

const categories = ref<CategoryCard[]>([
  {
    id: 'cat_women',
    name: '여성의류',
    slug: 'womens-clothing',
    icon: 'fa-person-dress text-pink-500',
    subcategories: [
      { name: '원피스/스커트', slug: 'dresses-skirts' },
      { name: '블라우스/셔츠', slug: 'women-tops' },
      { name: '니트/가디건', slug: 'women-knit' },
      { name: '팬츠/청바지', slug: 'women-pants' }
    ]
  },
  {
    id: 'cat_men',
    name: '남성의류',
    slug: 'mens-clothing',
    icon: 'fa-shirt text-blue-500',
    subcategories: [
      { name: '티셔츠/맨투맨', slug: 'men-tshirts' },
      { name: '팬츠/슬랙스', slug: 'men-pants' },
      { name: '셔츠/남방', slug: 'men-shirts' },
      { name: '아우터/자켓', slug: 'men-outer' }
    ]
  },
  {
    id: 'cat_electronics',
    name: '디지털/가전',
    slug: 'electronics',
    icon: 'fa-laptop text-indigo-500',
    subcategories: [
      { name: '무선이어폰/헤드폰', slug: 'wireless-audio' },
      { name: '충전기/보조배터리', slug: 'chargers-power' },
      { name: '스마트워치/밴드', slug: 'smart-wearables' },
      { name: '컴퓨터 주변기기', slug: 'pc-accessories' }
    ]
  },
  {
    id: 'cat_home',
    name: '홈/주방',
    slug: 'home-kitchen',
    icon: 'fa-couch text-emerald-500',
    subcategories: [
      { name: '주방용품/조리기구', slug: 'kitchen-cookware' },
      { name: '인테리어/수납', slug: 'home-decor' },
      { name: '침구/패브릭', slug: 'bedding-fabric' },
      { name: '욕실/청소용품', slug: 'bath-cleaning' }
    ]
  },
  {
    id: 'cat_beauty',
    name: '뷰티/헬스',
    slug: 'beauty-health',
    icon: 'fa-wand-magic-sparkles text-purple-500',
    subcategories: [
      { name: '스킨케어/보습', slug: 'skin-care' },
      { name: '미용소품/브러시', slug: 'beauty-tools' },
      { name: '헤어/바디케어', slug: 'hair-body' },
      { name: '건강관리용품', slug: 'health-care' }
    ]
  },
  {
    id: 'cat_sports',
    name: '스포츠/레저',
    slug: 'sports-outdoors',
    icon: 'fa-person-running text-teal-500',
    subcategories: [
      { name: '피트니스/요가', slug: 'fitness-yoga' },
      { name: '캠핑/등산', slug: 'camping-outdoor' },
      { name: '골프/라켓', slug: 'golf-rackets' },
      { name: '자전거/익스트림', slug: 'cycling' }
    ]
  },
  {
    id: 'cat_shoes_bags',
    name: '신발/가방',
    slug: 'shoes-bags',
    icon: 'fa-bag-shopping text-amber-500',
    subcategories: [
      { name: '백팩/크로스백', slug: 'backpacks-bags' },
      { name: '스니커즈/슬리퍼', slug: 'sneakers-shoes' },
      { name: '지갑/카드홀더', slug: 'wallets' },
      { name: '캐리어/여행용품', slug: 'luggage' }
    ]
  },
  {
    id: 'cat_toys',
    name: '완구/취미',
    slug: 'toys-games',
    icon: 'fa-gamepad text-rose-500',
    subcategories: [
      { name: '블록/퍼즐', slug: 'blocks-puzzles' },
      { name: '피규어/수집품', slug: 'figures' },
      { name: 'RC카/드론', slug: 'rc-toys' },
      { name: '보드게임/파티', slug: 'board-games' }
    ]
  },
  {
    id: 'cat_auto',
    name: '차량용품',
    slug: 'automotive',
    icon: 'fa-car text-cyan-600',
    subcategories: [
      { name: '차량거치대/액세서리', slug: 'car-mounts' },
      { name: '방향제/공기정화', slug: 'car-air' },
      { name: '세차/관리용품', slug: 'car-wash' },
      { name: '차량 수납/매트', slug: 'car-storage' }
    ]
  },
  {
    id: 'cat_jewelry',
    name: '주얼리/시계',
    slug: 'jewelry-accessories',
    icon: 'fa-gem text-yellow-600',
    subcategories: [
      { name: '패션시계/스트랩', slug: 'watches-straps' },
      { name: '목걸이/펜던트', slug: 'necklaces' },
      { name: '반지/귀걸이', slug: 'rings-earrings' },
      { name: '헤어액세서리', slug: 'hair-accessories' }
    ]
  }
]);
</script>

<template>
  <div class="space-y-6">
    <div class="border-b border-slate-200 pb-4">
      <h1 class="text-2xl font-black text-slate-900">전체 상품 카테고리</h1>
      <p class="text-xs text-slate-500 mt-1">OLMOA의 모든 카테고리별 전문 상품관을 한눈에 둘러보세요.</p>
    </div>

    <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
      <div 
        v-for="cat in categories" 
        :key="cat.id"
        class="bg-white rounded-3xl p-6 border border-slate-200 shadow-sm hover:shadow-md transition space-y-4"
      >
        <div class="flex items-center justify-between border-b border-slate-100 pb-3">
          <router-link :to="`/category/${cat.slug}`" class="flex items-center gap-3 group">
            <div class="w-10 h-10 rounded-2xl bg-slate-50 flex items-center justify-center text-lg border border-slate-100 group-hover:scale-110 transition">
              <i :class="['fa-solid', cat.icon]"></i>
            </div>
            <div>
              <h2 class="font-extrabold text-slate-900 text-base group-hover:text-orange-600 transition">{{ cat.name }}</h2>
              <span class="text-[10px] text-slate-400 font-mono">{{ cat.slug }}</span>
            </div>
          </router-link>
          <router-link :to="`/category/${cat.slug}`" class="text-xs font-bold text-orange-600 hover:underline">
            전체보기 &rarr;
          </router-link>
        </div>

        <div class="grid grid-cols-2 gap-2 text-xs">
          <router-link 
            v-for="sub in cat.subcategories" 
            :key="sub.slug"
            :to="`/category/${sub.slug}`"
            class="p-2.5 rounded-xl bg-slate-50 hover:bg-orange-50 text-slate-700 hover:text-orange-600 font-medium transition text-center truncate"
          >
            {{ sub.name }}
          </router-link>
        </div>
      </div>
    </div>
  </div>
</template>
