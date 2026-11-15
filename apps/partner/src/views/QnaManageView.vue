<script setup lang="ts">
// Seller product Q&A (4-8): waiting/answered tabs with counts, keyword search
// and single plus bulk answers. Answers post immediately to the PDP.
import { ref, computed, onMounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { API_BASE, getPartnerHeaders } from '../config'
import { userErrorMessage, useToast, OmDataTable, OmStatusTabs, OmSkeleton, OmBulkActionBar } from '@olmoa/ui'

const toastApi = useToast()
const route = useRoute()
const router = useRouter()
const U = '문제가 발생했습니다. 잠시 후 다시 시도해주세요.'

const qnaList = ref<any[]>([])
const loading = ref(true)
const loadError = ref('')
const activeTab = ref(typeof route.query.status === 'string' && ['WAITING', 'ANSWERED'].includes(route.query.status) ? String(route.query.status) : 'WAITING')
const query = ref('')
const selected = ref<(string | number)[]>([])
const answeringId = ref<string | null>(null)
const answerText = ref('')
const isSubmitting = ref(false)
const bulkOpen = ref(false)
const bulkText = ref('')
const bulkBusy = ref(false)

const filteredList = computed(() => {
  const q = query.value.trim()
  return qnaList.value.filter((item) => (activeTab.value === 'ALL' || item.status === activeTab.value)
    && (!q || `${item.question} ${item.product_title || ''}`.includes(q)))
})
const waitingCount = computed(() => qnaList.value.filter((item) => item.status === 'WAITING').length)
const answeredCount = computed(() => qnaList.value.filter((item) => item.status === 'ANSWERED').length)
const isOverdue = (row: any) => {
  if (row.status !== 'WAITING' || !row.created_at) return false
  const at = new Date(String(row.created_at).replace(' ', 'T')).getTime()
  return Number.isFinite(at) && Date.now() - at > 24 * 3600 * 1000
}
const ANSWER_TEMPLATES = [
  { label: '접수 안내', text: '문의가 접수되었습니다. 확인 후 순차적으로 답변드리겠습니다.' },
  { label: '확인 중', text: '추가 확인이 필요해 담당 부서에 전달했습니다. 확인되는 대로 안내드리겠습니다.' },
  { label: '처리 완료', text: '안내드린 내용으로 처리해 드렸습니다. 감사합니다.' }
]

const columns = [
  { key: 'q', label: '문의', primary: true },
  { key: 'product', label: '상품', mobileHidden: true },
  { key: 'status', label: '상태' },
  { key: 'date', label: '등록일', mobileHidden: true }
]

async function loadQnA() {
  loading.value = true
  loadError.value = ''
  try {
    const res = await fetch(`${API_BASE}/api/v1/partner/qna`, { headers: getPartnerHeaders() })
    const json = await res.json().catch(() => ({}))
    if (!res.ok || !json.success) throw new Error(json.error || 'Q&A를 불러오지 못했습니다')
    qnaList.value = Array.isArray(json.data) ? json.data : []
    selected.value = []
  } catch (e: any) {
    loadError.value = userErrorMessage(e, 'Q&A 목록을 불러오지 못했습니다. 다시 시도해 주세요.')
  } finally {
    loading.value = false
  }
}

function setTab(v: string) {
  activeTab.value = v
  router.replace({ path: '/qna', query: { ...route.query, status: v } })
}
watch(() => route.query.status, (s) => { if (typeof s === 'string' && ['ALL', 'WAITING', 'ANSWERED'].includes(s)) activeTab.value = s })

async function postAnswer(id: string, answer: string) {
  const res = await fetch(`${API_BASE}/api/v1/partner/qna/${id}/answer`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...getPartnerHeaders() },
    body: JSON.stringify({ answer })
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok || !json.success) throw new Error(json.error || '답변을 등록하지 못했습니다. 잠시 후 다시 시도해주세요.')
}

