<script setup lang="ts">
// 3-9: /my/qna — my 1:1 support inquiries with answers. New inquiries are
// written on /support; this page is the read history.
import { ref, onMounted } from 'vue'
import { RouterLink } from 'vue-router'
import { API_BASE_URL, authHeader } from '../../config'
import { userErrorMessage, OmEmptyState, OmErrorState, OmSkeleton } from '@olmoa/ui'
import MyLayout from './MyLayout.vue'

const loading = ref(true)
const loadError = ref('')
const inquiries = ref<any[]>([])

const CATEGORY_LABEL: Record<string, string> = {
  DELIVERY: '배송',
  REFUND_RETURN: '반품·환불',
  PRICE_MATCH: '가격 보상',
  PAYMENT: '결제',
  PARTNER_JOIN: '입점',
  OTHER: '기타'
}
const statusLabel = (s: string) => (s === 'ANSWERED' ? '답변 완료' : s === 'CLOSED' ? '종료' : '답변 대기')

const formatDate = (dStr?: string) => {
  if (!dStr) return '-'
  const d = new Date(dStr)
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`
}

const load = async () => {
  loading.value = true
  loadError.value = ''
  try {
    const res = await fetch(`${API_BASE_URL}/api/v1/support/inquiries`, { headers: { ...authHeader() } })
    const json = await res.json()
    if (!json.success) throw new Error(json.error || '문의 내역을 불러오지 못했습니다.')
    inquiries.value = json.data
  } catch (e: any) {
    loadError.value = userErrorMessage(e, '문의 내역을 불러오지 못했습니다.')
  } finally {
    loading.value = false
  }
}

onMounted(load)
</script>

<template>
  <MyLayout title="문의 내역">
    <div v-if="loading" class="space-y-3">
      <OmSkeleton variant="row" :count="4" />
    </div>
    <OmErrorState v-else-if="loadError" :message="loadError" @retry="load" />
    <div v-else class="space-y-4">
      <div class="flex justify-end">
        <RouterLink to="/support" class="rounded-xl bg-primary px-4 py-2 text-xs font-bold text-primary-on hover:bg-primary-hover">
          1:1 문의 쓰기
        </RouterLink>
      </div>
      <ul v-if="inquiries.length" class="space-y-3">
        <li
          v-for="q in inquiries"
          :key="q.id"
          class="space-y-2 rounded-2xl border border-line bg-surface p-4"
        >
          <div class="flex flex-wrap items-center gap-2 text-2xs">
            <span
              :class="['rounded-full px-2 py-0.5 font-bold', q.status === 'ANSWERED' ? 'bg-success-soft text-success' : 'bg-surface-3 text-ink-muted']"
            >
              {{ statusLabel(q.status) }}
            </span>
            <span class="font-semibold text-ink-muted">{{ CATEGORY_LABEL[q.category] || '기타' }}</span>
            <span class="om-num ml-auto text-ink-subtle">{{ formatDate(q.created_at) }}</span>
          </div>
          <p class="text-sm font-bold text-ink">{{ q.subject }}</p>
          <p class="whitespace-pre-wrap text-sm text-ink-muted">{{ q.message || q.content }}</p>
          <div v-if="q.answer" class="rounded-xl bg-surface-2 p-3 text-xs">
            <p class="font-bold text-ink">고객센터 답변</p>
            <p class="mt-1 whitespace-pre-wrap text-ink-muted">{{ q.answer }}</p>
          </div>
        </li>
      </ul>
      <OmEmptyState
        v-else
        title="문의 내역이 없습니다"
        description="궁금한 점이 있으면 1:1 문의를 남겨 주세요."
      >
        <RouterLink to="/support" class="rounded-full bg-primary px-5 py-2.5 text-xs font-bold text-primary-on hover:bg-primary-hover">고객센터 가기</RouterLink>
      </OmEmptyState>
    </div>
  </MyLayout>
</template>
