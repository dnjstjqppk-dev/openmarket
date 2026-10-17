<script setup lang="ts">
import { ref } from 'vue';
import { useRouter } from 'vue-router';

const router = useRouter();
const searchQuery = ref('');
const selectedLang = ref('ko-KR');
const selectedCurrency = ref('KRW');

function handleSearch() {
  if (searchQuery.value.trim()) {
    router.push({ path: '/category/all', query: { q: searchQuery.value.trim() } });
  }
}
</script>

<template>
  <div class="min-h-screen flex flex-col bg-slate-50 font-sans">
    <!-- Top Announcement Bar -->
    <div class="bg-gradient-to-r from-orange-600 via-amber-500 to-orange-600 text-white text-xs py-2 px-4 text-center font-medium shadow-inner flex items-center justify-between">
      <div class="hidden md:flex items-center gap-2">
        <span class="bg-white/20 px-2 py-0.5 rounded text-[11px] font-bold">공식 슬로건</span>
        <span>내가 찾는 모든 것, 여기. (Everything You Seek. All Here.)</span>
      </div>
      <div class="mx-auto md:mx-0 flex items-center gap-4 text-[11px]">
        <span>⚡ 전 상품 100% 무료배송 & 최저가 보장제</span>
        <div class="flex items-center gap-2">
          <select v-model="selectedLang" class="bg-black/20 text-white border-0 rounded px-1.5 py-0.5 text-[11px] cursor-pointer">
            <option value="ko-KR">KR (한국어)</option>
            <option value="en-US">US (English)</option>
            <option value="ja-JP">JP (日本語)</option>
          </select>
          <select v-model="selectedCurrency" class="bg-black/20 text-white border-0 rounded px-1.5 py-0.5 text-[11px] cursor-pointer">
            <option value="KRW">KRW (₩)</option>
            <option value="USD">USD ($)</option>
            <option value="JPY">JPY (¥)</option>
          </select>
        </div>
      </div>
    </div>

    <!-- Main Navigation Header -->
    <header class="bg-white border-b border-slate-200 sticky top-0 z-30 shadow-sm">
      <div class="max-w-7xl mx-auto px-4 h-20 flex items-center justify-between gap-6">
        <!-- Logo -->
        <router-link to="/" class="flex items-center gap-2 group shrink-0">
          <img src="/olmoa-symbol.svg" alt="OLMOA" class="w-10 h-10 object-contain drop-shadow" />
          <div class="flex flex-col">
            <span class="text-2xl font-black tracking-tight text-slate-900 group-hover:text-orange-600 transition">
              <span class="text-orange-600">O</span>LMOA
            </span>
            <span class="text-[9px] tracking-wider font-bold text-slate-400 uppercase -mt-1">올모아 글로벌</span>
          </div>
        </router-link>

        <!-- Search Bar (Temu Style) -->
        <div class="flex-1 max-w-2xl">
          <form @submit.prevent="handleSearch" class="relative flex items-center">
            <input 
              v-model="searchQuery"
              type="text" 
              placeholder="무엇이든 검색하세요! 패션, 디지털, 생활용품 등 1억개 상품..."
              class="w-full pl-5 pr-14 py-3 rounded-full border-2 border-orange-500 bg-orange-50/20 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400 focus:bg-white transition"
            />
            <button 
              type="submit" 
              class="absolute right-1.5 w-10 h-10 bg-orange-600 hover:bg-orange-700 text-white rounded-full flex items-center justify-center transition shadow-md"
            >
              <i class="fa-solid fa-magnifying-glass text-sm"></i>
            </button>
          </form>
        </div>

        <!-- Header Actions -->
        <div class="flex items-center gap-4 text-slate-700 text-sm shrink-0">
          <router-link to="/orders" class="flex items-center gap-1.5 hover:text-orange-600 font-medium transition">
            <i class="fa-solid fa-box text-base text-slate-500"></i>
            <span class="hidden sm:inline text-xs">주문·배송</span>
          </router-link>
          
          <router-link to="/checkout" class="flex items-center gap-1.5 hover:text-orange-600 font-medium transition relative">
            <div class="relative">
              <i class="fa-solid fa-cart-shopping text-lg text-slate-600"></i>
              <span class="absolute -top-1.5 -right-2 bg-orange-600 text-white text-[10px] w-4 h-4 rounded-full flex items-center justify-center font-bold">1</span>
            </div>
            <span class="hidden sm:inline text-xs">장바구니</span>
          </router-link>

          <a href="https://partner.olmoa.com" target="_blank" class="hidden lg:flex items-center gap-1 text-xs px-2.5 py-1 bg-slate-100 hover:bg-slate-200 rounded-lg text-slate-700 transition">
            <i class="fa-solid fa-store text-indigo-500"></i>
            <span>셀러 입점</span>
          </a>
        </div>
      </div>

      <!-- Sub-Header Category Navigation Bar -->
      <div class="bg-slate-50 border-t border-slate-100">
        <div class="max-w-7xl mx-auto px-4 flex items-center gap-1 overflow-x-auto text-xs py-2 scrollbar-none font-semibold">
          <router-link to="/categories" class="px-3 py-1 font-bold text-orange-600 bg-orange-100/70 rounded-full flex items-center gap-1.5 shrink-0 hover:bg-orange-200">
            <i class="fa-solid fa-bars"></i>
            <span>전체 카테고리</span>
          </router-link>
          <router-link to="/category/womens-clothing" class="px-3 py-1 text-slate-700 hover:text-orange-600 shrink-0" active-class="text-orange-600 font-bold">여성의류</router-link>
          <router-link to="/category/mens-clothing" class="px-3 py-1 text-slate-700 hover:text-orange-600 shrink-0" active-class="text-orange-600 font-bold">남성의류</router-link>
          <router-link to="/category/electronics" class="px-3 py-1 text-slate-700 hover:text-orange-600 shrink-0" active-class="text-orange-600 font-bold">디지털/가전</router-link>
          <router-link to="/category/home-kitchen" class="px-3 py-1 text-slate-700 hover:text-orange-600 shrink-0" active-class="text-orange-600 font-bold">홈/주방</router-link>
          <router-link to="/category/beauty-health" class="px-3 py-1 text-slate-700 hover:text-orange-600 shrink-0" active-class="text-orange-600 font-bold">뷰티/헬스</router-link>
          <router-link to="/category/sports-outdoors" class="px-3 py-1 text-slate-700 hover:text-orange-600 shrink-0" active-class="text-orange-600 font-bold">스포츠/레저</router-link>
          <router-link to="/category/shoes-bags" class="px-3 py-1 text-slate-700 hover:text-orange-600 shrink-0" active-class="text-orange-600 font-bold">신발/가방</router-link>
          <router-link to="/category/toys-games" class="px-3 py-1 text-slate-700 hover:text-orange-600 shrink-0" active-class="text-orange-600 font-bold">완구/취미</router-link>
          <router-link to="/category/automotive" class="px-3 py-1 text-slate-700 hover:text-orange-600 shrink-0" active-class="text-orange-600 font-bold">차량용품</router-link>
          <router-link to="/category/jewelry-accessories" class="px-3 py-1 text-slate-700 hover:text-orange-600 shrink-0" active-class="text-orange-600 font-bold">주얼리/시계</router-link>
        </div>
      </div>
    </header>

    <!-- Main Router Outlet -->
    <main class="flex-1 max-w-7xl w-full mx-auto px-4 py-6">
      <router-view />
    </main>

    <!-- Global Footer -->
    <footer class="bg-slate-900 text-slate-400 pt-12 pb-8 border-t border-slate-800 text-xs">
      <div class="max-w-7xl mx-auto px-4 grid grid-cols-2 md:grid-cols-4 gap-8 mb-8">
        <div>
          <div class="flex items-center gap-2 mb-3">
            <img src="/olmoa-symbol.svg" alt="OLMOA" class="w-6 h-6 object-contain" />
            <span class="text-white font-black text-lg">OLMOA</span>
          </div>
          <p class="text-slate-400 text-xs leading-relaxed">내가 찾는 모든 것, 여기.<br>Everything You Seek. All Here.</p>
          <p class="text-slate-500 text-[11px] mt-2">전 세계 고객과 검증된 공급사를 직결하는 글로벌 오픈마켓 플랫폼</p>
        </div>
        <div>
          <h4 class="text-white font-bold mb-3 text-sm">고객 서비스</h4>
          <ul class="space-y-2">
            <li><a href="#" class="hover:text-white transition">배송 추적 및 조회</a></li>
            <li><a href="#" class="hover:text-white transition">반품 및 100% 환불 정책</a></li>
            <li><a href="#" class="hover:text-white transition">최저가 보상제 안내</a></li>
            <li><a href="#" class="hover:text-white transition">24/7 글로벌 고객센터</a></li>
          </ul>
        </div>
        <div>
          <h4 class="text-white font-bold mb-3 text-sm">파트너 및 비즈니스</h4>
          <ul class="space-y-2">
            <li><a href="https://partner.olmoa.com" class="hover:text-white transition">판매자 입점 센터</a></li>
            <li><a href="#" class="hover:text-white transition">글로벌 풀필먼트 물류</a></li>
            <li><a href="#" class="hover:text-white transition">공급사 대량 등록 가이드</a></li>
            <li><a href="https://admin.olmoa.com" class="hover:text-white transition text-slate-500">운영 관리자</a></li>
          </ul>
        </div>
        <div>
          <h4 class="text-white font-bold mb-3 text-sm">안심 결제 & 보증</h4>
          <div class="flex items-center gap-2 text-xl text-slate-400 mb-3">
            <i class="fa-brands fa-cc-visa"></i>
            <i class="fa-brands fa-cc-mastercard"></i>
            <i class="fa-brands fa-apple-pay"></i>
            <i class="fa-brands fa-google-pay"></i>
          </div>
          <p class="text-[11px] text-slate-500">모든 거래는 OLMOA 안전 에스크로 결제 시스템으로 100% 보호됩니다.</p>
        </div>
      </div>
      <div class="max-w-7xl mx-auto px-4 pt-6 border-t border-slate-800 flex flex-col sm:flex-row items-center justify-between gap-4 text-[11px] text-slate-500">
        <div>&copy; 2026 OLMOA Inc. (올모아). All Rights Reserved.</div>
        <div class="flex gap-4">
          <a href="#" class="hover:underline">이용약관</a>
          <a href="#" class="hover:underline">개인정보처리방침</a>
          <a href="#" class="hover:underline">전자상거래 표준약관</a>
        </div>
      </div>
    </footer>
  </div>
</template>
