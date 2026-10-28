<script setup lang="ts">
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { API_BASE_URL } from '../config';

const router = useRouter();
const email = ref('');
const token = ref('');
const newPassword = ref('');
const message = ref('');
const step = ref<'request' | 'reset'>('request');
const loading = ref(false);

async function requestReset() {
  if (!email.value) return;
  loading.value = true;
  try {
    const res = await fetch(`${API_BASE_URL}/api/v1/auth/forgot-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email.value })
    });
    const json = await res.json();
    if (json.success) {
      message.value = json.message;
      token.value = json.reset_token || '';
      step.value = 'reset';
    } else {
      message.value = json.error || '요청 실패';
    }
  } catch (_) {
    message.value = '네트워크 오류';
  } finally {
    loading.value = false;
  }
}

async function resetPassword() {
  if (!token.value || !newPassword.value) return;
  loading.value = true;
  try {
    const res = await fetch(`${API_BASE_URL}/api/v1/auth/reset-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: token.value, new_password: newPassword.value })
    });
    const json = await res.json();
    if (json.success) {
      message.value = json.message;
      setTimeout(() => router.push('/login'), 1500);
    } else {
      message.value = json.error || '재설정 실패';
    }
  } catch (_) {
    message.value = '네트워크 오류';
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <div class="max-w-md mx-auto py-8 px-4">
    <div class="bg-white rounded-3xl p-8 border border-slate-200 shadow-xl space-y-6">
      <div class="text-center space-y-2">
        <h1 class="text-lg font-bold text-slate-900">비밀번호 재설정</h1>
        <p class="text-xs text-slate-500">등록된 이메일로 재설정 링크를 발송합니다.</p>
      </div>

      <div v-if="message" class="p-3 rounded-xl bg-indigo-50 border border-indigo-200 text-xs text-indigo-700">
        {{ message }}
      </div>

      <form v-if="step === 'request'" @submit.prevent="requestReset" class="space-y-4 text-xs">
        <div>
          <label class="block font-bold text-slate-700 mb-1">이메일 주소</label>
          <input v-model="email" type="email" required placeholder="example@olmoa.com"
            class="w-full px-4 py-3 rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-orange-500" />
        </div>
        <button type="submit" :disabled="loading" class="w-full py-3 bg-orange-600 hover:bg-orange-700 text-white font-black rounded-xl text-sm disabled:opacity-50">
          {{ loading ? '발송 중...' : '재설정 링크 발송' }}
        </button>
      </form>

      <form v-else @submit.prevent="resetPassword" class="space-y-4 text-xs">
        <div>
          <label class="block font-bold text-slate-700 mb-1">재설정 토큰</label>
          <input v-model="token" required class="w-full px-4 py-3 rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-orange-500 font-mono text-[11px]" />
        </div>
        <div>
          <label class="block font-bold text-slate-700 mb-1">새 비밀번호</label>
          <input v-model="newPassword" type="password" required class="w-full px-4 py-3 rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-orange-500" />
        </div>
        <button type="submit" :disabled="loading" class="w-full py-3 bg-orange-600 hover:bg-orange-700 text-white font-black rounded-xl text-sm disabled:opacity-50">
          {{ loading ? '처리 중...' : '비밀번호 재설정' }}
        </button>
      </form>

      <div class="text-center text-xs">
        <router-link to="/login" class="text-indigo-600 font-bold hover:underline">로그인으로 돌아가기</router-link>
      </div>
    </div>
  </div>
</template>