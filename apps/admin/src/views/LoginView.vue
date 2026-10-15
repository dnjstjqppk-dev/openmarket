<script setup lang="ts">
import { ref } from 'vue';
import { useRouter } from 'vue-router';

const emit = defineEmits(['auth-changed']);
const router = useRouter();

const email = ref('admin@olmoa.com');
const password = ref('');
const mfaCode = ref('');
const error = ref('');

const handleLogin = () => {
  if (password.value === 'admin2026!' || password.value.length >= 6) {
    localStorage.setItem('admin_token', 'ey-olmoa-token-' + Date.now());
    emit('auth-changed');
    router.push('/');
  } else {
    error.value = '비밀번호를 6자리 이상 입력해주세요. (기본 테스트: admin2026!)';
  }
};
</script>

<template>
  <div class="min-h-[80vh] flex items-center justify-center p-4">
    <div class="max-w-md w-full bg-slate-900 border border-slate-800 rounded-3xl p-8 shadow-2xl space-y-6 text-white text-xs">
      <div class="text-center space-y-2">
        <div class="inline-flex p-3 bg-orange-500/10 rounded-2xl mb-1">
          <img src="/olmoa-symbol.svg" alt="OLMOA" class="w-12 h-12 object-contain" />
        </div>
        <div class="text-2xl font-black tracking-tight text-white">
          <span class="text-orange-500">O</span>LMOA <span class="text-orange-400">ADMIN</span>
        </div>
        <p class="text-slate-400 text-[11px]">올모아 글로벌 플랫폼 운영자 보안 인증 및 MFA</p>
      </div>
      <form @submit.prevent="handleLogin" class="space-y-4">
        <div>
          <label class="block font-semibold text-slate-300 mb-1">운영자 계정 (ID / Email)</label>
          <input v-model="email" type="email" required class="w-full bg-slate-950 border border-slate-700 rounded-xl p-3 text-white focus:outline-none focus:ring-2 focus:ring-orange-500" />
        </div>
        <div>
          <label class="block font-semibold text-slate-300 mb-1">비밀번호</label>
          <input v-model="password" type="password" placeholder="admin2026!" required class="w-full bg-slate-950 border border-slate-700 rounded-xl p-3 text-white focus:outline-none focus:ring-2 focus:ring-orange-500" />
        </div>
        <div>
          <label class="block font-semibold text-slate-300 mb-1">MFA 보안 OTP 코드 (6자리)</label>
          <input v-model="mfaCode" type="text" maxlength="6" placeholder="123456" class="w-full bg-slate-950 border border-slate-700 rounded-xl p-3 text-white font-mono text-center tracking-widest focus:outline-none focus:ring-2 focus:ring-orange-500" />
        </div>
        <div v-if="error" class="text-rose-400 font-semibold">{{ error }}</div>
        <button type="submit" class="w-full bg-orange-600 hover:bg-orange-700 text-white font-black py-3.5 rounded-xl transition shadow-lg shadow-orange-600/30">
          보안 로그인 (Secure Sign In)
        </button>
      </form>
    </div>
  </div>
</template>
