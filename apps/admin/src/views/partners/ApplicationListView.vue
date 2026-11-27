<script setup lang="ts">
// Application review queue (4-13): status tabs, applied-period filter and
// business-number search. Rulings happen on the detail screen.
import { ref, onMounted } from 'vue'
import { RouterLink } from 'vue-router'
import { adminApi } from '../../config'
import { userErrorMessage, OmDataTable, OmStatusTabs, OmSkeleton } from '@olmoa/ui'

const U = '문제가 발생했습니다. 잠시 후 다시 시도해주세요.'
const STATUS_LABEL: Record<string, string> = { DRAFT: '작성 중', SUBMITTED: '심사 대기', RESUBMIT_REQUIRED: '보완 요청됨', APPROVED: '승인', REJECTED: '반려' }

const tab = ref('SUBMITTED')
const from = ref('')
const to = ref('')
const brn = ref('')
const rows = ref<any[]>([])
const loading = ref(true)
const loadError = ref('')

const columns = [
  { key: 'biz', label: '상호', primary: true },
  { key: 'brn', label: '사업자번호', mobileHidden: true },
  { key: 'contact', label: '담당자', mobileHidden: true },
  { key: 'docs', label: '서류' },
  { key: 'date', label: '심사 요청일', mobileHidden: true },
  { key: 'status', label: '상태' }
]

async function load() {
  loading.value = true
  loadError.value = ''
  try {
    const params = new URLSearchParams({ kyc_status: tab.value })
    if (from.value) params.set('from', from.value)
    if (to.value) params.set('to', to.value)
    if (brn.value.trim()) params.set('brn', brn.value.trim())
    const r = await adminApi(`/api/v1/admin/partner-applications?${params}`)
    if (!r.ok) throw new Error(r.data.error || '목록을 불러오지 못했습니다.')
    rows.value = Array.isArray(r.data.data) ? r.data.data : []
  } catch (e: any) {
    loadError.value = userErrorMessage(e, U)
  } finally {
    loading.value = false
  }
}

function setTab(v: string) { tab.value = v; void load() }
function docCount(row: any) {
  const docs = (row.documents || []).filter((d: any) => d.status !== 'SUPERSEDED' && d.status !== 'REJECTED')
  const need = (row.required_documents || []).length
  return `${docs.length}/${need}`
}

onMounted(() => void load())
</script>

<template>
  <div class="space-y-4">
    <div>
      <h1 class="text-xl font-bold text-ink">입점 신청 심사</h1>
      <p class="mt-1 text-xs text-ink-muted">서류 원본 대조, 국세청 사업자 상태 조회, 수수료율 확정 후 승인합니다.</p>
    </div>

    <div class="flex flex-wrap items-center gap-2">
      <OmStatusTabs
        v-model="tab"
        :tabs="[
          { value: 'SUBMITTED', label: '제출' },
          { value: 'RESUBMIT_REQUIRED', label: '보완요청' },
          { value: 'APPROVED', label: '승인' },
          { value: 'REJECTED', label: '반려' },
          { value: 'ALL', label: '전체' }
        ]"
        @update:model-value="setTab"
      />
      <input v-model="from" type="date" aria-label="신청 시작일" class="h-9 rounded-lg border border-line bg-surface px-2 text-xs text-ink" @change="load" />
      <span class="text-xs text-ink-subtle">~</span>
      <input v-model="to" type="date" aria-label="신청 종료일" class="h-9 rounded-lg border border-line bg-surface px-2 text-xs text-ink" @change="load" />
      <input v-model="brn" type="search" placeholder="사업자번호 검색" aria-label="사업자번호 검색" class="h-9 w-44 rounded-lg border border-line bg-surface px-3 text-xs text-ink" @keyup.enter="load" />
      <button type="button" class="h-9 rounded-lg bg-secondary px-4 text-xs font-bold text-secondary-on hover:bg-secondary-hover" @click="load">검색</button>
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
        row-key="partner_id"
        empty-title="해당 조건의 입점 신청이 없습니다"
        empty-description="상태 탭이나 검색 조건을 바꿔 보세요."
      >
        <template #cell-biz="{ row }">
          <RouterLink :to="`/partner-applications/${row.partner_id}`" class="font-bold text-primary hover:underline">{{ row.business_name }}</RouterLink>
        </template>
        <template #cell-brn="{ row }"><span class="om-num text-ink-muted">{{ row.business_reg_number }}</span></template>
        <template #cell-contact="{ row }"><span class="text-ink-muted">{{ row.contact_name }} ({{ row.contact_phone }})</span></template>
        <template #cell-docs="{ row }"><span class="om-num text-ink-muted">{{ docCount(row) }}</span></template>
        <template #cell-date="{ row }"><span class="om-num text-ink-muted">{{ String(row.submitted_at || row.applied_at || '').slice(0, 10) }}</span></template>
        <template #cell-status="{ row }">
          <span class="rounded-full px-2 py-0.5 text-2xs font-bold whitespace-nowrap" :class="row.kyc_status === 'APPROVED' ? 'bg-success-soft text-success' : row.kyc_status === 'REJECTED' ? 'bg-danger-soft text-danger' : row.kyc_status === 'SUBMITTED' ? 'bg-warning-soft text-warning' : 'bg-surface-3 text-ink-muted'">{{ STATUS_LABEL[row.kyc_status] || row.kyc_status }}</span>
        </template>
        <template #actions="{ row }">
          <RouterLink :to="`/partner-applications/${row.partner_id}`" class="rounded-lg border border-line px-2.5 py-1.5 text-xs font-bold text-ink hover:bg-surface-2">심사</RouterLink>
        </template>
      </OmDataTable>
      <OmEmptyState v-if="!loading && !rows.length" title="해당 조건의 입점 신청이 없습니다" description="상태 탭이나 검색 조건을 바꿔 보세요." compact />
    </div>
  </div>
</template>
