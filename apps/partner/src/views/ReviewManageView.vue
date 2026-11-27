<script setup lang="ts">
// Seller review management (4-8): own products' reviews with rating and
// answered filters, replies and abuse reports.
import { ref, onMounted, watch } from 'vue'
import { API_BASE_URL, getPartnerHeaders } from '../config'
import { userErrorMessage, useConfirm, useToast, OmDataTable, OmStatusTabs, OmModal, OmSkeleton } from '@olmoa/ui'

const { confirm: askConfirm } = useConfirm()
const toastApi = useToast()
const U = '문제가 발생했습니다. 잠시 후 다시 시도해주세요.'
const PER_PAGE = 30
const REASONS = [
  { value: 'PROFANITY', label: '욕설·비방' },
  { value: 'PRIVACY', label: '개인정보 노출' },
  { value: 'AD', label: '광고·도배' },
  { value: 'IRRELEVANT', label: '상품 무관' },
  { value: 'OTHER', label: '기타' }
]

const tab = ref('')
const minRating = ref('')
const photoOnly = ref(false)
const page = ref(1)
const total = ref(0)
const rows = ref<any[]>([])
const loading = ref(true)
const loadError = ref('')

const replyOpen = ref(false)
const replyTarget = ref<any>(null)
const replyBody = ref('')
const replyBusy = ref(false)
const reportOpen = ref(false)
const reportTarget = ref<any>(null)
const reportReason = ref('PROFANITY')
const reportBusy = ref(false)

const columns = [
  { key: 'review', label: '리뷰', primary: true },
  { key: 'product', label: '상품', mobileHidden: true },
  { key: 'rating', label: '별점', align: 'right' as const },
  { key: 'reply', label: '답글' }
]
const photoCount = (row: any) => {
  try {
    const arr = JSON.parse(row.images_json || '[]')
    return Array.isArray(arr) ? arr.length : 0
  } catch { return 0 }
}

async function load() {
  loading.value = true
  loadError.value = ''
  try {
    const params = new URLSearchParams({ page: String(page.value), per_page: String(PER_PAGE) })
    if (tab.value) params.set('answered', tab.value)
    if (minRating.value !== '') params.set('min_rating', minRating.value)
    if (photoOnly.value) params.set('has_photo', 'true')
    const res = await fetch(`${API_BASE_URL}/api/v1/partner/reviews?${params}`, { headers: getPartnerHeaders() })
    const json = await res.json().catch(() => null)
    if (!res.ok || !json?.success) throw new Error(json?.error || '리뷰 목록을 불러오지 못했습니다.')
    rows.value = Array.isArray(json.data) ? json.data : []
    total.value = json.pagination?.total ?? rows.value.length
  } catch (e: any) {
    loadError.value = userErrorMessage(e, U)
  } finally {
    loading.value = false
  }
}
function setTab(v: string) { tab.value = v; page.value = 1; void load() }
watch(page, () => void load())

function openReply(row: any) {
  replyTarget.value = row
  replyBody.value = row.reply?.body || ''
  replyOpen.value = true
}
async function submitReply() {
  if (!replyTarget.value || !replyBody.value.trim()) { toastApi.error('답글을 입력해 주세요.'); return }
  replyBusy.value = true
  try {
    const res = await fetch(`${API_BASE_URL}/api/v1/partner/reviews/${replyTarget.value.id}/reply`, {
      method: 'PUT', headers: getPartnerHeaders(), body: JSON.stringify({ body: replyBody.value.trim() })
    })
    const json = await res.json().catch(() => ({}))
    if (!res.ok || !json.success) throw new Error(json.error || '답글 등록에 실패했습니다.')
    toastApi.success('답글이 등록되었습니다.')
    replyOpen.value = false
  } catch (e: any) {
    toastApi.error(userErrorMessage(e, '답글 등록에 실패했습니다.'))
  } finally {
    replyBusy.value = false
  }
  void load()
}

async function deleteReply(row: any) {
  if (!(await askConfirm({ title: '답글 삭제', body: '등록한 답글을 삭제합니다.', danger: true }))) return
  const res = await fetch(`${API_BASE_URL}/api/v1/partner/reviews/${row.id}/reply`, { method: 'DELETE', headers: getPartnerHeaders() })
  const json = await res.json().catch(() => ({}))
  if (!res.ok || !json.success) { toastApi.error(json.error || '삭제에 실패했습니다.'); return }
  toastApi.success('답글이 삭제되었습니다.')
  void load()
}

function openReport(row: any) {
  reportTarget.value = row
  reportReason.value = 'PROFANITY'
  reportOpen.value = true
}
async function submitReport() {
  if (!reportTarget.value) return
  reportBusy.value = true
  try {
    const res = await fetch(`${API_BASE_URL}/api/v1/partner/reviews/${reportTarget.value.id}/report`, {
      method: 'POST', headers: getPartnerHeaders(), body: JSON.stringify({ reason: reportReason.value })
    })
    const json = await res.json().catch(() => ({}))
    if (!res.ok || !json.success) throw new Error(json.error || '신고에 실패했습니다.')
    toastApi.success('리뷰가 신고되어 운영자가 검토합니다.')
    reportOpen.value = false
  } catch (e: any) {
    toastApi.error(userErrorMessage(e, '신고에 실패했습니다.'))
  } finally {
    reportBusy.value = false
  }
}

onMounted(() => void load())
</script>

