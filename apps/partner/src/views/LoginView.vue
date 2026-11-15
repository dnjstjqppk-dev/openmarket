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
    savePartnerSession(json.token, json.partner, json.refresh_token)
    if (json.partner.status !== 'APPROVED') { router.replace('/application'); return }
    router.replace(safeRedirect(typeof route.query.redirect === 'string' ? route.query.redirect : '/'))
  } catch {
    errorMsg.value = '서버에 연결할 수 없습니다.'
  } finally {
    loading.value = false
  }
}

// P2-T03: post-login redirect stays in-app — single leading slash, no
// protocol-relative '//', and only known seller routes (query strings allowed).
const REDIRECT_ALLOWLIST = ['/', '/apply', '/application', '/products', '/bidding', '/bulk-upload', '/imports', '/channels', '/shipments', '/returns', '/claims', '/settlements', '/promotions', '/qna', '/reviews', '/profile', '/store-profile']
function safeRedirect(raw: string): string {
  if (!raw.startsWith('/') || raw.startsWith('//') || raw.includes('\\')) return '/'
  const path = raw.split('?')[0].split('#')[0]
  if (!REDIRECT_ALLOWLIST.some((p) => path === p || (p !== '/' && path.startsWith(`${p}/`)))) return '/'
  return raw
}

function fillDev(which: 1 | 2) {
  // Static DEV gate: the bundler folds import.meta.env.DEV to false in production and drops this
  // branch, so the literals below never ship in the production bundle (a runtime v-if alone keeps them).
  if (import.meta.env.DEV) {
    email.value = which === 1 ? 'seller@temu-supply.com' : 'partner2@olmoa-tech.com'
    password.value = 'DevPass!2026#'
  }
}
</script>

<template>
  <div class="flex min-h-screen items-center justify-center bg-surface-2 p-4">
    <div class="w-full max-w-md rounded-2xl bg-surface p-8 shadow-2xl">
      <div class="mb-6 flex items-center gap-2.5">
        <img src="/olmoa-symbol.svg" alt="OLMOA" class="h-9 w-9 object-contain" />
        <div>
          <h1 class="text-xl font-bold leading-none text-ink">OLMOA 판매자 센터</h1>
          <span class="text-xs text-ink-muted">상품 · 주문 · 배송 · 정산 관리</span>
        </div>
      </div>
      <p v-if="route.query.expired === '1'" role="status" class="mb-4 rounded-xl border border-warning bg-warning-soft p-3 text-xs font-bold text-warning">세션이 만료되었습니다. 다시 로그인해주세요.</p>
      <form @submit.prevent="handlePartnerLogin" class="space-y-4 text-xs">
        <div>
          <label for="pt-email" class="mb-1 block font-bold text-ink-muted">판매자 계정 이메일</label>
          <input id="pt-email" v-model="email" type="email" autocomplete="username" required class="h-11 w-full rounded-xl border border-line bg-surface px-3.5 text-ink focus:outline-none focus:ring-2 focus-visible:ring-focus" />
        </div>
        <div>
          <label for="pt-pw" class="mb-1 block font-bold text-ink-muted">비밀번호</label>
          <input id="pt-pw" v-model="password" type="password" autocomplete="current-password" required class="h-11 w-full rounded-xl border border-line bg-surface px-3.5 text-ink focus:outline-none focus:ring-2 focus-visible:ring-focus" />
        </div>
        <p v-if="errorMsg" role="alert" class="font-bold text-danger">{{ errorMsg }}</p>
        <button type="submit" :disabled="loading" class="h-12 w-full rounded-xl bg-primary text-sm font-bold text-primary-on hover:bg-primary-hover disabled:opacity-50">
          {{ loading ? '확인 중...' : '로그인' }}
        </button>
        <div v-if="isDev" class="flex gap-2">
          <button type="button" class="h-9 flex-1 rounded-lg bg-surface-3 font-bold text-ink-muted" @click="fillDev(1)">개발용: 직영 스토어</button>
          <button type="button" class="h-9 flex-1 rounded-lg bg-surface-3 font-bold text-ink-muted" @click="fillDev(2)">개발용: 입점 판매자</button>
        </div>
      </form>
      <p class="mt-6 text-xs text-ink-muted">아직 판매자가 아니신가요? <router-link to="/apply" class="font-bold text-primary underline">입점 신청하기</router-link></p>
      <p class="mt-2 text-[11px] text-ink-subtle">입점 심사 중인 계정은 로그인 후 신청 현황과 서류 제출만 이용할 수 있습니다.</p>
    </div>
  </div>
</template>