async function submitAnswer(id: string) {
  if (!answerText.value.trim() || isSubmitting.value) return
  isSubmitting.value = true
  try {
    await postAnswer(id, answerText.value.trim())
    toastApi.success('답변이 등록되어 상품 상세 페이지에 즉시 노출됩니다.')
    answeringId.value = null
    answerText.value = ''
  } catch (e: any) {
    toastApi.error(userErrorMessage(e, '답변을 등록하지 못했습니다.'))
  } finally {
    isSubmitting.value = false
  }
  void loadQnA()
}

async function submitBulk() {
  const ids = selected.value.map(String)
  if (!ids.length || !bulkText.value.trim() || bulkBusy.value) return
  bulkBusy.value = true
  let ok = 0
  let firstError = ''
  try {
    for (const id of ids) {
      try {
        await postAnswer(id, bulkText.value.trim())
        ok += 1
      } catch (e: any) {
        if (!firstError) firstError = userErrorMessage(e, '등록 실패')
      }
    }
    if (ok === ids.length) toastApi.success(`${ok}건 답변되었습니다.`)
    else toastApi.error(`부분 실패 (성공 ${ok}건): ${firstError}`)
    bulkOpen.value = false
    bulkText.value = ''
  } finally {
    bulkBusy.value = false
  }
  void loadQnA()
}

onMounted(() => void loadQnA())
</script>

