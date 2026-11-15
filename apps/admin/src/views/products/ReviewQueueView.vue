<script setup lang="ts">
// Product review queue (4-14): PENDING products with image/notice/banned/
// hype/hike auto-checks. Flags guide the ruling; approve and reject (with a
// templated reason) stay human decisions.
import { ref, onMounted, watch } from 'vue'
import { adminApi } from '../../config'
import { userErrorMessage, useConfirm, useToast, OmDataTable, OmModal, OmSkeleton } from '@olmoa/ui'

const { confirm: askConfirm } = useConfirm()
const toastApi = useToast()
const U = '문제가 발생했습니다. 잠시 후 다시 시도해주세요.'
const PER_PAGE = 30
const REJECT_TEMPLATES = [
  '이미지 부족: 대표 이미지와 상세 이미지를 등록해 주세요.',
  '고시 누락: 필수 고시 항목을 모두 입력해 주세요.',
  '금칙어 포함: 표시된 금칙어를 삭제하거나 순화해 주세요.',
  '과장 문구: 최저가·보증 등 검증되지 않은 표현을 삭제해 주세요.',
  '정가 인상 후 할인 의심: 할인 직전 정가 인상 내역을 소명해 주세요.'
]

const rows = ref<any[]>([])
const page = ref(1)
const total = ref(0)
const loading = ref(true)
const loadError = ref('')
const rulingId = ref<string | null>(null)
const rejectOpen = ref(false)
const rejectTarget = ref<any>(null)
const rejectNote = ref('')

const columns = [
  { key: 'product', label: '상품', primary: true },
  { key: 'checks', label: '자동 점검' },
  { key: 'date', label: '등록일', mobileHidden: true }
]
const won = (v: any) => `${(Number(v) || 0).toLocaleString('ko-KR')}원`

async function load() {
  loading.value = true
  loadError.value = ''
  try {
    const r = await adminApi(`/api/v1/admin/products/review-queue?page=${page.value}&per_page=${PER_PAGE}`)
    if (!r.ok) throw new Error(r.data.error || '검수 대기열을 불러오지 못했습니다.')
    rows.value = Array.isArray(r.data.data) ? r.data.data : []
    total.value = r.data.pagination?.total ?? rows.value.length
  } catch (e: any) {
    loadError.value = userErrorMessage(e, U)
  } finally {
    loading.value = false
  }
}
watch(page, () => void load())

async function approve(row: any) {
  const flags = [
    ...(row.checks.images.ok ? [] : ['이미지 없음']),
    ...(row.checks.notice.ok ? [] : [`고시 누락(${row.checks.notice.missing.join(', ')})`]),
    ...row.checks.banned_words.map((w: string) => `금칙어(${w})`),
    ...row.checks.exaggeration.map((w: string) => `과장(${w})`),
    ...(row.checks.price_hike ? ['정가인상 의심'] : [])
  ]
  const ok = await askConfirm({
    title: '심사 승인',
    body: `[${row.title}] 상품을 승인합니다.${flags.length ? ` (점검 지적: ${flags.join(', ')})` : ' (점검 지적 없음)'}`,
    danger: flags.length > 0
  })
  if (!ok) return
  rulingId.value = row.id
  try {
    const r = await adminApi(`/api/v1/admin/products/${row.id}/review`, { method: 'POST', json: { decision: 'APPROVE' } })
    if (!r.ok) throw new Error(r.data.error || '승인에 실패했습니다.')
    toastApi.success(`[${row.title}] 승인되었습니다.`)
  } catch (e: any) {
    toastApi.error(userErrorMessage(e, '승인에 실패했습니다.'))
  } finally {
    rulingId.value = null
  }
  void load()
}

function openReject(row: any) {
  rejectTarget.value = row
  rejectNote.value = ''
  rejectOpen.value = true
}

async function submitReject() {
  if (!rejectTarget.value || !rejectNote.value.trim()) { toastApi.error('반려 사유를 입력해 주세요.'); return }
  rulingId.value = rejectTarget.value.id
  try {
    const r = await adminApi(`/api/v1/admin/products/${rejectTarget.value.id}/review`, {
      method: 'POST', json: { decision: 'REJECT', note: rejectNote.value.trim() }
    })
    if (!r.ok) throw new Error(r.data.error || '반려에 실패했습니다.')
    toastApi.success(`[${rejectTarget.value.title}] 반려되었습니다.`)
    rejectOpen.value = false
  } catch (e: any) {
    toastApi.error(userErrorMessage(e, '반려에 실패했습니다.'))
  } finally {
    rulingId.value = null
  }
  void load()
}

