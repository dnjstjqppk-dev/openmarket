<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useRouter } from 'vue-router';

const router = useRouter();
const isLoggedIn = ref(false);

const checkAuth = () => {
  isLoggedIn.value = !!localStorage.getItem('admin_token');
};

const handleLogout = () => {
  localStorage.removeItem('admin_token');
  isLoggedIn.value = false;
  router.push('/login');
};

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
            <span class="bg-indigo-900 text-indigo-200 border border-indigo-700 text-[10px] font-bold px-2 py-0.5 rounded">
              ROLE_SUPER_ADMIN
            </span>
          </div>
        </div>
        <nav class="flex items-center gap-1 text-xs">
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
        </nav>
        <button @click="handleLogout" class="bg-slate-800 hover:bg-rose-900 text-slate-300 hover:text-white px-3 py-1.5 rounded text-xs transition">
          <i class="fa-solid fa-right-from-bracket mr-1"></i>로그아웃
        </button>
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
