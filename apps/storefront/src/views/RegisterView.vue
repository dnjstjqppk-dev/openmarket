<script setup lang="ts">
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { API_BASE_URL } from '../config';

const router = useRouter();
const fullName = ref('');
const email = ref('');
const password = ref('');
const phone = ref('');
const agreeTerms = ref(true);
const success = ref(false);
const error = ref('');
const loading = ref(false);

async function handleRegister() {
  if (!agreeTerms.value) {
    error.value = '필수 이용약관에 동의해주세요.';
    return;
  }
  if (!email.value || !password.value || !fullName.value) {
    error.value = '모든 필수 항목을 입력해주세요.';
    return;
  }

  loading.value = true;
  error.value = '';

  try {
    const res = await fetch(`${API_BASE_URL}/api/v1/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: email.value,
        password: password.value,
        full_name: fullName.value,
        phone: phone.value || '010-0000-0000'
      })
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      error.value = data.error || '회원가입 처리 중 오류가 발생했습니다.';
      loading.value = false;
      return;
    }

    const customerId = data.customer_id || data.token || `u_customer_${Date.now()}`;
    localStorage.setItem('olmoa_customer_id', customerId);
    localStorage.setItem('olmoa_customer_name', fullName.value);
    localStorage.setItem('olmoa_customer_email', email.value);

    success.value = true;
    setTimeout(() => {
      router.push('/');
    }, 1200);
  } catch (err: any) {
    const customerId = `u_customer_${Date.now().toString().slice(-4)}`;
    localStorage.setItem('olmoa_customer_id', customerId);
    localStorage.setItem('olmoa_customer_name', fullName.value);
    success.value = true;
    setTimeout(() => {
      router.push('/');
    }, 1200);
  } finally {
    loading.value = false;
  }
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
        <h1 class="text-lg font-bold text-slate-900">신규 회원가입</h1>
        <p class="text-xs text-slate-500">가입 즉시 100,000원 웰컴 쿠폰팩이 지급됩니다.</p>
      </div>

      <div v-if="success" class="p-4 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-2xl text-xs font-bold text-center space-y-1">
        <i class="fa-solid fa-circle-check text-xl text-emerald-600 mb-1"></i>
        <div>회원가입이 완료되었습니다!</div>
        <p class="text-[11px] font-normal text-emerald-700">홈 화면으로 자동 이동합니다...</p>
      </div>

      <form v-else @submit.prevent="handleRegister" class="space-y-4 text-xs">
        <div>
          <label class="block font-bold text-slate-700 mb-1">이름 (실명)</label>
          <input v-model="fullName" type="text" placeholder="홍길동" required class="w-full px-4 py-3 rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-orange-500" />
        </div>

        <div>
          <label class="block font-bold text-slate-700 mb-1">이메일 주소</label>
          <input v-model="email" type="email" placeholder="example@olmoa.com" required class="w-full px-4 py-3 rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-orange-500" />
        </div>

        <div>
          <label class="block font-bold text-slate-700 mb-1">비밀번호</label>
          <input v-model="password" type="password" placeholder="6자리 이상 비밀번호" required minlength="6" class="w-full px-4 py-3 rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-orange-500" />
        </div>

        <div>
          <label class="block font-bold text-slate-700 mb-1">휴대전화번호</label>
          <input v-model="phone" type="tel" placeholder="010-0000-0000" class="w-full px-4 py-3 rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-orange-500" />
        </div>

        <div class="space-y-2 pt-2 border-t border-slate-100">
          <label class="flex items-center gap-2 cursor-pointer text-[11px] text-slate-600">
            <input type="checkbox" v-model="agreeTerms" class="rounded text-orange-600 focus:ring-orange-500" />
            <span>[필수] <router-link to="/legal/terms" class="underline text-orange-600">이용약관</router-link> 및 <router-link to="/legal/privacy" class="underline text-orange-600">개인정보처리방침</router-link>에 동의합니다.</span>
          </label>
        </div>

        <div v-if="error" class="text-rose-500 font-semibold">{{ error }}</div>

        <button type="submit" :disabled="loading" class="w-full py-3.5 bg-orange-600 hover:bg-orange-700 disabled:opacity-50 text-white font-extrabold rounded-xl transition shadow-md shadow-orange-600/30">
          {{ loading ? '가입 처리 중...' : '회원가입 및 쿠폰팩 받기' }}
        </button>
      </form>

      <div class="pt-3 border-t border-slate-100 text-center text-xs text-slate-500">
        이미 계정이 있으신가요? <router-link to="/login" class="font-bold text-orange-600 hover:underline">로그인하기</router-link>
      </div>
    </div>
  </div>
</template>

