<script setup lang="ts">
import { ref } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { API_BASE_URL, setAdminToken, setAdminRole } from '../config'

const router = useRouter()
const route = useRoute()
const email = ref('')
const password = ref('')
const errorMsg = ref('')
const loading = ref(false)
const otpStep = ref(false)
const otp = ref('')
const useRecovery = ref(false)
const isDev = Boolean((import.meta as any).env?.DEV)

const handleAdminLogin = async () => {
  errorMsg.value = ''
  loading.value = true
  try {
    const res = await fetch(`${API_BASE_URL}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'ADMIN', email: email.value, password: password.value, ...(otpStep.value ? (useRecovery.value ? { recovery_code: otp.value } : { otp: otp.value }) : {}) })
    })
    const json = await res.json().catch(() => ({}))
    if (json.code === 'OTP_REQUIRED') { otpStep.value = true; return }
    if (!res.ok || !json.success || !json.token) {
      errorMsg.value = json.error || '로그인에 실패했습니다.'
      otp.value = ''
      return
    }
    setAdminToken(json.token)
    setAdminRole(json.admin_role || '')
    if (json.mfa_setup_required) { router.replace('/security'); return }
    const r = typeof route.query.redirect === 'string' && route.query.redirect.startsWith('/') ? route.query.redirect : '/'
    router.replace(r)
  } catch {
    errorMsg.value = '서버에 연결할 수 없습니다.'
  } finally {
    loading.value = false
  }
}
// Static DEV gate: the bundler folds `import.meta.env.DEV` to false in production and drops this
// branch, so the literals below never ship in the production bundle (a runtime v-if alone keeps them).
const fillDev = () => { if (import.meta.env.DEV) { email.value = 'admin@openmarket.com'; password.value = 'DevPass!2026#' } }
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
        <div v-if="otpStep" class="p-3 rounded-xl bg-indigo-50 space-y-2" data-testid="otp-step">
          <label for="adm-otp" class="block font-bold text-indigo-900">{{ useRecovery ? '복구 코드 (xxxx-xxxx)' : '인증 앱의 6자리 코드' }}</label>
          <input id="adm-otp" v-model="otp" :inputmode="useRecovery ? 'text' : 'numeric'" autocomplete="one-time-code" required autofocus class="w-full h-11 px-3.5 rounded-xl border border-gray-300 tracking-widest font-mono" />
          <button type="button" class="text-indigo-700 underline" @click="useRecovery = !useRecovery; otp = ''">{{ useRecovery ? '인증 앱 코드로 입력' : '휴대폰을 잃어버렸어요 · 복구 코드 사용' }}</button>
        </div>
        <p v-if="errorMsg" role="alert" class="text-red-600 font-bold">{{ errorMsg }}</p>
        <button type="submit" :disabled="loading" class="w-full h-12 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-black text-sm">{{ loading ? '확인 중...' : '로그인' }}</button>
        <button v-if="isDev" type="button" @click="fillDev" class="w-full h-9 rounded-lg bg-slate-100 text-slate-600 font-bold">개발 환경 전용 · 테스트 운영자 계정 입력</button>
      </form>
    </div>
  </div>
</template>
