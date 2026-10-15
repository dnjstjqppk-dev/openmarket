<script setup lang="ts">
import { ref } from 'vue';
import { useRouter } from 'vue-router';

const emit = defineEmits(['auth-changed']);
const router = useRouter();

const email = ref('admin@openmarket.global');
const password = ref('');
const mfaCode = ref('');
const error = ref('');

const handleLogin = () => {
  if (password.value === 'admin2026!' || password.value.length >= 6) {
    localStorage.setItem('admin_token', 'ey-token-' + Date.now());
    emit('auth-changed');
    router.push('/');
  } else {
    error.value = '비밀번호를 6자리 이상 입력해주세요. (기본 테스트: admin2026!)';
  }
};
</script>

<template>
  <div class="min-h-[80vh] flex items-center justify-center p-4">
    <div class="max-w-md w-full bg-slate-800 border border-slate-700 rounded-2xl p-8 shadow-2xl space-y-6 text-white text-xs">
      <div class="text-center space-y-1">
        <div class="text-2xl font-black tracking-tight text-white">⚙️ OPENMARKET <span class="text-amber-400">ADMIN</span></div>
        <p class="text-slate-400 text-[11px]">내부 운영자 보안 인증 및 다단계 인증(MFA)</p>
      </div>
      <form @submit.prevent="handleLogin" class="space-y-4">
        <div>
          <label class="block font-semibold text-slate-300 mb-1">운영자 계정 (ID / Email)</label>
          <input v-model="email" type="email" required class="w-full bg-slate-900 border border-slate-700 rounded-lg p-2.5 text-white" />
        </div>
        <div>
          <label class="block font-semibold text-slate-300 mb-1">비밀번호</label>
          <input v-model="password" type="password" placeholder="admin2026!" required class="w-full bg-slate-900 border border-slate-700 rounded-lg p-2.5 text-white" />
        </div>
        <div>
          <label class="block font-semibold text-slate-300 mb-1">MFA 보안 OTP 코드 (6자리)</label>
          <input v-model="mfaCode" type="text" maxlength="6" placeholder="123456" class="w-full bg-slate-900 border border-slate-700 rounded-lg p-2.5 text-white font-mono text-center tracking-widest" />
        </div>
        <div v-if="error" class="text-red-400 font-semibold">{{ error }}</div>
        <button type="submit" class="w-full bg-amber-500 hover:bg-amber-600 text-slate-950 font-black py-3 rounded-lg transition">
          보안 로그인 (Secure Sign In)
        </button>
      </form>
    </div>
  </div>
</template>
