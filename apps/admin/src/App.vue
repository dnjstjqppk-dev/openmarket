<script setup lang="ts">
import { ref, onMounted, watch } from 'vue';
import { useRouter, useRoute } from 'vue-router';

const router = useRouter();
const route = useRoute();
const isLoggedIn = ref(false);
const mobileMenuOpen = ref(false);

const checkAuth = () => {
  isLoggedIn.value = !!localStorage.getItem('admin_token');
};

const handleLogout = () => {
  localStorage.removeItem('admin_token');
  isLoggedIn.value = false;
  router.push('/login');
};

watch(() => route.path, () => {
  mobileMenuOpen.value = false;
});

onMounted(() => {
  checkAuth();
});
</script>

<template>
  <div class="min-h-screen bg-slate-100 text-slate-900 flex flex-col font-sans">
    <header v-if="isLoggedIn" class="bg-slate-900 text-white border-b border-slate-800 sticky top-0 z-50">
      <div class="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
        <div class="flex items-center gap-3">
          <img src="/olmoa-symbol.svg" alt="OLMOA" class="w-8 h-8 object-contain" />
          <div class="flex items-center gap-2">
            <span class="text-xl font-black tracking-tight text-white">
              <span class="text-orange-500">O</span>LMOA <span class="text-orange-400 text-xs font-bold">ADMIN</span>
            </span>
            <span class="hidden sm:inline-block bg-indigo-900 text-indigo-200 border border-indigo-700 text-[10px] font-bold px-2 py-0.5 rounded">
              ROLE_SUPER_ADMIN
            </span>
          </div>
        </div>

        <!-- Desktop Navigation -->
        <nav class="hidden md:flex items-center gap-1 text-xs">
          <router-link to="/" class="px-3 py-1.5 rounded transition text-slate-300 hover:text-white" active-class="bg-slate-800 text-orange-400 font-bold">
            대시보드
          </router-link>
          <router-link to="/products" class="px-3 py-1.5 rounded transition text-slate-300 hover:text-white" active-class="bg-slate-800 text-orange-400 font-bold">
            상품 관리
          </router-link>
          <router-link to="/partners" class="px-3 py-1.5 rounded transition text-slate-300 hover:text-white" active-class="bg-slate-800 text-orange-400 font-bold">
            셀러 심사
          </router-link>
          <router-link to="/ledger" class="px-3 py-1.5 rounded transition text-slate-300 hover:text-white" active-class="bg-slate-800 text-orange-400 font-bold">
            에스크로 원장
          </router-link>
          <router-link to="/marketing" class="px-3 py-1.5 rounded transition text-slate-300 hover:text-white" active-class="bg-slate-800 text-orange-400 font-bold">
            마케팅·배너
          </router-link>
        </nav>

        <div class="flex items-center gap-2">
          <button @click="handleLogout" class="hidden sm:flex items-center bg-slate-800 hover:bg-rose-900 text-slate-300 hover:text-white px-3 py-1.5 rounded text-xs transition cursor-pointer">
            <i class="fa-solid fa-right-from-bracket mr-1.5"></i>로그아웃
          </button>
          <!-- Mobile Hamburger Toggle -->
          <button
            @click="mobileMenuOpen = !mobileMenuOpen"
            class="md:hidden p-2 text-slate-300 hover:text-white focus:outline-none"
            aria-label="Toggle Navigation"
          >
            <i :class="mobileMenuOpen ? 'fa-solid fa-xmark text-lg' : 'fa-solid fa-bars text-lg'"></i>
          </button>
        </div>
      </div>

      <!-- Mobile Navigation Dropdown -->
      <div v-if="mobileMenuOpen" class="md:hidden border-t border-slate-800 bg-slate-900/98 px-4 py-3 space-y-1">
        <router-link to="/" class="block px-3 py-2 rounded text-xs text-slate-300 hover:text-white hover:bg-slate-800 font-medium" active-class="bg-slate-800 text-orange-400 font-bold">
          대시보드
        </router-link>
        <router-link to="/products" class="block px-3 py-2 rounded text-xs text-slate-300 hover:text-white hover:bg-slate-800 font-medium" active-class="bg-slate-800 text-orange-400 font-bold">
          상품 관리
        </router-link>
        <router-link to="/partners" class="block px-3 py-2 rounded text-xs text-slate-300 hover:text-white hover:bg-slate-800 font-medium" active-class="bg-slate-800 text-orange-400 font-bold">
          셀러 심사
        </router-link>
        <router-link to="/ledger" class="block px-3 py-2 rounded text-xs text-slate-300 hover:text-white hover:bg-slate-800 font-medium" active-class="bg-slate-800 text-orange-400 font-bold">
          에스크로 원장
        </router-link>
        <router-link to="/marketing" class="block px-3 py-2 rounded text-xs text-slate-300 hover:text-white hover:bg-slate-800 font-medium" active-class="bg-slate-800 text-orange-400 font-bold">
          마케팅·배너 & 알림 센터
        </router-link>
        <div class="pt-2 border-t border-slate-800">
          <button @click="handleLogout" class="w-full text-left px-3 py-2 text-xs text-rose-400 hover:bg-slate-800 rounded font-medium">
            <i class="fa-solid fa-right-from-bracket mr-1.5"></i>로그아웃
          </button>
        </div>
      </div>
    </header>

    <main class="flex-1 w-full max-w-7xl mx-auto p-4 sm:p-6">
      <router-view @auth-changed="checkAuth" />
    </main>

    <footer v-if="isLoggedIn" class="bg-white border-t border-slate-200 py-3 text-center text-[11px] text-slate-500">
      &copy; 2026 OLMOA Global Operations. All Rights Reserved. (admin.olmoa.com)
    </footer>
  </div>
</template>
