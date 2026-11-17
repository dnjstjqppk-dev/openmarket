<script setup lang="ts">
// Payout request modal (5-2, decision-16): full-amount only. No amount input;
// the server creates the request for the current withdrawable full amount.
import { ref, watch } from 'vue'
import { API_BASE_URL, getPartnerHeaders } from '../../config'
import { userErrorMessage, OmModal } from '@olmoa/ui'

const open = defineModel<boolean>('open', { default: false })
const props = defineProps<{ available: number; accountLabel: string; accountVerified: boolean }>()
const emit = defineEmits<{ submitted: [] }>()

const busy = ref(false)
const error = ref('')
const won = (v: any) => `${(Number(v) || 0).toLocaleString('ko-KR')}원`

watch(open, (v) => { if (v) { error.value = '' } })

async function submit() {
  if (props.available <= 0) { error.value = '출금 가능한 금액이 없습니다.'; return }
  busy.value = true
  error.value = ''
  try {
    const key = (globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : `po-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    const res = await fetch(`${API_BASE_URL}/api/v1/partner/payout-requests`, {
      method: 'POST',
      headers: { ...getPartnerHeaders(), 'Content-Type': 'application/json', 'X-Idempotency-Key': key },
      body: JSON.stringify({})
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
      <p v-else-if="available <= 0" role="alert" class="rounded-xl border border-warning bg-warning-soft p-3 font-bold text-warning">
        출금 가능한 금액이 없습니다.
      </p>
      <p v-else class="rounded-xl border border-line bg-surface-2 p-3 font-bold text-ink">
        출금 가능액 {{ won(available) }} 전액을 신청합니다.
      </p>
      <p v-if="error" role="alert" class="font-bold text-danger">{{ error }}</p>
    </div>
    <template #footer>
      <button type="button" class="h-10 rounded-lg border border-line px-4 text-sm font-bold text-ink hover:bg-surface-2" @click="open = false">취소</button>
      <button type="button" :disabled="busy || !accountVerified || available <= 0" class="h-10 rounded-lg bg-primary px-4 text-sm font-bold text-primary-on hover:bg-primary-hover disabled:opacity-50" @click="submit">
        {{ busy ? '요청 중…' : '전액 출금 요청' }}
      </button>
    </template>
  </OmModal>
</template>
