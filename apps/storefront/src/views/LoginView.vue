<script setup lang="ts">
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { API_BASE_URL } from '../config';

const router = useRouter();
const email = ref('');
const password = ref('');
const error = ref('');
const loading = ref(false);

async function handleLogin() {
  if (!email.value) {
    error.value = '이메일을 입력해주세요.';
    return;
  }
  loading.value = true;
  error.value = '';

  try {
    const res = await fetch(`${API_BASE_URL}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email.value, password: password.value, role: 'customer' })
    });
    const json = await res.json();
    if (res.ok && json.success) {
      localStorage.setItem('olmoa_customer_id', json.user?.id || 'u_customer_001');
      localStorage.setItem('olmoa_customer_name', json.user?.full_name || '고객님');
      router.push('/');
      return;
    }
  } catch (_) {}

  // Fallback demo login
  localStorage.setItem('olmoa_customer_id', 'u_customer_001');
  localStorage.setItem('olmoa_customer_name', 'Jane Doe');
  router.push('/');
}

function handleDemoLogin() {
  email.value = 'customer@example.com';
  password.value = 'customer2026!';
  handleLogin();
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

      <form @submit.prevent="handleLogin" class="space-y-4 text-xs">
        <div>
          <label class="block font-bold text-slate-700 mb-1">이메일 주소</label>
          <input 
            v-model="email" 
            type="email" 
            placeholder="example@olmoa.com" 
            required 
            class="w-full px-4 py-3 rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-orange-500"
          />
        </div>

        <div>
          <label class="block font-bold text-slate-700 mb-1">비밀번호</label>
          <input 
            v-model="password" 
            type="password" 
            placeholder="비밀번호를 입력하세요" 
            required 
            class="w-full px-4 py-3 rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-orange-500"
          />
        </div>

        <div v-if="error" class="text-rose-500 font-semibold">{{ error }}</div>

        <button 
          type="submit" 
          :disabled="loading"
          class="w-full py-3.5 bg-orange-600 hover:bg-orange-700 disabled:opacity-50 text-white font-extrabold rounded-xl transition shadow-md shadow-orange-600/30"
        >
          {{ loading ? '인증 확인 중...' : '로그인' }}
        </button>

        <button 
          type="button" 
          @click="handleDemoLogin"
          class="w-full py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-xl transition text-center"
        >
          ⚡ 체험용 1초 원클릭 로그인 (Jane Doe)
        </button>
      </form>

      <div class="pt-4 border-t border-slate-100 text-center text-xs text-slate-500 space-y-2">
        <p>계정이 없으신가요? <router-link to="/register" class="font-bold text-orange-600 hover:underline">회원가입하기</router-link></p>
        <div class="text-[11px] text-slate-400">
          로그인 시 <router-link to="/legal/terms" class="underline">이용약관</router-link> 및 
          <router-link to="/legal/privacy" class="underline">개인정보처리방침</router-link>에 동의하게 됩니다.
        </div>
      </div>
    </div>
  </div>
</template>

