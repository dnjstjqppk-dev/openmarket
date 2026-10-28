<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { useRouter, useRoute } from 'vue-router';

const router = useRouter();
const route = useRoute();
const mobileMenuOpen = ref(false);

const isLoginPage = computed(() => route.path === '/login');
const partnerName = 'Global Direct Logistics Ltd.';

function handleLogout() {
  localStorage.removeItem('partner_token');
  router.push('/login');
}

watch(() => route.path, () => {
  mobileMenuOpen.value = false;
});
</script>

<template>
  <div class="min-h-screen flex flex-col bg-slate-50 font-sans">
    <!-- Top Navigation Bar for Authenticated Partner -->
    <header v-if="!isLoginPage" class="bg-indigo-950 text-white shadow-md sticky top-0 z-30">
      <div class="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
        <div class="flex items-center gap-6">
          <div class="flex items-center gap-2.5 font-black text-xl tracking-tight text-white">
            <img src="/olmoa-symbol.svg" alt="OLMOA" class="w-8 h-8 object-contain" />
            <span><span class="text-orange-500">O</span>LMOA <span class="text-indigo-300 font-normal text-sm">Partner Center</span></span>
          </div>
          <!-- Desktop Nav Links -->
          <nav class="hidden md:flex items-center gap-1 text-xs font-semibold">
            <router-link to="/" class="px-3 py-2 rounded-lg hover:bg-indigo-900 transition" active-class="bg-indigo-900 text-amber-400">대시보드</router-link>
            <router-link to="/products" class="px-3 py-2 rounded-lg hover:bg-indigo-900 transition" active-class="bg-indigo-900 text-amber-400">상품 관리</router-link>
            <router-link to="/bulk-upload" class="px-3 py-2 rounded-lg hover:bg-indigo-900 transition" active-class="bg-indigo-900 text-amber-400">대량 등록</router-link>
            <router-link to="/shipments" class="px-3 py-2 rounded-lg hover:bg-indigo-900 transition" active-class="bg-indigo-900 text-amber-400">주문·배송</router-link>
            <router-link to="/settlements" class="px-3 py-2 rounded-lg hover:bg-indigo-900 transition" active-class="bg-indigo-900 text-amber-400">정산 내역</router-link>
            <router-link to="/qna" class="px-3 py-2 rounded-lg hover:bg-indigo-900 transition" active-class="bg-indigo-900 text-amber-400">Q&A 문의</router-link>
            <router-link to="/profile" class="px-3 py-2 rounded-lg hover:bg-indigo-900 transition" active-class="bg-indigo-900 text-amber-400">스토어 설정</router-link>
          </nav>
        </div>

        <div class="flex items-center gap-3 text-xs">
          <div class="hidden sm:flex items-center gap-2 bg-indigo-900/80 px-3 py-1.5 rounded-full border border-indigo-700">
            <span class="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
            <span class="text-xs text-indigo-200 font-mono">{{ partnerName }}</span>
          </div>
          <button @click="handleLogout" class="hidden sm:flex items-center text-xs text-indigo-300 hover:text-white transition cursor-pointer">
            <i class="fa-solid fa-right-from-bracket mr-1"></i>로그아웃
          </button>
          <!-- Mobile Hamburger Toggle -->
          <button
            @click="mobileMenuOpen = !mobileMenuOpen"
            class="md:hidden p-2 text-indigo-200 hover:text-white focus:outline-none"
            aria-label="Toggle Menu"
          >
            <i :class="mobileMenuOpen ? 'fa-solid fa-xmark text-lg' : 'fa-solid fa-bars text-lg'"></i>
          </button>
        </div>
      </div>

      <!-- Mobile Dropdown Menu -->
      <div v-if="mobileMenuOpen" class="md:hidden border-t border-indigo-900 bg-indigo-950 px-4 py-3 space-y-1">
        <div class="flex items-center gap-2 pb-2 mb-2 border-b border-indigo-900 text-xs text-indigo-300">
          <span class="w-2 h-2 rounded-full bg-emerald-400"></span>
          <span class="font-mono">{{ partnerName }}</span>
        </div>
        <router-link to="/" class="block px-3 py-2 rounded-lg text-xs font-semibold text-indigo-200 hover:bg-indigo-900" active-class="bg-indigo-900 text-amber-400">
          대시보드
        </router-link>
        <router-link to="/products" class="block px-3 py-2 rounded-lg text-xs font-semibold text-indigo-200 hover:bg-indigo-900" active-class="bg-indigo-900 text-amber-400">
          상품 관리
        </router-link>
        <router-link to="/bulk-upload" class="block px-3 py-2 rounded-lg text-xs font-semibold text-indigo-200 hover:bg-indigo-900" active-class="bg-indigo-900 text-amber-400">
          대량 등록 (CSV)
        </router-link>
        <router-link to="/shipments" class="block px-3 py-2 rounded-lg text-xs font-semibold text-indigo-200 hover:bg-indigo-900" active-class="bg-indigo-900 text-amber-400">
          주문·배송 관리
        </router-link>
        <router-link to="/settlements" class="block px-3 py-2 rounded-lg text-xs font-semibold text-indigo-200 hover:bg-indigo-900" active-class="bg-indigo-900 text-amber-400">
          정산 내역
        </router-link>
        <router-link to="/qna" class="block px-3 py-2 rounded-lg text-xs font-semibold text-indigo-200 hover:bg-indigo-900" active-class="bg-indigo-900 text-amber-400">
          고객 Q&A 문의
        </router-link>
        <router-link to="/profile" class="block px-3 py-2 rounded-lg text-xs font-semibold text-indigo-200 hover:bg-indigo-900" active-class="bg-indigo-900 text-amber-400">
          스토어·정산 계좌 설정
        </router-link>
        <div class="pt-2 border-t border-indigo-900">
          <button @click="handleLogout" class="w-full text-left px-3 py-2 text-xs text-rose-300 hover:bg-indigo-900 rounded-lg">
            <i class="fa-solid fa-right-from-bracket mr-1.5"></i>로그아웃
          </button>
        </div>
      </div>
    </header>

    <!-- Main Content Area (padding bottom on mobile for sticky bottom bar) -->
    <main :class="['flex-1 max-w-7xl w-full mx-auto px-4 py-6 sm:py-8', !isLoginPage ? 'pb-24 md:pb-8' : '']">
      <router-view />
    </main>

    <!-- Mobile Sticky Bottom Navigation Bar for Sellers -->
    <nav
      v-if="!isLoginPage"
      class="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-indigo-950/98 backdrop-blur border-t border-indigo-900 flex items-center justify-around py-2 px-1 text-slate-400 text-[10px]"
    >
      <router-link to="/" class="flex flex-col items-center gap-0.5 py-1 px-1.5 rounded hover:text-white" active-class="text-amber-400 font-bold">
        <i class="fa-solid fa-chart-pie text-sm"></i>
        <span>대시보드</span>
      </router-link>
      <router-link to="/products" class="flex flex-col items-center gap-0.5 py-1 px-1.5 rounded hover:text-white" active-class="text-amber-400 font-bold">
        <i class="fa-solid fa-boxes-stacked text-sm"></i>
        <span>상품관리</span>
      </router-link>
      <router-link to="/shipments" class="flex flex-col items-center gap-0.5 py-1 px-1.5 rounded hover:text-white" active-class="text-amber-400 font-bold">
        <i class="fa-solid fa-truck-fast text-sm"></i>
        <span>주문배송</span>
      </router-link>
      <router-link to="/settlements" class="flex flex-col items-center gap-0.5 py-1 px-1.5 rounded hover:text-white" active-class="text-amber-400 font-bold">
        <i class="fa-solid fa-receipt text-sm"></i>
        <span>정산내역</span>
      </router-link>
      <router-link to="/qna" class="flex flex-col items-center gap-0.5 py-1 px-1.5 rounded hover:text-white" active-class="text-amber-400 font-bold">
        <i class="fa-solid fa-comments text-sm"></i>
        <span>Q&A문의</span>
      </router-link>
      <router-link to="/profile" class="flex flex-col items-center gap-0.5 py-1 px-1.5 rounded hover:text-white" active-class="text-amber-400 font-bold">
        <i class="fa-solid fa-gear text-sm"></i>
        <span>설정</span>
      </router-link>
    </nav>

    <!-- Footer -->
    <footer v-if="!isLoginPage" class="bg-white border-t border-slate-200 py-4 text-center text-xs text-slate-500">
      &copy; 2026 OLMOA Global Partner Portal. All Rights Reserved. (partner.olmoa.com)
    </footer>
  </div>
</template>
