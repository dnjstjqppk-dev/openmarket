<script setup lang="ts">
// Email verification landing for the link mailed by POST /api/v1/auth/send-verification.
// Verifies ?token=… once on load; also accepts a pasted code.
import { ref, onMounted, onBeforeUnmount } from 'vue'
import { useRoute, RouterLink } from 'vue-router'
import { OmButton, OmInput, OmAlert } from '@olmoa/ui'
import AuthCard from '../components/AuthCard.vue'
import { API_BASE_URL, authHeader } from '../config'
import { useAuthStore } from '../stores/auth'

const route = useRoute()
const auth = useAuthStore()
const token = ref(typeof route.query.token === 'string' ? route.query.token : '')
const state = ref<'idle' | 'working' | 'done' | 'error'>('idle')
const message = ref('')
// P2-S03: resend with a 60s cooldown (server endpoint requires a login session).
const cooldown = ref(0)
const resending = ref(false)
const resendMsg = ref('')
let cooldownTimer: ReturnType<typeof setInterval> | null = null
onBeforeUnmount(() => { if (cooldownTimer) clearInterval(cooldownTimer) })

async function resend() {
  if (resending.value || cooldown.value > 0) return
  if (!auth.isAuthenticated) {
    resendMsg.value = '로그인 후 인증 메일을 다시 받을 수 있습니다.'
    return
  }
  resending.value = true
  resendMsg.value = ''
  try {
    const res = await fetch(`${API_BASE_URL}/api/v1/auth/send-verification`, { method: 'POST', headers: { ...authHeader() } })
    const json = await res.json().catch(() => ({}))
    if (!res.ok || !json.success) {
      resendMsg.value = json.error || '재발송에 실패했습니다.'
      return
    }
    resendMsg.value = json.message || '인증 메일을 발송했습니다.'
    cooldown.value = 60
    cooldownTimer = setInterval(() => {
      cooldown.value -= 1
      if (cooldown.value <= 0 && cooldownTimer) { clearInterval(cooldownTimer); cooldownTimer = null }
    }, 1000)
  } catch {
    resendMsg.value = '서버에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요.'
  } finally {
    resending.value = false
  }
}

async function verify() {
  if (!token.value.trim() || state.value === 'working') return
  state.value = 'working'
  message.value = ''
  try {
    const res = await fetch(`${API_BASE_URL}/api/v1/auth/verify-email`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: token.value.trim() }) })
    const json = await res.json().catch(() => ({}))
    if (!res.ok || !json.success) {
      state.value = 'error'
      message.value = json.error || '인증에 실패했습니다.'
      return
    }
    state.value = 'done'
    message.value = json.message || '이메일이 인증되었습니다.'
  } catch {
    state.value = 'error'
    message.value = '서버에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요.'
  }
}

onMounted(() => { if (token.value) verify() })
</script>

<template>
  <AuthCard title="이메일 인증" subtitle="메일로 받은 링크를 열었거나 인증 코드를 입력해 주세요.">
    <div v-if="state === 'done'" class="space-y-4">
      <OmAlert tone="success">{{ message }}</OmAlert>
      <OmButton to="/login" variant="primary" size="lg" block>로그인하기</OmButton>
    </div>
    <form v-else class="space-y-4" novalidate @submit.prevent="verify">
      <OmAlert v-if="state === 'error'" tone="danger">{{ message }}</OmAlert>
      <OmInput id="ve-token" v-model="token" label="인증 코드" autocomplete="one-time-code" required help="발급 후 24시간 동안 한 번만 사용할 수 있습니다." />
      <OmButton type="submit" variant="primary" size="lg" block :loading="state === 'working'">인증하기</OmButton>
      <OmAlert v-if="resendMsg" tone="info">{{ resendMsg }}</OmAlert>
      <OmButton type="button" variant="outline" size="md" block :loading="resending" :disabled="resending || cooldown > 0" @click="resend">
        {{ cooldown > 0 ? `${cooldown}초 후 다시 받기` : '인증 메일 다시 받기' }}
      </OmButton>
    </form>
    <template #footer>
      <RouterLink to="/login" class="font-semibold text-primary hover:underline">로그인으로 돌아가기</RouterLink>
    </template>
  </AuthCard>
</template>
