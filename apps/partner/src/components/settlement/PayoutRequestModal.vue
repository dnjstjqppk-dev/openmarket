<script setup lang="ts">
// Payout request modal (4-6): posts a real request (idempotent); the server
// validates amount, verified account and inflight duplicates.
import { ref, watch } from 'vue'
import { API_BASE_URL, getPartnerHeaders } from '../../config'
import { userErrorMessage, OmModal } from '@olmoa/ui'

const open = defineModel<boolean>('open', { default: false })
const props = defineProps<{ available: number; accountLabel: string; accountVerified: boolean }>()
const emit = defineEmits<{ submitted: [] }>()

const amount = ref('')
const busy = ref(false)
const error = ref('')
const won = (v: any) => `${(Number(v) || 0).toLocaleString('ko-KR')}원`

watch(open, (v) => { if (v) { amount.value = ''; error.value = '' } })

async function submit() {
  const n = Number(amount.value)
  if (!Number.isInteger(n) || n <= 0) { error.value = '출금 금액을 정수로 입력해 주세요.'; return }
  if (n > props.available) { error.value = `출금 가능액(${won(props.available)})을 초과했습니다.`; return }
  busy.value = true
  error.value = ''
  try {
    const key = (globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : `po-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    const res = await fetch(`${API_BASE_URL}/api/v1/partner/payout-requests`, {
      method: 'POST',
      headers: { ...getPartnerHeaders(), 'Content-Type': 'application/json', 'X-Idempotency-Key': key },
      body: JSON.stringify({ amount: n })
    })
    const json = await res.json().catch(() => ({}))
    if (!res.ok || !json.success) throw new Error(json.error || '출금 요청에 실패했습니다.')
    open.value = false
    emit('submitted')
  } catch (e: any) {
    error.value = userErrorMessage(e, '출금 요청에 실패했습니다.')
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <OmModal v-model:open="open" title="출금 요청">
    <div class="space-y-3 text-xs">
      <div class="flex items-center justify-between rounded-xl border border-line bg-surface-2 p-3">
        <span class="text-ink-muted">출금 가능액</span>
        <span class="om-num text-base font-bold text-primary">{{ won(available) }}</span>
      </div>
      <div class="flex items-center justify-between rounded-xl border border-line bg-surface-2 p-3">
        <span class="text-ink-muted">입금 계좌</span>
        <span class="font-mono font-bold text-ink">{{ accountLabel }}</span>
      </div>
      <p v-if="!accountVerified" role="alert" class="rounded-xl border border-warning bg-warning-soft p-3 font-bold text-warning">
        정산 계좌 실명 확인이 필요합니다. 설정에서 계좌를 등록해 주세요.
      </p>
      <label v-else class="block space-y-1">출금 금액<input v-model="amount" type="number" min="1" :max="available" placeholder="원 단위 정수" class="h-10 w-full rounded-lg border border-line bg-surface px-3 text-ink" /></label>
      <p v-if="error" role="alert" class="font-bold text-danger">{{ error }}</p>
    </div>
    <template #footer>
      <button type="button" class="h-10 rounded-lg border border-line px-4 text-sm font-bold text-ink hover:bg-surface-2" @click="open = false">취소</button>
      <button type="button" :disabled="busy || !accountVerified" class="h-10 rounded-lg bg-primary px-4 text-sm font-bold text-primary-on hover:bg-primary-hover disabled:opacity-50" @click="submit">
        {{ busy ? '요청 중…' : '출금 요청' }}
      </button>
    </template>
  </OmModal>
</template>
