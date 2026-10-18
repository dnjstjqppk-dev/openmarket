<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { useCartStore } from './stores/cart';
import { useLocaleStore } from './stores/locale';
import SearchAutocomplete from './components/SearchAutocomplete.vue';

const router = useRouter();
const cartStore = useCartStore();
const localeStore = useLocaleStore();

const customerName = ref('');

function checkUser() {
  customerName.value = localStorage.getItem('olmoa_customer_name') || '';
}

function handleLogout() {
  localStorage.removeItem('olmoa_customer_id');
  localStorage.removeItem('olmoa_customer_name');
  customerName.value = '';
  router.push('/');
}

onMounted(() => {
  checkUser();
});
</script>

<template>
  <div class="min-h-screen flex flex-col bg-slate-50 font-sans">
    <!-- Top Announcement Bar -->
    <div class="bg-gradient-to-r from-orange-600 via-amber-500 to-orange-600 text-white text-xs py-2 px-4 text-center font-medium shadow-inner flex items-center justify-between">
      <div class="hidden md:flex items-center gap-2">
        <span class="bg-white/20 px-2 py-0.5 rounded text-[11px] font-bold">공식 슬로건</span>
        <span>{{ localeStore.t('slogan') }}</span>
      </div>
      <div class="mx-auto md:mx-0 flex items-center gap-4 text-[11px]">
        <span>⚡ {{ localeStore.t('freeShipping') }}</span>
        <div class="flex items-center gap-2">
          <select 
            :value="localeStore.currentLocale" 
            @change="localeStore.setLocale(($event.target as HTMLSelectElement).value as any)"
            class="bg-black/20 text-white border-0 rounded px-1.5 py-0.5 text-[11px] cursor-pointer"
          >
            <option value="ko-KR">KR (한국어)</option>
            <option value="en-US">US (English)</option>
            <option value="ja-JP">JP (日本語)</option>
          </select>
          <select 
            :value="localeStore.currentCurrency" 
            @change="localeStore.setCurrency(($event.target as HTMLSelectElement).value as any)"
            class="bg-black/20 text-white border-0 rounded px-1.5 py-0.5 text-[11px] cursor-pointer font-bold"
          >
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

        <!-- Search Bar with Real Autocomplete -->
        <div class="flex-1 max-w-2xl">
          <SearchAutocomplete />
        </div>

        <!-- Header Actions -->
        <div class="flex items-center gap-4 text-slate-700 text-sm shrink-0">
          <div v-if="customerName" class="flex items-center gap-2">
            <span class="text-xs font-bold text-slate-800">{{ customerName }}님</span>
            <button @click="handleLogout" class="text-[11px] text-slate-400 hover:text-slate-700 underline">
              {{ localeStore.t('logout') }}
            </button>
          </div>
          <router-link v-else to="/login" class="flex items-center gap-1.5 hover:text-orange-600 font-medium transition">
            <i class="fa-regular fa-user text-base text-slate-500"></i>
            <span class="hidden sm:inline text-xs">{{ localeStore.t('login') }}</span>
          </router-link>

          <router-link to="/orders" class="flex items-center gap-1.5 hover:text-orange-600 font-medium transition">
            <i class="fa-solid fa-box text-base text-slate-500"></i>
            <span class="hidden sm:inline text-xs">{{ localeStore.t('orders') }}</span>
          </router-link>
          
          <router-link to="/cart" class="flex items-center gap-1.5 hover:text-orange-600 font-medium transition relative">
            <div class="relative">
              <i class="fa-solid fa-cart-shopping text-lg text-slate-600"></i>
              <span 
                v-if="cartStore.totalCount > 0"
                class="absolute -top-1.5 -right-2 bg-orange-600 text-white text-[10px] min-w-4 h-4 px-1 rounded-full flex items-center justify-center font-bold"
              >
                {{ cartStore.totalCount }}
              </span>
            </div>
            <span class="hidden sm:inline text-xs font-bold">{{ localeStore.t('cart') }}</span>
          </router-link>
        </div>
      </div>

      <!-- Category Quick Sub-Bar -->
      <div class="bg-orange-50/50 border-t border-orange-100/50 px-4 py-2 text-xs overflow-x-auto">
        <div class="max-w-7xl mx-auto flex items-center gap-6 whitespace-nowrap">
          <router-link to="/categories" class="px-3 py-1 font-bold text-orange-600 bg-orange-100/70 rounded-full flex items-center gap-1.5 shrink-0 hover:bg-orange-200">
            <i class="fa-solid fa-bars"></i>
            <span>{{ localeStore.t('allCategories') }} (33)</span>
          </router-link>
          <router-link to="/category/fashion" class="hover:text-orange-600 font-medium transition">의류/패션</router-link>
          <router-link to="/category/electronics" class="hover:text-orange-600 font-medium transition">전자/디지털</router-link>
          <router-link to="/category/home-kitchen" class="hover:text-orange-600 font-medium transition">홈/주방</router-link>
          <router-link to="/category/beauty-health" class="hover:text-orange-600 font-medium transition">뷰티/헬스</router-link>
          <router-link to="/category/sports-outdoors" class="hover:text-orange-600 font-medium transition">스포츠/레저</router-link>
          <span class="text-orange-600 font-bold flex items-center gap-1 shrink-0 ml-auto">
            <i class="fa-solid fa-bolt"></i> {{ localeStore.t('flashDeals') }}
          </span>
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
            <li><router-link to="/orders" class="hover:text-white transition">배송 추적 및 주문 조회</router-link></li>
            <li><router-link to="/legal/refund" class="hover:text-white transition font-bold text-orange-400">90일 무조건 무료반품 정책</router-link></li>
            <li><router-link to="/legal/terms" class="hover:text-white transition">최저가 보상제 이용안내</router-link></li>
            <li><span class="text-slate-300">고객행복센터 1588-0000 (24/7)</span></li>
          </ul>
        </div>
        <div>
          <h4 class="text-white font-bold mb-3 text-sm">파트너 및 비즈니스</h4>
          <ul class="space-y-2">
            <li><a href="https://openmarket-partner.dnjstjqppk.workers.dev" target="_blank" class="hover:text-white transition">판매자 입점 센터</a></li>
            <li><router-link to="/categories" class="hover:text-white transition">글로벌 33대 카테고리</router-link></li>
            <li><a href="https://openmarket-admin.dnjstjqppk.workers.dev" target="_blank" class="hover:text-white transition text-slate-500">운영 관리자 콘솔</a></li>
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
      <div class="max-w-7xl mx-auto px-4 pt-6 border-t border-slate-800 space-y-3 text-[11px] text-slate-500">
        <div class="flex flex-wrap gap-x-6 gap-y-1">
          <span>상호명: (주)올모아 (OLMOA Inc.)</span>
          <span>대표이사: 강원섭</span>
          <span>사업자등록번호: 101-88-99999</span>
          <span>통신판매업신고: 제2026-서울강남-01234호</span>
          <span>주소: 서울특별시 강남구 테헤란로 152</span>
        </div>
        <div class="flex flex-col sm:flex-row items-center justify-between gap-4 pt-2 border-t border-slate-800/60">
          <div>&copy; 2026 OLMOA Inc. (올모아). All Rights Reserved.</div>
          <div class="flex gap-4">
            <router-link to="/legal/terms" class="hover:underline text-slate-400">이용약관</router-link>
            <router-link to="/legal/privacy" class="hover:underline text-slate-400">개인정보처리방침</router-link>
            <router-link to="/legal/refund" class="hover:underline text-slate-400">90일 무료반품규정</router-link>
          </div>
        </div>
      </div>
    </footer>
  </div>
</template>
