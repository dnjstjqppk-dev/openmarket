<script setup lang="ts">
// Buyer sign-up (PHASE 2 redesign). Field rules mirror the server (routes/auth.js): e-mail format, phone
// 01X-XXX(X)-XXXX, password 10–128 chars with 3 of 4 classes, terms + privacy consent required.
// Consent is an explicit, unbundled opt-in (개인정보 보호법): nothing is pre-checked; "전체 동의" only ticks the
// individual boxes, each of which stays visible and can be unticked. The welcome credit is shown only when the
// server reports it was granted (it is 0 while no operator entity is configured).
import { ref, computed } from 'vue'
import { useRouter, useRoute, RouterLink } from 'vue-router'
import { Check, CircleCheck } from 'lucide-vue-next'
import { OmButton, OmInput, OmCheckbox, OmAlert } from '@olmoa/ui'
import AuthCard from '../components/AuthCard.vue'
import { API_BASE_URL } from '../config'
import { useAuthStore } from '../stores/auth'

const router = useRouter()
const route = useRoute()
const auth = useAuthStore()
const fullName = ref('')
const email = ref('')
const password = ref('')
const password2 = ref('')
const phone = ref('')
const agreeTerms = ref(false)
const agreePrivacy = ref(false)
const agreeAge = ref(false)
const success = ref(false)
const welcomeCredit = ref(0)
const error = ref('')
const loading = ref(false)
const touched = ref(false)

const pwChecks = computed(() => {
  const pw = password.value
  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((r) => r.test(pw)).length
  return [
    { ok: pw.length >= 10 && pw.length <= 128, label: '10자 이상' },
    { ok: classes >= 3, label: '영문 대문자·소문자·숫자·특수문자 중 3종류 이상' }
  ]
})
const errors = computed(() => ({
  name: fullName.value.trim() ? null : '이름을 입력해 주세요',
  email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.value.trim()) ? null : '이메일 형식이 올바르지 않습니다',
  password: pwChecks.value.every((c) => c.ok) ? null : '비밀번호 조건을 확인해 주세요',
  password2: password2.value && password2.value === password.value ? null : '비밀번호가 일치하지 않습니다',
  phone: /^01[016789]-?\d{3,4}-?\d{4}$/.test(phone.value.trim()) ? null : '휴대폰 번호 형식이 올바르지 않습니다 (예: 010-1234-5678)',
  consent: agreeTerms.value && agreePrivacy.value && agreeAge.value ? null : '필수 항목에 모두 동의해 주세요'
}))
const show = (k: keyof typeof errors.value) => (touched.value ? errors.value[k] : null)
const allAgreed = computed({
  get: () => agreeTerms.value && agreePrivacy.value && agreeAge.value,
  set: (v: boolean) => { agreeTerms.value = v; agreePrivacy.value = v; agreeAge.value = v }
})
const someAgreed = computed(() => !allAgreed.value && (agreeTerms.value || agreePrivacy.value || agreeAge.value))

function nextPath(): string {
  const r = typeof route.query.redirect === 'string' ? route.query.redirect : '/'
  return r.startsWith('/') && !r.startsWith('//') ? r : '/'
}

