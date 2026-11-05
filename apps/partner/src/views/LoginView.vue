<script setup lang="ts">
import { ref } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { API_BASE_URL, savePartnerSession } from '../config'

const router = useRouter()
const route = useRoute()
const email = ref('')
const password = ref('')
const errorMsg = ref('')
const loading = ref(false)
const isDev = Boolean((import.meta as any).env?.DEV)

const handlePartnerLogin = async () => {
  errorMsg.value = ''
  loading.value = true
  try {
    const res = await fetch(`${API_BASE_URL}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'PARTNER', email: email.value, password: password.value })
    })
    const json = await res.json().catch(() => ({}))
    if (!res.ok || !json.success || !json.token || !json.partner) {
      errorMsg.value = json.error || '로그인에 실패했습니다.'
      return
    }
    savePartnerSession(json.token, json.partner)
    if (json.partner.status !== 'APPROVED') { router.replace('/application'); return }
    const r = typeof route.query.redirect === 'string' && route.query.redirect.startsWith('/') ? route.query.redirect : '/'
    router.replace(r)
  } catch {
    errorMsg.value = '서버에 연결할 수 없습니다.'
  } finally {
    loading.value = false
  }
}

function fillDev(which: 1 | 2) {
  email.value = which === 1 ? 'seller@temu-supply.com' : 'partner2@olmoa-tech.com'
  password.value = 'DevPass!2026#'
}
</script>

<template>
  <div class="min-h-screen bg-[#0F172A] flex items-center justify-center p-4">
    <div class="bg-white rounded-2xl max-w-md w-full p-8 shadow-2xl">
      <div class="flex items-center gap-2.5 mb-6">
        <div class="w-9 h-9 rounded-xl bg-[#FF5000] flex items-center justify-center text-white font-black text-lg">P</div>
        <div>
          <h1 class="text-xl font-black text-gray-900 leading-none">OLMOA 판매자 센터</h1>
          <span class="text-xs text-gray-500">상품 · 주문 · 배송 · 정산 관리</span>
        </div>
      </div>
      <p v-if="route.query.expired === '1'" role="status" class="mb-4 p-3 rounded-xl bg-amber-50 text-amber-800 text-xs font-bold">세션이 만료되었습니다. 다시 로그인해 주세요.</p>
      <form @submit.prevent="handlePartnerLogin" class="space-y-4 text-xs">
        <div>
          <label for="pt-email" class="block font-bold text-gray-700 mb-1">판매자 계정 이메일</label>
          <input id="pt-email" v-model="email" type="email" autocomplete="username" required class="w-full h-11 px-3.5 rounded-xl border border-gray-300" />
        </div>
        <div>
          <label for="pt-pw" class="block font-bold text-gray-700 mb-1">비밀번호</label>
          <input id="pt-pw" v-model="password" type="password" autocomplete="current-password" required class="w-full h-11 px-3.5 rounded-xl border border-gray-300" />
        </div>
        <p v-if="errorMsg" role="alert" class="text-red-600 font-bold">{{ errorMsg }}</p>
        <button type="submit" :disabled="loading" class="w-full h-12 rounded-xl bg-[#FF5000] hover:bg-[#E04600] disabled:opacity-50 text-white font-black text-sm">
          {{ loading ? '확인 중...' : '로그인' }}
        </button>
        <div v-if="isDev" class="flex gap-2">
          <button type="button" class="flex-1 h-9 rounded-lg bg-slate-100 text-slate-600 font-bold" @click="fillDev(1)">개발용: 직영 스토어</button>
          <button type="button" class="flex-1 h-9 rounded-lg bg-slate-100 text-slate-600 font-bold" @click="fillDev(2)">개발용: 입점 판매자</button>
        </div>
      </form>
      <p class="mt-6 text-xs text-slate-600">아직 판매자가 아니신가요? <router-link to="/apply" class="font-bold text-[#FF5000] underline">입점 신청하기</router-link></p>
      <p class="mt-2 text-[11px] text-slate-400">입점 심사 중인 계정은 로그인 후 신청 현황과 서류 제출만 이용할 수 있습니다.</p>
    </div>
  </div>
</template>
