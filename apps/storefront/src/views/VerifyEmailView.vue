<script setup lang="ts">
// Email verification landing for the link mailed by POST /api/v1/auth/send-verification.
// Verifies ?token=… once on load; also accepts a pasted code.
import { ref, onMounted } from 'vue'
import { useRoute, RouterLink } from 'vue-router'
import { OmButton, OmInput, OmAlert } from '@olmoa/ui'
import AuthCard from '../components/AuthCard.vue'
import { API_BASE_URL } from '../config'

const route = useRoute()
const token = ref(typeof route.query.token === 'string' ? route.query.token : '')
const state = ref<'idle' | 'working' | 'done' | 'error'>('idle')
const message = ref('')

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
    </form>
    <template #footer>
      <RouterLink to="/login" class="font-semibold text-primary hover:underline">로그인으로 돌아가기</RouterLink>
    </template>
  </AuthCard>
</template>