<template>
  <div class="space-y-4">
    <h1 class="text-xl font-bold text-ink">상품 문의</h1>
    <OmStatusTabs
      v-model="activeTab"
      :tabs="[
        { value: 'WAITING', label: '미답변', count: waitingCount },
        { value: 'ANSWERED', label: '답변완료', count: answeredCount },
        { value: 'ALL', label: '전체', count: qnaList.length }
      ]"
      @update:model-value="setTab"
    />
    <input v-model="query" type="search" placeholder="문의 내용·상품명 검색" aria-label="문의 검색" class="h-9 w-full rounded-lg border border-line bg-surface px-3 text-xs text-ink focus:outline-none focus:ring-2 focus-visible:ring-focus sm:w-72" />

    <div v-if="loading && !qnaList.length" class="rounded-2xl border border-line bg-surface p-6">
      <p class="mb-3 text-xs text-ink-muted">불러오는 중입니다…</p>
      <OmSkeleton variant="row" :count="8" />
    </div>
    <div v-else-if="loadError" class="rounded-2xl border border-danger bg-danger-soft p-6 text-center text-xs text-danger" role="alert">
      <p class="font-bold">{{ U }}</p>
      <p class="mt-1">{{ loadError }}</p>
      <button type="button" class="mx-auto mt-2 block rounded-full bg-secondary px-4 py-1.5 font-bold text-secondary-on hover:bg-secondary-hover" @click="loadQnA">다시 불러오기</button>
    </div>
    <div v-else>
      <OmDataTable
        :columns="columns"
        :rows="filteredList"
        row-key="id"
        selectable
        v-model:selected="selected"
        empty-title="문의가 없습니다"
        empty-description="구매자의 상품 문의가 이곳에 표시됩니다."
      >
        <template #cell-q="{ row }">
          <div class="min-w-0">
            <p class="flex flex-wrap items-center gap-1.5 text-ink">
              <span v-if="Number(row.is_secret) === 1" class="shrink-0 rounded-full bg-surface-3 px-2 py-0.5 text-2xs font-bold text-ink-muted">비밀글</span>
              <span>{{ row.question }}</span>
            </p>
            <p v-if="row.answer" class="mt-1 whitespace-pre-wrap rounded-lg bg-surface-2 p-2 text-ink-muted">A. {{ row.answer }}</p>
            <div v-if="answeringId === row.id" class="mt-2 space-y-2">
              <div class="flex flex-wrap gap-1.5">
                <button v-for="tpl in ANSWER_TEMPLATES" :key="tpl.label" type="button" class="rounded-full border border-line px-2.5 py-1 text-2xs font-bold text-ink-muted hover:bg-surface-2" @click="answerText = tpl.text">{{ tpl.label }}</button>
              </div>
              <div class="flex gap-2">
                <input v-model="answerText" placeholder="답변을 입력해 주세요" aria-label="답변" class="h-9 min-w-0 flex-1 rounded-lg border border-line bg-surface px-3 text-xs text-ink" @keyup.enter="submitAnswer(row.id)" />
                <button type="button" :disabled="isSubmitting" class="h-9 shrink-0 rounded-lg bg-primary px-3 text-xs font-bold text-primary-on hover:bg-primary-hover disabled:opacity-50" @click="submitAnswer(row.id)">{{ isSubmitting ? '등록 중…' : '등록' }}</button>
              </div>
            </div>
          </div>
        </template>
        <template #cell-product="{ row }"><span class="text-ink-muted">{{ row.product_title || row.product_id }}</span></template>
        <template #cell-status="{ row }">
          <span class="flex flex-wrap items-center gap-1">
            <span class="rounded-full px-2 py-0.5 text-2xs font-bold" :class="row.status === 'WAITING' ? 'bg-warning-soft text-warning' : 'bg-success-soft text-success'">{{ row.status === 'WAITING' ? '미답변' : '답변완료' }}</span>
            <span v-if="isOverdue(row)" class="rounded-full bg-danger-soft px-2 py-0.5 text-2xs font-bold text-danger">24시간 경과</span>
          </span>
        </template>
        <template #cell-date="{ row }"><span class="om-num text-ink-muted">{{ String(row.created_at || '').slice(0, 10) }}</span></template>
        <template #actions="{ row }">
          <button v-if="row.status === 'WAITING'" type="button" class="rounded-lg border border-line px-2.5 py-1.5 text-xs font-bold text-ink hover:bg-surface-2" @click="answeringId = row.id; answerText = row.answer || ''">답변</button>
        </template>
      </OmDataTable>
      <OmEmptyState v-if="!loading && !filteredList.length" title="문의가 없습니다" description="구매자의 상품 문의가 이곳에 표시됩니다." compact />
    </div>

    <OmBulkActionBar :count="selected.length" @clear="selected = []">
      <button type="button" class="rounded-lg bg-primary px-3 py-1.5 text-xs font-bold text-primary-on hover:bg-primary-hover" @click="bulkOpen = true">선택 일괄 답변</button>
    </OmBulkActionBar>

    <div v-if="bulkOpen" class="fixed inset-0 z-modal flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="일괄 답변">
      <div class="absolute inset-0 bg-overlay/50" @click="bulkOpen = false" />
      <div class="relative w-full max-w-md space-y-3 rounded-2xl border border-line bg-surface p-6">
        <h2 class="text-sm font-bold text-ink">{{ selected.length }}건 일괄 답변</h2>
        <div class="flex flex-wrap gap-1.5">
          <button v-for="tpl in ANSWER_TEMPLATES" :key="tpl.label" type="button" class="rounded-full border border-line px-2.5 py-1 text-2xs font-bold text-ink-muted hover:bg-surface-2" @click="bulkText = tpl.text">{{ tpl.label }}</button>
        </div>
        <textarea v-model="bulkText" rows="4" placeholder="모든 선택 문의에 같은 답변을 등록합니다" aria-label="일괄 답변 내용" class="w-full rounded-lg border border-line bg-surface p-3 text-xs text-ink" />
        <div class="flex justify-end gap-2">
          <button type="button" class="h-10 rounded-lg border border-line px-4 text-sm font-bold text-ink hover:bg-surface-2" @click="bulkOpen = false">취소</button>
          <button type="button" :disabled="bulkBusy" class="h-10 rounded-lg bg-primary px-4 text-sm font-bold text-primary-on hover:bg-primary-hover disabled:opacity-50" @click="submitBulk">{{ bulkBusy ? '등록 중…' : '등록' }}</button>
        </div>
      </div>
    </div>
  </div>
</template>
