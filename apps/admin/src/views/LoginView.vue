<script setup lang="ts">
import { ref } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { API_BASE_URL, setAdminToken } from '../config'

const router = useRouter()
const route = useRoute()
const email = ref('')
const password = ref('')
const errorMsg = ref('')
const loading = ref(false)
const isDev = Boolean((import.meta as any).env?.DEV)

const handleAdminLogin = async () => {
  errorMsg.value = ''
  loading.value = true
  try {
    const res = await fetch(`${API_BASE_URL}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'ADMIN', email: email.value, password: password.value })
    })
    const json = await res.json().catch(() => ({}))
    if (!res.ok || !json.success || !json.token) {
      errorMsg.value = json.error || '로그인에 실패했습니다.'
      return
    }
    setAdminToken(json.token)
    const r = typeof route.query.redirect === 'string' && route.query.redirect.startsWith('/') ? route.query.redirect : '/'
    router.replace(r)
  } catch {
    errorMsg.value = '서버에 연결할 수 없습니다.'
  } finally {
    loading.value = false
  }
}
const fillDev = () => { email.value = 'admin@openmarket.com'; password.value = 'DevPass!2026#' }
</script>

<template>
  <div class="min-h-screen bg-[#090D16] flex items-center justify-center p-4">
    <div class="bg-white rounded-2xl max-w-md w-full p-8 shadow-2xl">
      <div class="flex items-center gap-2.5 mb-6">
        <div class="w-9 h-9 rounded-xl bg-indigo-600 flex items-center justify-center text-white font-black text-lg">A</div>
        <div>
          <h1 class="text-xl font-black text-gray-900 leading-none">OLMOA ADMIN</h1>
          <span class="text-xs text-gray-500">Platform Governance & Ledger Control</span>
        </div>
      </div>

      <form @submit.prevent="handleAdminLogin" class="space-y-4 text-xs">
        <p v-if="route.query.expired === '1'" role="status" class="p-3 rounded-xl bg-amber-50 text-amber-800 font-bold">세션이 만료되었습니다. 다시 로그인해 주세요.</p>
        <div>
          <label for="adm-email" class="block font-bold text-gray-700 mb-1">운영자 계정 이메일</label>
          <input id="adm-email" v-model="email" type="email" autocomplete="username" required class="w-full h-11 px-3.5 rounded-xl border border-gray-300" />
        </div>
        <div>
          <label for="adm-pw" class="block font-bold text-gray-700 mb-1">비밀번호</label>
          <input id="adm-pw" v-model="password" type="password" autocomplete="current-password" required class="w-full h-11 px-3.5 rounded-xl border border-gray-300" />
        </div>
        <p v-if="errorMsg" role="alert" class="text-red-600 font-bold">{{ errorMsg }}</p>
        <button type="submit" :disabled="loading" class="w-full h-12 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-black text-sm">{{ loading ? '확인 중...' : '로그인' }}</button>
        <button v-if="isDev" type="button" @click="fillDev" class="w-full h-9 rounded-lg bg-slate-100 text-slate-600 font-bold">개발 환경 전용 · 테스트 운영자 계정 입력</button>
      </form>
    </div>
  </div>
</template>
