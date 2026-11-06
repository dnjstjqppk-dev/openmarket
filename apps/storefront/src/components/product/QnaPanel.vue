<script setup lang="ts">
// Product Q&A: GET /products/:id/qna (secret questions are masked by the server unless they are the viewer's own),
// POST needs a signed-in customer; the server records the asker and sets the status (WAITING -> ANSWERED by the
// seller). The old form sent a made-up asker name ("Alex Kim") that the server ignored, and had no secret option.
import { ref, watch } from 'vue'
import { Lock } from 'lucide-vue-next'
import { OmButton, OmTextarea, OmCheckbox, OmBadge, OmEmptyState, OmErrorState, OmSkeleton, OmAlert, useToast, formatDate } from '@olmoa/ui'
import { useAuthStore } from '../../stores/auth'
import { API_BASE_URL, authHeader } from '../../config'

const props = defineProps<{ productId: string; loginTo: string }>()
const emit = defineEmits<{ count: [number] }>()
const auth = useAuthStore()
const toast = useToast()

const items = ref<any[]>([])
const loading = ref(true)
const loadError = ref<string | null>(null)

async function load() {
  loading.value = true
  loadError.value = null
  try {
    const res = await fetch(`${API_BASE_URL}/api/v1/products/${encodeURIComponent(props.productId)}/qna`, { headers: { ...authHeader() } })
    const json = await res.json().catch(() => null)
    if (!res.ok || !json?.success) throw new Error(json?.error || `문의를 불러오지 못했습니다 (${res.status})`)
    items.value = json.data || []
    emit('count', items.value.length)
  } catch (e: any) {
    loadError.value = e?.message || '문의를 불러오지 못했습니다'
  } finally {
    loading.value = false
  }
}
watch(() => props.productId, load, { immediate: true })

const question = ref('')
const secret = ref(false)
const submitting = ref(false)
const formError = ref<string | null>(null)
async function submit() {
  formError.value = null
  if (!question.value.trim()) { formError.value = '문의 내용을 입력해 주세요.'; return }
  submitting.value = true
  try {
    const res = await fetch(`${API_BASE_URL}/api/v1/products/${encodeURIComponent(props.productId)}/qna`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeader() },
      body: JSON.stringify({ question: question.value.trim(), is_secret: secret.value })
    })
    const json = await res.json().catch(() => null)
    if (!res.ok || !json?.success) throw new Error(json?.error || `등록하지 못했습니다 (${res.status})`)
    toast.success('문의를 등록했습니다. 판매자가 답변하면 이곳에 표시됩니다.')
    question.value = ''; secret.value = false
    await load()
  } catch (e: any) {
    formError.value = e?.message || '등록하지 못했습니다'
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <div class="space-y-5">
    <form v-if="auth.isAuthenticated" class="space-y-3 rounded-lg border border-line bg-surface-2 p-4" @submit.prevent="submit">
      <OmTextarea v-model="question" label="판매자에게 문의하기" :rows="3" :maxlength="2000" placeholder="사이즈, 구성품, 배송 등 궁금한 점을 남겨 주세요. 연락처·주소 등 개인정보는 적지 마세요." />
      <div class="flex flex-wrap items-center justify-between gap-2">
        <OmCheckbox v-model="secret" label="비밀글 (나와 판매자만 볼 수 있음)" />
        <OmButton type="submit" size="sm" :loading="submitting">문의 등록</OmButton>
      </div>
      <OmAlert v-if="formError" tone="danger">{{ formError }}</OmAlert>
    </form>
    <div v-else class="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line bg-surface-2 p-4 text-sm text-ink-muted">
      상품 문의는 로그인 후 작성할 수 있습니다.
      <OmButton size="sm" variant="outline" :to="loginTo">로그인</OmButton>
    </div>

    <div v-if="loading"><OmSkeleton :lines="2" :count="3" /></div>
    <OmErrorState v-else-if="loadError" compact :message="loadError" @retry="load" />
    <OmEmptyState v-else-if="!items.length" compact title="등록된 문의가 없습니다" />
    <ul v-else class="divide-y divide-line-divider">
      <li v-for="q in items" :key="q.id" class="py-4">
        <div class="flex flex-wrap items-center gap-2 text-xs">
          <OmBadge :tone="q.status === 'ANSWERED' ? 'success' : 'neutral'">{{ q.status === 'ANSWERED' ? '답변 완료' : '답변 대기' }}</OmBadge>
          <span v-if="Number(q.is_secret) === 1" class="inline-flex items-center gap-1 text-ink-subtle"><Lock class="h-3 w-3" aria-hidden="true" />비밀글</span>
          <span class="text-ink-subtle">{{ formatDate(q.created_at) }}</span>
        </div>
        <p class="mt-2 text-sm text-ink"><span class="mr-1.5 font-bold text-ink-muted">Q</span>{{ q.question }}</p>
        <div v-if="q.answer" class="mt-2 rounded-md bg-surface-2 p-3 text-sm text-ink">
          <span class="mr-1.5 font-bold text-primary">A</span>{{ q.answer }}
          <p v-if="q.answered_at" class="mt-1 text-2xs text-ink-subtle">판매자 답변 · {{ formatDate(q.answered_at) }}</p>
        </div>
      </li>
    </ul>
  </div>
</template>