<template>
  <div class="space-y-4">
    <h1 class="text-xl font-bold text-ink">리뷰 관리</h1>
    <div class="flex flex-wrap items-center gap-2">
      <OmStatusTabs
        v-model="tab"
        :tabs="[{ value: '', label: '전체' }, { value: 'false', label: '미답변' }, { value: 'true', label: '답변완료' }]"
        @update:model-value="setTab"
      />
      <select v-model="minRating" aria-label="최소 별점" class="h-9 rounded-lg border border-line bg-surface px-2 text-xs text-ink" @change="page = 1; load()">
        <option value="">전체 별점</option>
        <option value="4">4점 이상</option>
        <option value="3">3점 이상</option>
        <option value="2">2점 이상</option>
        <option value="1">1점 이상</option>
      </select>
      <label class="flex h-9 items-center gap-2 rounded-lg border border-line bg-surface px-3 text-xs font-bold text-ink">
        <input v-model="photoOnly" type="checkbox" class="accent-primary" @change="page = 1; load()" /> 포토리뷰만
      </label>
    </div>

    <div v-if="loading && !rows.length" class="rounded-2xl border border-line bg-surface p-6">
      <p class="mb-3 text-xs text-ink-muted">불러오는 중입니다…</p>
      <OmSkeleton variant="row" :count="8" />
    </div>
    <div v-else-if="loadError" class="rounded-2xl border border-danger bg-danger-soft p-6 text-center text-xs text-danger" role="alert">
      <p class="font-bold">{{ U }}</p>
      <p class="mt-1">{{ loadError }}</p>
      <button type="button" class="mx-auto mt-2 block rounded-full bg-secondary px-4 py-1.5 font-bold text-secondary-on hover:bg-secondary-hover" @click="load">다시 불러오기</button>
    </div>
    <div v-else>
      <OmDataTable
        :columns="columns"
        :rows="rows"
        row-key="id"
        v-model:page="page"
        :total="total"
        :page-size="PER_PAGE"
        :loading="loading"
        empty-title="리뷰가 없습니다"
        empty-description="내 상품에 달린 리뷰가 이곳에 표시됩니다."
      >
        <template #cell-review="{ row }">
          <div class="min-w-0">
            <p class="whitespace-pre-wrap text-ink">{{ row.content }}</p>
            <p v-if="photoCount(row) > 0" class="mt-1 text-2xs font-bold text-ink-muted">포토 {{ photoCount(row) }}장</p>
            <p v-if="row.reply" class="mt-1 whitespace-pre-wrap rounded-lg bg-surface-2 p-2 text-ink-muted">내 답글: {{ row.reply.body }}</p>
          </div>
        </template>
        <template #cell-product="{ row }"><span class="text-ink-muted">{{ row.product_title || row.product_id }}</span></template>
        <template #cell-rating="{ row }"><span class="om-num font-bold text-ink">★ {{ row.rating }}</span></template>
        <template #cell-reply="{ row }">
          <span class="rounded-full px-2 py-0.5 text-2xs font-bold whitespace-nowrap" :class="row.reply ? 'bg-success-soft text-success' : 'bg-warning-soft text-warning'">{{ row.reply ? '답변완료' : '미답변' }}</span>
        </template>
        <template #actions="{ row }">
          <div class="flex gap-1">
            <button type="button" class="rounded-lg border border-line px-2.5 py-1.5 text-xs font-bold text-ink hover:bg-surface-2" @click="openReply(row)">{{ row.reply ? '답글 수정' : '답글' }}</button>
            <button v-if="row.reply" type="button" class="rounded-lg border border-line px-2.5 py-1.5 text-xs font-bold text-ink-muted hover:bg-surface-2" @click="deleteReply(row)">삭제</button>
            <button type="button" class="rounded-lg border border-line px-2.5 py-1.5 text-xs font-bold text-ink-muted hover:bg-surface-2" @click="openReport(row)">신고</button>
          </div>
        </template>
      </OmDataTable>
      <OmEmptyState v-if="!loading && !rows.length" title="리뷰가 없습니다" description="내 상품에 달린 리뷰가 이곳에 표시됩니다." compact />
    </div>

    <OmModal v-model:open="replyOpen" title="리뷰 답글">
      <div class="space-y-3 text-xs">
        <p class="rounded-xl bg-surface-2 p-3 text-ink-muted">{{ replyTarget?.content }}</p>
        <textarea v-model="replyBody" rows="4" maxlength="2000" placeholder="답글을 입력해 주세요" aria-label="답글" class="w-full rounded-lg border border-line bg-surface p-3 text-ink" />
      </div>
      <template #footer>
        <button type="button" class="h-10 rounded-lg border border-line px-4 text-sm font-bold text-ink hover:bg-surface-2" @click="replyOpen = false">취소</button>
        <button type="button" :disabled="replyBusy" class="h-10 rounded-lg bg-primary px-4 text-sm font-bold text-primary-on hover:bg-primary-hover disabled:opacity-50" @click="submitReply">{{ replyBusy ? '등록 중…' : '등록' }}</button>
      </template>
    </OmModal>

    <OmModal v-model:open="reportOpen" title="리뷰 신고">
      <div class="space-y-3 text-xs">
        <p class="text-ink-muted">신고된 리뷰는 운영자가 검토합니다. 허위 신고는 제재될 수 있습니다.</p>
        <select v-model="reportReason" aria-label="신고 사유" class="h-10 w-full rounded-lg border border-line bg-surface px-2 text-ink">
          <option v-for="r in REASONS" :key="r.value" :value="r.value">{{ r.label }}</option>
        </select>
      </div>
      <template #footer>
        <button type="button" class="h-10 rounded-lg border border-line px-4 text-sm font-bold text-ink hover:bg-surface-2" @click="reportOpen = false">취소</button>
        <button type="button" :disabled="reportBusy" class="h-10 rounded-lg bg-primary px-4 text-sm font-bold text-primary-on hover:bg-primary-hover disabled:opacity-50" @click="submitReport">{{ reportBusy ? '신고 중…' : '신고' }}</button>
      </template>
    </OmModal>
  </div>
</template>
