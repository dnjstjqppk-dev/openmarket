<script setup lang="ts">
// Password reset (PHASE 2 redesign).
// The server issues a 30-minute one-time token but no mail provider is integrated (email_delivery
// NOT_INTEGRATED), so in production nothing is mailed. The page used to say "등록된 이메일로 재설정 링크를
// 발송합니다"; it now says mail cannot be sent and shows the operator's customer-service contact from the
// legal disclosure. Local development returns the token (dev_reset_token) so the reset step can be exercised.
// A future mail link can open this page with ?token=… and go straight to the reset step.
import { ref, computed, onMounted } from 'vue'
import { useRoute, useRouter, RouterLink } from 'vue-router'
import { Check, CircleCheck, Mail, Phone } from 'lucide-vue-next'
import { OmButton, OmInput, OmAlert } from '@olmoa/ui'
import AuthCard from '../components/AuthCard.vue'
import { useBusinessStore } from '../stores/business'
import { API_BASE_URL } from '../config'

const route = useRoute()
const router = useRouter()
const business = useBusinessStore()
const email = ref('')
const token = ref(typeof route.query.token === 'string' ? route.query.token : '')
const newPassword = ref('')
const newPassword2 = ref('')
const step = ref<'request' | 'requested' | 'reset' | 'done'>(token.value ? 'reset' : 'request')
const delivery = ref<string | null>(null)
const serverMessage = ref('')
const error = ref('')
const loading = ref(false)
const touched = ref(false)
onMounted(() => business.load())

const emailError = computed(() => (touched.value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.value.trim()) ? '이메일 형식이 올바르지 않습니다' : null))
const pwChecks = computed(() => {
  const pw = newPassword.value
  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((r) => r.test(pw)).length
  return [{ ok: pw.length >= 10 && pw.length <= 128, label: '10자 이상' }, { ok: classes >= 3, label: '영문 대문자·소문자·숫자·특수문자 중 3종류 이상' }]
})
const pwError = computed(() => (touched.value && !pwChecks.value.every((c) => c.ok) ? '비밀번호 조건을 확인해 주세요' : null))
const pw2Error = computed(() => (touched.value && newPassword2.value !== newPassword.value ? '비밀번호가 일치하지 않습니다' : null))
const tokenError = computed(() => (touched.value && !token.value.trim() ? '재설정 코드를 입력해 주세요' : null))

async function requestReset() {
  touched.value = true
  error.value = ''
  if (emailError.value) return
  loading.value = true
  try {
    const res = await fetch(`${API_BASE_URL}/api/v1/auth/forgot-password`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: email.value.trim() }) })
    const json = await res.json().catch(() => ({}))
    if (!res.ok || !json.success) { error.value = json.error || '요청을 처리하지 못했습니다.'; return }
    delivery.value = json.email_delivery || null
    serverMessage.value = json.message || ''
    touched.value = false
    if (json.dev_reset_token) { token.value = json.dev_reset_token; step.value = 'reset' }
    else step.value = 'requested'
  } catch {
    error.value = '서버에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요.'
  } finally {
    loading.value = false
  }
}

