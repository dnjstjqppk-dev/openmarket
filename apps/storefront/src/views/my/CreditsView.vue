<script setup lang="ts">
// 3-9: /my/credits — credit balance plus the append-only ledger. The balance
// is the server sum; rows render newest first.
import { ref, onMounted } from 'vue'
import { RouterLink } from 'vue-router'
import { API_BASE_URL, authHeader } from '../../config'
import { userErrorMessage, OmEmptyState, OmErrorState, OmSkeleton } from '@olmoa/ui'
import MyLayout from './MyLayout.vue'

const loading = ref(true)
const loadError = ref('')
const balance = ref(0)
const history = ref<any[]>([])

const formatDate = (dStr?: string) => {
  if (!dStr) return '-'
  const d = new Date(dStr)
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`
}

const load = async () => {
  loading.value = true
  loadError.value = ''
  try {
    const res = await fetch(`${API_BASE_URL}/api/v1/credits`, { headers: { ...authHeader() } })
    const json = await res.json()
    if (!json.success) throw new Error(json.error || '적립금을 불러오지 못했습니다.')
    balance.value = json.data.balance || 0
    history.value = json.data.history || []
  } catch (e: any) {
    loadError.value = userErrorMessage(e, '적립금을 불러오지 못했습니다.')
  } finally {
    loading.value = false
  }
}

onMounted(load)
</script>

<template>
  <MyLayout title="적립금">
    <div v-if="loading" class="space-y-3">
      <OmSkeleton variant="rect" height="h-24" />
      <OmSkeleton variant="row" :count="4" />
    </div>
    <OmErrorState v-else-if="loadError" :message="loadError" @retry="load" />
    <div v-else class="space-y-4">
      <section class="rounded-2xl border border-line bg-surface p-5" aria-label="보유 적립금">
        <p class="text-xs font-semibold text-ink-muted">사용 가능한 적립금</p>
        <p class="om-num mt-1 text-2xl font-bold text-primary">{{ balance.toLocaleString('ko-KR') }}원</p>
      </section>
      <ul v-if="history.length" class="space-y-2">
        <li
          v-for="h in history"
          :key="h.id"
          class="flex items-center justify-between gap-3 rounded-2xl border border-line bg-surface px-4 py-3"
        >
          <div class="min-w-0">
            <p class="truncate text-sm font-semibold text-ink">{{ h.reason }}</p>
            <p class="om-num mt-0.5 text-2xs text-ink-subtle">{{ formatDate(h.created_at) }}</p>
          </div>
          <p :class="['om-num shrink-0 text-sm font-bold', Number(h.amount ?? h.amount_delta) >= 0 ? 'text-success' : 'text-danger']">
            {{ Number(h.amount ?? h.amount_delta) >= 0 ? '+' : '' }}{{ Number(h.amount ?? h.amount_delta).toLocaleString('ko-KR') }}원
          </p>
        </li>
      </ul>
      <OmEmptyState
        v-else
        title="적립 내역이 없습니다"
        description="이벤트와 구매 보상으로 적립금이 쌓입니다."
      >
        <RouterLink to="/" class="rounded-full bg-primary px-5 py-2.5 text-xs font-bold text-primary-on hover:bg-primary-hover">쇼핑하러 가기</RouterLink>
      </OmEmptyState>
    </div>
  </MyLayout>
</template>
