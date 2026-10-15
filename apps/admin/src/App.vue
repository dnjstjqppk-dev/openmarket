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
          <span class="text-xl font-black tracking-tight">⚙️ OPENMARKET <span class="text-amber-400 text-xs">ADMIN</span></span>
          <span class="bg-purple-900 text-purple-200 border border-purple-700 text-[10px] font-bold px-2 py-0.5 rounded">ROLE_SUPER_ADMIN</span>
        </div>
        <nav class="flex items-center gap-1 text-xs">
          <router-link to="/" class="px-3 py-1.5 rounded transition text-slate-300 hover:text-white" active-class="bg-slate-800 text-white font-bold">대시보드</router-link>
          <router-link to="/partners" class="px-3 py-1.5 rounded transition text-slate-300 hover:text-white" active-class="bg-slate-800 text-white font-bold">파트너 심사</router-link>
          <router-link to="/ledger" class="px-3 py-1.5 rounded transition text-slate-300 hover:text-white" active-class="bg-slate-800 text-white font-bold">복식부기 원장</router-link>
        </nav>
        <button @click="handleLogout" class="bg-slate-800 hover:bg-red-900 text-slate-300 hover:text-white px-3 py-1.5 rounded text-xs transition">
          로그아웃
        </button>
      </div>
    </header>

    <main class="flex-1 w-full max-w-7xl mx-auto p-4 sm:p-6">
      <router-view @auth-changed="checkAuth" />
    </main>
  </div>
</template>