async function resetPassword() {
  touched.value = true
  error.value = ''
  if (tokenError.value || pwError.value || pw2Error.value) return
  loading.value = true
  try {
    const res = await fetch(`${API_BASE_URL}/api/v1/auth/reset-password`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: token.value.trim(), new_password: newPassword.value }) })
    const json = await res.json().catch(() => ({}))
    if (!res.ok || !json.success) { error.value = json.error || '비밀번호를 재설정하지 못했습니다.'; return }
    step.value = 'done'
  } catch {
    error.value = '서버에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요.'
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <AuthCard title="비밀번호 재설정" :subtitle="step === 'request' ? '가입한 이메일을 입력해 주세요.' : undefined">
    <!-- 1. request -->
    <form v-if="step === 'request'" class="space-y-4" novalidate @submit.prevent="requestReset">
      <OmInput id="fp-email" v-model="email" label="이메일" type="email" autocomplete="email" placeholder="example@olmoa.com" required :error="emailError" />
      <OmAlert v-if="error" tone="danger">{{ error }}</OmAlert>
      <OmButton type="submit" variant="primary" size="lg" block :loading="loading">재설정 요청</OmButton>
    </form>

    <!-- 2. requested (production: no mail is sent) -->
    <div v-else-if="step === 'requested'" class="space-y-4">
      <OmAlert :tone="delivery === 'NOT_INTEGRATED' ? 'warning' : 'info'" :title="delivery === 'NOT_INTEGRATED' ? '재설정 메일을 보낼 수 없습니다' : undefined">
        {{ serverMessage }}
      </OmAlert>
      <div v-if="delivery === 'NOT_INTEGRATED'" class="rounded-lg bg-surface-2 p-4 text-sm">
        <p class="font-semibold text-ink">고객센터</p>
        <template v-if="business.info">
          <p class="mt-2 flex items-center gap-2 text-ink"><Phone class="h-4 w-4 text-ink-muted" aria-hidden="true" /><a :href="`tel:${business.info.cs_phone}`" class="hover:underline">{{ business.info.cs_phone }}</a></p>
          <p class="mt-1 flex items-center gap-2 text-ink"><Mail class="h-4 w-4 text-ink-muted" aria-hidden="true" /><a :href="`mailto:${business.info.cs_email}`" class="hover:underline">{{ business.info.cs_email }}</a></p>
        </template>
        <p v-else-if="business.loaded" class="mt-1 text-ink-muted">운영 사업자 정보가 아직 등록되지 않아 연락처를 표시할 수 없습니다.</p>
      </div>
      <OmButton variant="outline" block @click="step = 'reset'">재설정 코드가 있어요</OmButton>
    </div>

    <!-- 3. reset -->
    <form v-else-if="step === 'reset'" class="space-y-4" novalidate @submit.prevent="resetPassword">
      <OmAlert v-if="serverMessage && token" tone="info">개발 환경: 서버가 돌려준 재설정 코드를 채워 두었습니다.</OmAlert>
      <OmInput id="fp-token" v-model="token" label="재설정 코드" autocomplete="one-time-code" required :error="tokenError" help="발급 후 30분 동안 한 번만 사용할 수 있습니다." />
      <div>
        <OmInput id="fp-pw" v-model="newPassword" label="새 비밀번호" type="password" autocomplete="new-password" required maxlength="128" :error="pwError" />
        <ul class="mt-2 space-y-1 text-xs" aria-label="비밀번호 조건">
          <li v-for="c in pwChecks" :key="c.label" :class="['flex items-center gap-1.5', c.ok ? 'text-success' : 'text-ink-subtle']"><Check class="h-3.5 w-3.5" aria-hidden="true" />{{ c.label }}</li>
        </ul>
      </div>
      <OmInput id="fp-pw2" v-model="newPassword2" label="새 비밀번호 확인" type="password" autocomplete="new-password" required :error="pw2Error" />
      <OmAlert v-if="error" tone="danger">{{ error }}</OmAlert>
      <OmButton type="submit" variant="primary" size="lg" block :loading="loading">비밀번호 변경</OmButton>
    </form>

    <!-- 4. done -->
    <div v-else class="text-center" role="status">
      <CircleCheck class="mx-auto h-12 w-12 text-success" aria-hidden="true" />
      <p class="mt-3 text-md text-ink">비밀번호가 변경되었습니다.</p>
      <p class="mt-1 text-sm text-ink-muted">다른 기기의 로그인은 모두 해제되었습니다.</p>
      <OmButton class="mt-6" variant="primary" size="lg" block @click="router.replace('/login')">로그인하기</OmButton>
    </div>

    <template #footer>
      <RouterLink to="/login" class="font-semibold text-primary hover:underline">로그인으로 돌아가기</RouterLink>
    </template>
  </AuthCard>
</template>