onMounted(() => void load())
</script>

<template>
  <div class="space-y-4">
    <div>
      <h1 class="text-xl font-bold text-ink">상품 검수 대기열</h1>
      <p class="mt-1 text-xs text-ink-muted">자동 점검은 참고용입니다. 최종 판정은 검수자가 합니다.</p>
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
        empty-title="검수 대기 중인 상품이 없습니다"
        empty-description="판매자가 상품을 등록하면 이곳에 표시됩니다."
      >
        <template #cell-product="{ row }">
          <div class="min-w-0">
            <p class="truncate font-bold text-ink">{{ row.title }}</p>
            <p class="mt-0.5 text-2xs text-ink-subtle">{{ row.business_name || row.partner_id }} · {{ row.category_name || '미분류' }} · <span class="om-num">{{ won(row.lowest_sale_price) }}</span></p>
          </div>
        </template>
        <template #cell-checks="{ row }">
          <div class="flex max-w-md flex-wrap gap-1">
            <span class="rounded-full px-2 py-0.5 text-2xs font-bold" :class="row.checks.images.ok ? 'bg-success-soft text-success' : 'bg-danger-soft text-danger'">이미지 {{ row.checks.images.count }}장</span>
            <span class="rounded-full px-2 py-0.5 text-2xs font-bold" :class="row.checks.notice.ok ? 'bg-success-soft text-success' : 'bg-danger-soft text-danger'">{{ row.checks.notice.template ? (row.checks.notice.ok ? '고시 완료' : `고시 누락(${row.checks.notice.missing.join(', ')})`) : '고시 미지정' }}</span>
            <span v-for="w in row.checks.banned_words" :key="w" class="rounded-full bg-danger-soft px-2 py-0.5 text-2xs font-bold text-danger">금칙어({{ w }})</span>
            <span v-for="w in row.checks.exaggeration" :key="w" class="rounded-full bg-warning-soft px-2 py-0.5 text-2xs font-bold text-warning">과장({{ w }})</span>
            <span v-if="row.checks.price_hike" class="rounded-full bg-warning-soft px-2 py-0.5 text-2xs font-bold text-warning">정가인상 의심({{ won(row.checks.price_hike.original_before) }}→{{ won(row.checks.price_hike.original_raised) }})</span>
          </div>
        </template>
        <template #cell-date="{ row }"><span class="om-num text-ink-muted">{{ String(row.created_at || '').slice(0, 10) }}</span></template>
        <template #actions="{ row }">
          <div class="flex gap-1">
            <button type="button" :disabled="rulingId === row.id" class="rounded-lg bg-success px-2.5 py-1.5 text-xs font-bold text-primary-on disabled:opacity-50" @click="approve(row)">승인</button>
            <button type="button" :disabled="rulingId === row.id" class="rounded-lg border border-line px-2.5 py-1.5 text-xs font-bold text-ink-muted hover:bg-surface-2 disabled:opacity-50" @click="openReject(row)">반려</button>
          </div>
        </template>
      </OmDataTable>
      <OmEmptyState v-if="!loading && !rows.length" title="검수 대기 중인 상품이 없습니다" description="판매자가 상품을 등록하면 이곳에 표시됩니다." compact />
    </div>

    <OmModal v-model:open="rejectOpen" title="심사 반려">
      <div class="space-y-3 text-xs">
        <p class="font-bold text-ink">{{ rejectTarget?.title }}</p>
        <div class="flex flex-wrap gap-1.5">
          <button v-for="tpl in REJECT_TEMPLATES" :key="tpl" type="button" class="rounded-full border border-line px-2.5 py-1 text-2xs font-bold text-ink-muted hover:bg-surface-2" @click="rejectNote = tpl">{{ tpl.slice(0, tpl.indexOf(':')) }}</button>
        </div>
        <textarea v-model="rejectNote" rows="4" maxlength="500" placeholder="반려 사유를 입력해 주세요" aria-label="반려 사유" class="w-full rounded-lg border border-line bg-surface p-3 text-ink" />
      </div>
      <template #footer>
        <button type="button" class="h-10 rounded-lg border border-line px-4 text-sm font-bold text-ink hover:bg-surface-2" @click="rejectOpen = false">취소</button>
        <button type="button" :disabled="!rejectNote.trim()" class="h-10 rounded-lg bg-primary px-4 text-sm font-bold text-primary-on hover:bg-primary-hover disabled:opacity-50" @click="submitReject">반려</button>
      </template>
    </OmModal>
  </div>
</template>
