<script setup lang="ts">
// Buyer login (PHASE 2 redesign). Identity is the server-issued JWT only. `redirect` is honoured only for
// same-site paths. The "소셜 로그인은 준비 중입니다" line was dropped: social login is disabled on the server (501)
// and an announcement of a feature that does not exist is not useful on the login form.
import { ref, computed } from 'vue'
import { useRouter, useRoute, RouterLink } from 'vue-router'
import { Eye, EyeOff } from 'lucide-vue-next'
import { OmButton, OmInput, OmAlert } from '@olmoa/ui'
import AuthCard from '../components/AuthCard.vue'
import { API_BASE_URL } from '../config'
import { useAuthStore } from '../stores/auth'

const router = useRouter()
const route = useRoute()
const auth = useAuthStore()
const email = ref('')
const password = ref('')
const showPw = ref(false)
const error = ref('')
const loading = ref(false)
const touched = ref(false)
const isDev = Boolean((import.meta as any).env?.DEV)
const expired = computed(() => route.query.expired === '1')
const fromCheckout = computed(() => String(route.query.redirect || '').startsWith('/checkout'))
const emailError = computed(() => (touched.value && !email.value.trim() ? '이메일을 입력해 주세요' : null))
const pwError = computed(() => (touched.value && !password.value ? '비밀번호를 입력해 주세요' : null))

function safeRedirect(): string {
  const r = typeof route.query.redirect === 'string' ? route.query.redirect : '/'
  return r.startsWith('/') && !r.startsWith('//') ? r : '/'
}

async function handleLogin() {
  touched.value = true
  error.value = ''
  if (!email.value.trim() || !password.value) return
  loading.value = true
  try {
    const res = await fetch(`${API_BASE_URL}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email.value.trim(), password: password.value, role: 'CUSTOMER' })
    })
    const json = await res.json().catch(() => ({}))
    if (!res.ok || !json.success || !json.token) {
      error.value = json.error || '로그인에 실패했습니다.'
      return
    }
    auth.login({ id: json.user.id, name: json.user.full_name || '회원', email: json.user.email }, json.token)
    router.replace(safeRedirect())
  } catch {
    error.value = '서버에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요.'
  } finally {
    loading.value = false
  }
}

function fillDevAccount() {
  email.value = 'customer@example.com'
  password.value = 'DevPass!2026#'
}
</script>

<template>
  <AuthCard title="로그인" :subtitle="fromCheckout ? '주문을 계속하려면 로그인해 주세요.' : undefined">
    <OmAlert v-if="expired" tone="warning" class="mb-4">로그인 세션이 만료되었습니다. 다시 로그인해 주세요.</OmAlert>

    <form class="space-y-4" novalidate @submit.prevent="handleLogin">
      <OmInput id="login-email" v-model="email" label="이메일" type="email" autocomplete="username" placeholder="example@olmoa.com" required :error="emailError" />
      <OmInput id="login-password" v-model="password" label="비밀번호" :type="showPw ? 'text' : 'password'" autocomplete="current-password" required :error="pwError">
        <template #suffix>
          <button type="button" class="pointer-events-auto text-ink-muted hover:text-ink" :aria-label="showPw ? '비밀번호 숨기기' : '비밀번호 보기'" :aria-pressed="showPw" @click="showPw = !showPw">
            <EyeOff v-if="showPw" class="h-4 w-4" /><Eye v-else class="h-4 w-4" />
          </button>
        </template>
      </OmInput>

      <OmAlert v-if="error" tone="danger">{{ error }}</OmAlert>

      <OmButton type="submit" variant="primary" size="lg" block :loading="loading" data-testid="login-submit">로그인</OmButton>
      <OmButton v-if="isDev" variant="ghost" size="sm" block @click="fillDevAccount">개발 환경 전용 · 테스트 계정 입력</OmButton>
    </form>

    <div class="mt-4 text-right text-sm">
      <RouterLink to="/forgot-password" class="text-ink-muted hover:text-ink hover:underline">비밀번호를 잊으셨나요?</RouterLink>
    </div>

    <template #footer>
      계정이 없으신가요? <RouterLink :to="{ path: '/register', query: route.query.redirect ? { redirect: route.query.redirect } : {} }" class="font-semibold text-primary hover:underline">회원가입</RouterLink>
    </template>
  </AuthCard>
</template>
