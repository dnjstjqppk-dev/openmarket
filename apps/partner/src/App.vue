<script setup lang="ts">
import { computed } from 'vue';
import { useRouter, useRoute } from 'vue-router';

const router = useRouter();
const route = useRoute();

const isLoginPage = computed(() => route.path === '/login');
const partnerName = 'Global Direct Logistics Ltd.';

function handleLogout() {
  localStorage.removeItem('partner_token');
  router.push('/login');
}
</script>

<template>
  <div class="min-h-screen flex flex-col bg-slate-50">
    <!-- Top Navigation Bar for Authenticated Partner -->
    <header v-if="!isLoginPage" class="bg-indigo-900 text-white shadow-md sticky top-0 z-30">
      <div class="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
        <div class="flex items-center gap-6">
          <div class="flex items-center gap-2 font-black text-xl tracking-tight text-white">
            <i class="fa-solid fa-store text-indigo-400"></i>
            <span>OpenMarket <span class="text-indigo-300 font-normal text-sm">Partner Center</span></span>
          </div>
          <nav class="hidden md:flex items-center gap-1 text-sm font-medium">
            <router-link to="/" class="px-3 py-2 rounded-lg hover:bg-indigo-800 transition" active-class="bg-indigo-800 text-amber-400">대시보드</router-link>
            <router-link to="/products" class="px-3 py-2 rounded-lg hover:bg-indigo-800 transition" active-class="bg-indigo-800 text-amber-400">상품 관리</router-link>
            <router-link to="/bulk-upload" class="px-3 py-2 rounded-lg hover:bg-indigo-800 transition" active-class="bg-indigo-800 text-amber-400">대량 등록</router-link>
            <router-link to="/shipments" class="px-3 py-2 rounded-lg hover:bg-indigo-800 transition" active-class="bg-indigo-800 text-amber-400">주문·배송</router-link>
            <router-link to="/settlements" class="px-3 py-2 rounded-lg hover:bg-indigo-800 transition" active-class="bg-indigo-800 text-amber-400">정산 내역</router-link>
          </nav>
        </div>

        <div class="flex items-center gap-4 text-sm">
          <div class="flex items-center gap-2 bg-indigo-950 px-3 py-1.5 rounded-full border border-indigo-700">
            <span class="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
            <span class="text-xs text-indigo-200 font-mono">{{ partnerName }}</span>
          </div>
          <button @click="handleLogout" class="text-xs text-indigo-300 hover:text-white transition">
            <i class="fa-solid fa-right-from-bracket mr-1"></i>로그아웃
          </button>
        </div>
      </div>
    </header>

    <!-- Main Content Area -->
    <main class="flex-1 max-w-7xl w-full mx-auto px-4 py-8">
      <router-view />
    </main>

    <!-- Footer -->
    <footer v-if="!isLoginPage" class="bg-white border-t border-slate-200 py-4 text-center text-xs text-slate-500">
      &copy; 2026 OpenMarket Global Seller Portal. All Rights Reserved. Pure Vue 3 + TypeScript SFC.
    </footer>
  </div>
</template>
