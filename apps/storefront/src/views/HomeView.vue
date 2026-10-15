<script setup lang="ts">
import { ref } from 'vue';

interface Product {
  id: string;
  brand: string;
  name: string;
  price: number;
  origPrice: number;
  sold: string;
  img: string;
}

const activeCategory = ref('ALL');
const timer = ref('04:18:32');

const products = ref<Product[]>([
  { id: 'p-1', brand: 'Anker Official', name: 'Soundcore Space Q45 ANC 무선 헤드폰', price: 49900, origPrice: 149000, sold: '2.4만+', img: '🎧' },
  { id: 'p-2', brand: 'Baseus Korea', name: '블레이드 100W 초고속 보조배터리 20000mAh', price: 28900, origPrice: 69000, sold: '1.8만+', img: '🔋' },
  { id: 'p-3', brand: 'Urban Fit', name: '헤비웨이트 기모 오버핏 후드 집업', price: 19800, origPrice: 58000, sold: '3.1만+', img: '🧥' },
  { id: 'p-4', brand: 'Nordic Home', name: '호텔식 60수 고밀도 순면 베개커버 2P', price: 9900, origPrice: 28000, sold: '9,400+', img: '🛏️' },
  { id: 'p-5', brand: 'Spigen Life', name: '맥세이프 3-in-1 초고속 무선충전 스탠드', price: 34900, origPrice: 89000, sold: '1.2만+', img: '📱' },
  { id: 'p-6', brand: 'Pro Travel', name: '20인치 초경량 알루미늄 프레임 기내용 캐리어', price: 38900, origPrice: 120000, sold: '7,800+', img: '🧳' }
]);
</script>

<template>
  <div class="space-y-6">
    <!-- Category Tabs -->
    <nav class="flex gap-2 overflow-x-auto pb-2 text-xs font-medium text-gray-700 whitespace-nowrap">
      <button @click="activeCategory = 'ALL'" :class="activeCategory === 'ALL' ? 'bg-red-600 text-white font-bold' : 'bg-gray-100 hover:bg-gray-200'" class="px-3 py-1.5 rounded-full transition">🔥 전체</button>
      <button @click="activeCategory = 'electronics'" class="px-3 py-1.5 bg-gray-100 hover:bg-gray-200 rounded-full transition">디지털 & 컴퓨터</button>
      <button @click="activeCategory = 'fashion'" class="px-3 py-1.5 bg-gray-100 hover:bg-gray-200 rounded-full transition">패션의류</button>
      <button @click="activeCategory = 'home'" class="px-3 py-1.5 bg-gray-100 hover:bg-gray-200 rounded-full transition">홈 & 리빙</button>
      <button @click="activeCategory = 'travel'" class="px-3 py-1.5 bg-gray-100 hover:bg-gray-200 rounded-full transition">여행 & 아웃도어</button>
    </nav>

    <!-- Flash Sale Banner -->
    <section class="bg-gradient-to-r from-red-600 via-orange-500 to-amber-500 rounded-2xl p-6 text-white shadow-md flex flex-col sm:flex-row items-center justify-between gap-4">
      <div>
        <div class="inline-flex items-center gap-1.5 bg-black/30 px-3 py-1 rounded-full text-xs font-bold text-yellow-300 mb-2">
          <span>⚡</span> <span>번개특가 (Lightning Deals)</span>
        </div>
        <h2 class="text-2xl sm:text-3xl font-black tracking-tight">선착순 최대 89% 파격 할인</h2>
        <p class="text-xs text-white/90 mt-1">인기 브랜드 공식 입점 상품 매일 정오 / 자정 갱신</p>
      </div>
      <div class="bg-black/30 px-5 py-3 rounded-xl border border-white/20 text-center">
        <div class="text-[10px] text-yellow-300 font-bold uppercase">마감까지</div>
        <div class="text-2xl font-mono font-bold tracking-widest text-white mt-0.5">{{ timer }}</div>
      </div>
    </section>

    <!-- Products Grid -->
    <section>
      <h3 class="text-lg font-black text-gray-900 mb-4">실시간 인기 특가 상품</h3>
      <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-4">
        <div v-for="p in products" :key="p.id" class="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm p-3 flex flex-col justify-between">
          <div>
            <div class="bg-gray-100 rounded-lg h-36 flex items-center justify-center text-5xl">{{ p.img }}</div>
            <div class="mt-2 text-[10px] text-blue-600 font-bold">{{ p.brand }}</div>
            <h4 class="font-bold text-xs text-gray-800 line-clamp-2 mt-0.5">{{ p.name }}</h4>
            <div class="mt-2 flex items-baseline gap-1.5">
              <span class="text-base font-black text-red-600">₩ {{ p.price.toLocaleString() }}</span>
              <span class="text-[11px] text-gray-400 line-through">₩ {{ p.origPrice.toLocaleString() }}</span>
            </div>
          </div>
          <button class="mt-3 w-full bg-red-600 hover:bg-red-700 text-white font-bold py-1.5 rounded-lg text-xs transition">장바구니 담기</button>
        </div>
      </div>
    </section>
  </div>
</template>