async function handleRegister() {
  touched.value = true
  error.value = ''
  if (Object.values(errors.value).some(Boolean)) {
    requestAnimationFrame(() => document.querySelector<HTMLElement>('#main [aria-invalid="true"]')?.focus())
    return
  }
  loading.value = true
  try {
    const res = await fetch(`${API_BASE_URL}/api/v1/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: email.value.trim(), password: password.value, full_name: fullName.value.trim(), phone: phone.value.trim(),
        agree_terms: agreeTerms.value, agree_privacy: agreePrivacy.value
      })
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok || !data.success) {
      error.value = data.error || '회원가입을 완료하지 못했습니다.'
      return
    }
    auth.login({ id: data.user.id, name: data.user.full_name, email: data.user.email }, data.token)
    welcomeCredit.value = Number(data.welcome_credit || 0)
    success.value = true
  } catch {
    error.value = '서버에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요.'
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <AuthCard :title="success ? '가입을 환영합니다' : '회원가입'">
    <div v-if="success" class="text-center" role="status">
      <CircleCheck class="mx-auto h-12 w-12 text-success" aria-hidden="true" />
      <p class="mt-3 text-md text-ink">회원가입이 완료되었습니다.</p>
      <p v-if="welcomeCredit > 0" class="mt-1 text-sm text-ink-muted">웰컴 적립금 {{ welcomeCredit.toLocaleString('ko-KR') }}원이 지급되었습니다. 주문서에서 사용할 수 있습니다.</p>
      <OmButton class="mt-6" variant="primary" size="lg" block @click="router.replace(nextPath())">{{ nextPath() === '/' ? '쇼핑 시작하기' : '계속하기' }}</OmButton>
    </div>

    <form v-else class="space-y-4" novalidate @submit.prevent="handleRegister">
      <OmInput id="reg-name" v-model="fullName" label="이름" autocomplete="name" required maxlength="50" :error="show('name')" />
      <OmInput id="reg-email" v-model="email" label="이메일" type="email" autocomplete="email" placeholder="example@olmoa.com" required :error="show('email')" />
      <div>
        <OmInput id="reg-pw" v-model="password" label="비밀번호" type="password" autocomplete="new-password" required maxlength="128" :error="show('password')" />
        <ul class="mt-2 space-y-1 text-xs" aria-label="비밀번호 조건">
          <li v-for="c in pwChecks" :key="c.label" :class="['flex items-center gap-1.5', c.ok ? 'text-success' : 'text-ink-subtle']">
            <Check class="h-3.5 w-3.5" aria-hidden="true" />{{ c.label }}<span class="sr-only">{{ c.ok ? '충족' : '미충족' }}</span>
          </li>
        </ul>
      </div>
      <OmInput id="reg-pw2" v-model="password2" label="비밀번호 확인" type="password" autocomplete="new-password" required :error="show('password2')" />
      <OmInput id="reg-phone" v-model="phone" label="휴대폰 번호" type="tel" autocomplete="tel" placeholder="010-0000-0000" required :error="show('phone')" />

      <fieldset class="rounded-lg border border-line p-4">
        <legend class="sr-only">약관 동의</legend>
        <OmCheckbox v-model="allAgreed" :indeterminate="someAgreed" label="필수 항목 전체 동의" />
        <div class="mt-3 space-y-2.5 border-t border-line-divider pt-3 text-sm">
          <OmCheckbox v-model="agreeAge" :error="!!show('consent') && !agreeAge"><span class="text-sm">[필수] 만 14세 이상입니다</span></OmCheckbox>
          <OmCheckbox v-model="agreeTerms" :error="!!show('consent') && !agreeTerms"><span class="text-sm">[필수] <RouterLink to="/legal/terms" target="_blank" class="underline underline-offset-2">이용약관</RouterLink> 동의</span></OmCheckbox>
          <OmCheckbox v-model="agreePrivacy" :error="!!show('consent') && !agreePrivacy"><span class="text-sm">[필수] <RouterLink to="/legal/privacy" target="_blank" class="underline underline-offset-2">개인정보 수집·이용</RouterLink> 동의</span></OmCheckbox>
        </div>
        <p v-if="show('consent')" class="mt-2 text-xs font-medium text-danger" role="alert">{{ show('consent') }}</p>
      </fieldset>

      <OmAlert v-if="error" tone="danger">{{ error }}</OmAlert>
      <OmButton type="submit" variant="primary" size="lg" block :loading="loading">가입하기</OmButton>
    </form>

    <template v-if="!success" #footer>
      이미 계정이 있으신가요? <RouterLink :to="{ path: '/login', query: route.query.redirect ? { redirect: route.query.redirect } : {} }" class="font-semibold text-primary hover:underline">로그인</RouterLink>
    </template>
  </AuthCard>
</template>
