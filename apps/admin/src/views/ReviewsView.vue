<script setup lang="ts">
// Review moderation (4-20): reported-review queue plus the full list,
// with blind/unblind and delete.
import { ref, onMounted } from 'vue';
import { adminApi } from '../config';
import { userErrorMessage, useConfirm, useToast, OmDataTable, OmStatusTabs, OmEmptyState, OmSkeleton } from '@olmoa/ui'

const { confirm: askConfirm } = useConfirm()
const toastApi = useToast()
const U = '문제가 발생했습니다. 잠시 후 다시 시도해주세요.'

const tab = ref<'reports' | 'all'>('reports')
const reviews = ref<any[]>([]);
const loading = ref(true);
const loadError = ref('')
// F-AN04: the moderator reads the full text in a modal before deleting.
const selectedReview = ref<any | null>(null);
const busyId = ref<string | null>(null)

const columns = [
  { key: 'product', label: '상품', primary: true },
  { key: 'review', label: '리뷰' },
  { key: 'rating', label: '별점', align: 'right' as const },
  { key: 'status', label: '상태' },
  { key: 'date', label: '작성일', mobileHidden: true }
]

async function loadReviews() {
  loading.value = true;
  loadError.value = ''
  try {
    const url = tab.value === 'reports' ? '/api/v1/admin/review-reports' : '/api/v1/admin/reviews?per_page=50'
    const r = await adminApi(url)
    if (!r.ok) throw new Error(r.data.error || '리뷰 목록을 불러오지 못했습니다.')
    reviews.value = Array.isArray(r.data.data) ? r.data.data : [];
  } catch (e: any) {
    loadError.value = userErrorMessage(e, U)
  } finally {
    loading.value = false;
  }
}
function setTab(v: string) { tab.value = v as 'reports' | 'all'; void loadReviews() }
const reviewId = (r: any) => (tab.value === 'reports' ? r.review_id : r.id)

async function setVisibility(row: any, visibility: 'VISIBLE' | 'BLIND') {
  const id = reviewId(row)
  if (!(await askConfirm({
    title: visibility === 'BLIND' ? '리뷰 블라인드' : '블라인드 해제',
    body: visibility === 'BLIND' ? '이 리뷰를 블라인드합니다. 집계에서 제외됩니다.' : '이 리뷰를 다시 노출합니다.',
    danger: visibility === 'BLIND'
  }))) return
  busyId.value = id
  try {
    const r = await adminApi(`/api/v1/admin/reviews/${id}/visibility`, {
      method: 'PUT', json: { visibility, blind_reason: visibility === 'BLIND' ? `신고 처리 (${row.reason || '사유 미기재'})` : undefined }
    })
    if (!r.ok) throw new Error(r.data.error || '처리에 실패했습니다.')
    toastApi.success(visibility === 'BLIND' ? '리뷰가 블라인드되었습니다.' : '블라인드가 해제되었습니다.')
  } catch (e: any) {
    toastApi.error(userErrorMessage(e, '처리에 실패했습니다.'))
  } finally {
    busyId.value = null
  }
  void loadReviews()
}

async function deleteReview(id: string) {
  if (!(await askConfirm({ title: '리뷰 삭제', body: '이 리뷰를 삭제하시겠습니까?', danger: true }))) return;
  busyId.value = id
  try {
    const r = await adminApi(`/api/v1/admin/reviews/${id}`, { method: 'DELETE' })
    if (!r.ok) throw new Error(r.data.error || '삭제에 실패했습니다.')
    reviews.value = reviews.value.filter((x: any) => reviewId(x) !== id);
    toastApi.success('리뷰가 삭제되었습니다.')
  } catch (e: any) {
    toastApi.error(userErrorMessage(e, '삭제에 실패했습니다.'))
  } finally {
    busyId.value = null
  }
}

onMounted(() => void loadReviews());
</script>

