<script setup lang="ts">
// Buyer login (PHASE 2 redesign). Identity is the server-issued JWT only. `redirect` is honoured only for
// same-site paths. Kakao login completes here: the gateway redirects back with ?social_code=<one-time>
// (exchanged for the JWT over POST; the JWT itself never travels in a URL) or ?social_error=<CODE>,
// each carrying the `state` this page generated (login CSRF check). Without server credentials the
// start probe answers 501 and the button reports it inline instead of navigating away.
import { ref, computed, onMounted } from 'vue'
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
  // Static DEV gate: the bundler folds `import.meta.env.DEV` to false in production and drops this
  // branch, so the literals below never ship in the production bundle (a runtime v-if alone keeps them).
  if (import.meta.env.DEV) {
    email.value = 'customer@example.com'
    password.value = 'DevPass!2026#'
  }
}

const SOCIAL_ERRORS: Record<string, string> = {
  OAUTH_DENIED: '카카오 로그인이 취소되었습니다.',
  OAUTH_EXCHANGE_FAILED: '카카오 인증에 실패했습니다. 다시 시도해 주세요.',
  OAUTH_PROFILE_FAILED: '카카오 회원 정보를 가져오지 못했습니다.',
  OAUTH_PROVIDER_ERROR: '카카오 서버에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.',
  OAUTH_EMAIL_REQUIRED: '카카오 계정의 이메일 제공에 동의해야 가입할 수 있습니다.',
  EMAIL_TAKEN: '이미 이메일로 가입된 계정입니다. 이메일과 비밀번호로 로그인해 주세요.',
  ACCOUNT_DISABLED: '비활성화된 계정입니다.'
}
const socialLoading = ref(false)

const SOCIAL_STATE_KEY = 'olmoa_social_state'

function newSocialState(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

/** Strips every OAuth return parameter so codes, errors, and state never linger in the URL. */
function cleanSocialQuery() {
  const q = { ...route.query }
  delete q.social_code
  delete q.social_token
  delete q.social_error
  delete q.state
  return q
}

async function startKakao() {
  if (socialLoading.value) return
  socialLoading.value = true
  error.value = ''
  try {
    const state = newSocialState()
    sessionStorage.setItem(SOCIAL_STATE_KEY, state)
    const startUrl = `${API_BASE_URL}/api/v1/auth/social/kakao/start?state=${state}`
    // Probe first: an unconfigured server answers 501 JSON instead of a redirect.
    const probe = await fetch(startUrl, { redirect: 'manual' })
    if (probe.type === 'opaqueredirect' || probe.status === 302) {
      window.location.href = startUrl
      return
    }
    sessionStorage.removeItem(SOCIAL_STATE_KEY)
    error.value = '소셜 로그인은 아직 제공되지 않습니다.'
  } catch {
    sessionStorage.removeItem(SOCIAL_STATE_KEY)
    error.value = '서버에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요.'
  } finally {
    socialLoading.value = false
  }
}

async function consumeSocialReturn() {
  const err = typeof route.query.social_error === 'string' ? route.query.social_error : ''
  const loginCode = typeof route.query.social_code === 'string' ? route.query.social_code : ''
  if (!err && !loginCode) return
  // Verify state before touching the code: a mismatch means this return was not caused by our request.
  const expected = sessionStorage.getItem(SOCIAL_STATE_KEY)
  sessionStorage.removeItem(SOCIAL_STATE_KEY)
  const returned = typeof route.query.state === 'string' ? route.query.state : ''
  const cleanQuery = cleanSocialQuery()
  if (!expected || returned !== expected) {
    router.replace({ path: '/login', query: cleanQuery })
    error.value = '로그인 요청을 확인할 수 없습니다. 다시 시도해 주세요.'
    return
  }
  if (err) {
    router.replace({ path: '/login', query: cleanQuery })
    error.value = SOCIAL_ERRORS[err] || '소셜 로그인에 실패했습니다.'
    return
  }
  socialLoading.value = true
  try {
    const res = await fetch(`${API_BASE_URL}/api/v1/auth/social/kakao/exchange`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: loginCode })
    })
    const json = await res.json().catch(() => ({}))
    if (!res.ok || !json.success || !json.token || !json.user) {
      router.replace({ path: '/login', query: cleanQuery })
      error.value = json.error || '소셜 로그인에 실패했습니다.'
      return
    }
    const u = json.user
    auth.login({ id: u.id, name: u.full_name || '회원', email: u.email }, json.token)
    router.replace(safeRedirect())
  } catch {
    router.replace({ path: '/login', query: cleanQuery })
    error.value = '서버에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요.'
  } finally {
    socialLoading.value = false
  }
}
onMounted(consumeSocialReturn)
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

    <div class="my-4 flex items-center gap-3 text-xs text-ink-muted" aria-hidden="true">
      <span class="h-px flex-1 bg-line"></span>또는<span class="h-px flex-1 bg-line"></span>
    </div>

    <button type="button" :disabled="socialLoading" class="flex h-12 w-full items-center justify-center gap-2 rounded bg-[#FEE500] text-[15px] font-semibold text-[#000000] disabled:cursor-wait disabled:opacity-70" @click="startKakao">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 3C6.48 3 2 6.36 2 10.5c0 2.62 1.73 4.92 4.34 6.17-.19.68-.69 2.48-.71 2.56-.02.1.04.2.14.2.05 0 .1-.02.15-.04l3-1.98c.63.18 1.3.27 2.08.27 5.52 0 10-3.36 10-7.5S17.52 3 12 3Z" /></svg>
      {{ socialLoading ? '카카오로 이동 중...' : '카카오로 시작하기' }}
    </button>

    <div class="mt-4 text-right text-sm">
      <RouterLink to="/forgot-password" class="text-ink-muted hover:text-ink hover:underline">비밀번호를 잊으셨나요?</RouterLink>
    </div>

    <template #footer>
      계정이 없으신가요? <RouterLink :to="{ path: '/register', query: route.query.redirect ? { redirect: route.query.redirect } : {} }" class="font-semibold text-primary hover:underline">회원가입</RouterLink>
    </template>
  </AuthCard>
</template>
