<script setup lang="ts">
import { ref } from 'vue';
import { useRouter } from 'vue-router';

const router = useRouter();
const email = ref('seller@temu-supply.com');
const password = ref('password123');
const errorMsg = ref('');
const loading = ref(false);

function handleLogin() {
  loading.value = true;
  errorMsg.value = '';

  setTimeout(() => {
    if (email.value && password.value) {
      localStorage.setItem('partner_token', 'olmoa_partner_jwt_mock_token_999');
      router.push('/');
    } else {
      errorMsg.value = '이메일과 비밀번호를 입력해주세요.';
    }
    loading.value = false;
  }, 400);
}
</script>

<template>
  <div class="min-h-[80vh] flex items-center justify-center p-4">
    <div class="max-w-md w-full bg-white rounded-3xl shadow-xl p-8 border border-slate-200">
      <div class="text-center mb-8">
        <div class="inline-flex p-3 bg-orange-50 text-orange-600 rounded-2xl text-2xl mb-3">
          <img src="/olmoa-symbol.svg" alt="OLMOA" class="w-10 h-10 object-contain" />
        </div>
        <h1 class="text-2xl font-bold text-slate-900">
          <span class="text-orange-600">O</span>LMOA 파트너 센터 로그인
        </h1>
        <p class="text-xs text-slate-500 mt-1">올모아 글로벌 셀러 포털에 접속하여 주문과 상품을 관리하세요.</p>
      </div>

      <div v-if="errorMsg" class="mb-4 p-3 bg-rose-50 border border-rose-200 text-rose-700 text-xs rounded-xl">
        {{ errorMsg }}
      </div>

      <form @submit.prevent="handleLogin" class="space-y-4">
        <div>
          <label class="block text-xs font-semibold text-slate-600 mb-1">파트너 이메일</label>
          <input 
            v-model="email" 
            type="email" 
            required 
            class="w-full px-4 py-3 rounded-xl border border-slate-300 text-sm focus:ring-2 focus:ring-orange-500 focus:outline-none"
          />
        </div>

        <div>
          <label class="block text-xs font-semibold text-slate-600 mb-1">비밀번호</label>
          <input 
            v-model="password" 
            type="password" 
            required 
            class="w-full px-4 py-3 rounded-xl border border-slate-300 text-sm focus:ring-2 focus:ring-orange-500 focus:outline-none"
          />
        </div>

        <button 
          type="submit" 
          :disabled="loading" 
          class="w-full py-3.5 bg-indigo-950 hover:bg-indigo-900 text-white font-bold rounded-xl text-sm transition shadow-md disabled:opacity-50"
        >
          <span v-if="loading">인증 중...</span>
          <span v-else>올모아 파트너 로그인</span>
        </button>
      </form>

      <div class="mt-6 p-4 bg-slate-50 rounded-2xl border border-slate-100 text-xs text-slate-600">
        <p class="font-bold text-slate-800 mb-1"><i class="fa-solid fa-circle-info mr-1 text-orange-500"></i>테스트 파트너 계정</p>
        <p>계정: seller@temu-supply.com</p>
        <p>암호: password123</p>
      </div>
    </div>
  </div>
</template>