<template>
  <div class="space-y-4">
    <div>
      <h1 class="text-xl font-bold text-ink">리뷰 모더레이션</h1>
      <p class="mt-1 text-xs text-ink-muted">신고된 리뷰를 검토하고 블라인드합니다. 블라인드는 집계에서 제외됩니다.</p>
    </div>

    <OmStatusTabs
      v-model="tab"
      :tabs="[{ value: 'reports', label: '신고 대기열' }, { value: 'all', label: '전체 리뷰' }]"
      @update:model-value="setTab"
    />

    <div v-if="loading && !reviews.length" class="rounded-2xl border border-line bg-surface p-6">
      <p class="mb-3 text-xs text-ink-muted">불러오는 중입니다…</p>
      <OmSkeleton variant="row" :count="8" />
    </div>
    <div v-else-if="loadError" class="rounded-2xl border border-danger bg-danger-soft p-6 text-center text-xs text-danger" role="alert">
      <p class="font-bold">{{ U }}</p>
      <p class="mt-1">{{ loadError }}</p>
      <button type="button" class="mx-auto mt-2 block rounded-full bg-secondary px-4 py-1.5 font-bold text-secondary-on hover:bg-secondary-hover" @click="loadReviews">다시 불러오기</button>
    </div>
    <div v-else>
      <OmDataTable
        :columns="columns"
        :rows="reviews"
        :row-key="tab === 'reports' ? 'id' : 'id'"
        empty-title="표시할 리뷰가 없습니다"
        empty-description="새 리뷰·신고가 들어오면 이곳에 표시됩니다."
      >
        <template #cell-product="{ row }"><span class="truncate text-ink-muted">{{ row.product_title || row.product_id }}</span></template>
        <template #cell-review="{ row }">
          <div class="min-w-0">
            <p class="max-w-xs truncate text-ink" :title="row.content">{{ row.content }}</p>
            <p v-if="tab === 'reports'" class="mt-0.5 text-2xs font-bold text-warning">신고 사유: {{ row.reason }}</p>
            <p v-else class="mt-0.5 text-2xs text-ink-subtle">{{ row.reviewer_name }}</p>
          </div>
        </template>
        <template #cell-rating="{ row }"><span class="font-bold text-warning">{{ row.rating }} ★</span></template>
        <template #cell-status="{ row }">
          <span class="rounded-full px-2 py-0.5 text-2xs font-bold whitespace-nowrap" :class="row.visibility === 'BLIND' ? 'bg-surface-3 text-ink-muted' : 'bg-success-soft text-success'">{{ row.visibility === 'BLIND' ? '블라인드' : '노출 중' }}</span>
        </template>
        <template #cell-date="{ row }"><span class="om-num text-ink-muted">{{ String(row.created_at || '').slice(0, 10) }}</span></template>
        <template #actions="{ row }">
          <div class="flex gap-1">
            <button type="button" class="rounded-lg border border-line px-2.5 py-1.5 text-xs font-bold text-ink hover:bg-surface-2" @click="selectedReview = row">전체보기</button>
            <button v-if="row.visibility !== 'BLIND'" type="button" :disabled="busyId === reviewId(row)" class="rounded-lg border border-danger px-2.5 py-1.5 text-xs font-bold text-danger hover:bg-danger-soft disabled:opacity-50" @click="setVisibility(row, 'BLIND')">블라인드</button>
            <button v-else type="button" :disabled="busyId === reviewId(row)" class="rounded-lg border border-line px-2.5 py-1.5 text-xs font-bold text-ink hover:bg-surface-2 disabled:opacity-50" @click="setVisibility(row, 'VISIBLE')">해제</button>
            <button type="button" :disabled="busyId === reviewId(row)" class="rounded-lg border border-line px-2.5 py-1.5 text-xs font-bold text-ink-muted hover:bg-surface-2 disabled:opacity-50" @click="deleteReview(reviewId(row))">삭제</button>
          </div>
        </template>
      </OmDataTable>
      <OmEmptyState v-if="!loading && !reviews.length" title="표시할 리뷰가 없습니다" description="새 리뷰·신고가 들어오면 이곳에 표시됩니다." compact />
    </div>

    <div v-if="selectedReview" class="fixed inset-0 z-modal flex items-center justify-center bg-overlay/50 p-4" @click.self="selectedReview = null">
      <div class="w-full max-w-lg space-y-3 rounded-2xl border border-line bg-surface p-6 text-xs shadow-xl">
        <div class="flex items-start justify-between gap-3">
          <h3 class="text-sm font-bold text-ink">리뷰 전문</h3>
          <button type="button" class="font-bold text-ink-subtle hover:text-ink" @click="selectedReview = null">닫기</button>
        </div>
        <dl class="space-y-1 text-ink-muted">
          <div><dt class="inline font-bold text-ink">상품: </dt><dd class="inline">{{ selectedReview.product_title || selectedReview.product_id }}</dd></div>
          <div><dt class="inline font-bold text-ink">평점: </dt><dd class="inline font-bold text-warning">{{ selectedReview.rating }} ★</dd></div>
          <div><dt class="inline font-bold text-ink">작성일: </dt><dd class="inline">{{ String(selectedReview.created_at || '').slice(0, 16) }}</dd></div>
          <div v-if="tab === 'reports'"><dt class="inline font-bold text-ink">신고 사유: </dt><dd class="inline font-bold text-warning">{{ selectedReview.reason }}</dd></div>
        </dl>
        <p class="whitespace-pre-wrap rounded-xl border border-line bg-surface-2 p-3 text-ink">{{ selectedReview.content }}</p>
        <div class="flex justify-end gap-2">
          <button type="button" class="rounded-lg border border-line px-4 py-2 font-bold text-ink hover:bg-surface-2" @click="selectedReview = null">닫기</button>
          <button v-if="selectedReview.visibility !== 'BLIND'" type="button" class="rounded-lg bg-danger px-4 py-2 font-bold text-primary-on" @click="setVisibility(selectedReview, 'BLIND'); selectedReview = null">블라인드</button>
          <button type="button" class="rounded-lg border border-line px-4 py-2 font-bold text-danger hover:bg-danger-soft" @click="deleteReview(reviewId(selectedReview)); selectedReview = null">삭제</button>
        </div>
      </div>
    </div>
  </div>
</template>
