<script setup lang="ts">
import { ref, computed } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { API_BASE_URL } from '../config';
import { useAuthStore } from '../stores/auth';

const router = useRouter();
const route = useRoute();
const auth = useAuthStore();
const email = ref('');
const password = ref('');
const error = ref('');
const loading = ref(false);
const isDev = Boolean((import.meta as any).env?.DEV);
const expired = computed(() => route.query.expired === '1');

function safeRedirect(): string {
  const r = typeof route.query.redirect === 'string' ? route.query.redirect : '/';
  return r.startsWith('/') && !r.startsWith('//') ? r : '/';
}

async function handleLogin() {
  error.value = '';
  if (!email.value || !password.value) {
    error.value = '이메일과 비밀번호를 입력해 주세요.';
    return;
  }
  loading.value = true;
  try {
    const res = await fetch(`${API_BASE_URL}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email.value, password: password.value, role: 'CUSTOMER' })
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json.success || !json.token) {
      error.value = json.error || '로그인에 실패했습니다.';
      return;
    }
    auth.login({ id: json.user.id, name: json.user.full_name || '회원', email: json.user.email }, json.token);
    router.replace(safeRedirect());
  } catch {
    error.value = '서버에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요.';
  } finally {
    loading.value = false;
  }
}

function fillDevAccount() {
  email.value = 'customer@example.com';
  password.value = 'DevPass!2026#';
}
</script>

<template>
  <div class="max-w-md mx-auto py-8 px-4">
    <div class="bg-white rounded-3xl p-8 border border-slate-200 shadow-xl space-y-6">
      <div class="text-center space-y-2">
        <router-link to="/" class="inline-flex items-center gap-1.5 justify-center mb-1">
          <img src="/olmoa-symbol.svg" alt="OLMOA" class="w-10 h-10 object-contain drop-shadow" />
          <span class="text-2xl font-black tracking-tight text-slate-900">
            <span class="text-orange-600">O</span>LMOA
          </span>
        </router-link>
        <h1 class="text-lg font-bold text-slate-900">고객 로그인</h1>
        <p class="text-xs text-slate-500">내가 찾는 모든 것, 올모아에 오신 것을 환영합니다.</p>
      </div>

      <div v-if="expired" role="status" class="p-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-xs font-semibold">
        로그인 세션이 만료되었습니다. 다시 로그인해 주세요.
      </div>

      <form @submit.prevent="handleLogin" class="space-y-4 text-xs" novalidate>
        <div>
          <label for="login-email" class="block font-bold text-slate-700 mb-1">이메일 주소</label>
          <input id="login-email" v-model="email" type="email" autocomplete="username" placeholder="example@olmoa.com" required
            class="w-full px-4 py-3 rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-orange-500" />
        </div>
        <div>
          <label for="login-password" class="block font-bold text-slate-700 mb-1">비밀번호</label>
          <input id="login-password" v-model="password" type="password" autocomplete="current-password" placeholder="비밀번호를 입력하세요" required
            class="w-full px-4 py-3 rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-orange-500" />
        </div>

        <div v-if="error" role="alert" class="text-rose-600 font-semibold">{{ error }}</div>

        <button type="submit" :disabled="loading" data-testid="login-submit"
          class="w-full py-3.5 bg-orange-600 hover:bg-orange-700 disabled:opacity-50 text-white font-extrabold rounded-xl transition shadow-md shadow-orange-600/30">
          {{ loading ? '인증 확인 중...' : '로그인' }}
        </button>

        <button v-if="isDev" type="button" @click="fillDevAccount"
          class="w-full py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-600 font-bold rounded-xl transition text-center">
          개발 환경 전용 · 테스트 계정 입력
        </button>
      </form>

      <div class="flex justify-between text-[11px]">
        <router-link to="/forgot-password" class="text-slate-500 hover:underline">비밀번호 찾기</router-link>
        <span class="text-slate-400">소셜 로그인은 준비 중입니다</span>
      </div>

      <div class="pt-4 border-t border-slate-100 text-center text-xs text-slate-500">
        <p>계정이 없으신가요? <router-link to="/register" class="font-bold text-orange-600 hover:underline">회원가입하기</router-link></p>
      </div>
    </div>
  </div>
</template>
