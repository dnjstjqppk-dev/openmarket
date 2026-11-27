<script setup lang="ts">
// Seller exchange claims (4-5): approve sends the claim to AWAITING_RESHIPMENT,
// then the replacement ships with its own tracking (stock moves server-side).
import { ref, onMounted, watch } from 'vue'
import { API_BASE_URL, getPartnerHeaders } from '../../config'
import { userErrorMessage, useConfirm, useToast, OmDataTable, OmStatusTabs, OmModal, OmSkeleton, OmBulkActionBar } from '@olmoa/ui'
import { STATUS_LABEL, EXCHANGE_LABEL } from '../../lib/claims'

const U = '문제가 발생했습니다. 잠시 후 다시 시도해주세요.'

const { confirm: askConfirm } = useConfirm()
const toastApi = useToast()

const PER_PAGE = 30
const TABS = [
  { value: '', label: '전체' },
  { value: 'REQUESTED', label: '요청' },
  { value: 'APPROVED', label: '승인됨' },
  { value: 'REJECTED', label: '거절됨' }
]
const columns = [
  { key: 'claim', label: '클레임', primary: true },
  { key: 'exchange', label: '교환 품목' },
  { key: 'reship', label: '재발송', mobileHidden: true },
  { key: 'status', label: '상태' }
]

const tab = ref('')
const page = ref(1)
const total = ref(0)
const rows = ref<any[]>([])
const loading = ref(true)
const loadError = ref('')
const selected = ref<(string | number)[]>([])

const decideOpen = ref(false)
const decideTargets = ref<any[]>([])
const decideApprove = ref(true)
const decideNotes = ref('')
const decideBusy = ref(false)
const reshipOpen = ref(false)
const reshipTarget = ref<any>(null)
const reshipCarrier = ref('')
const reshipTracking = ref('')
const reshipReceived = ref(false)
const reshipBusy = ref(false)

async function load() {
  loading.value = true
  loadError.value = ''
  try {
    const params = new URLSearchParams({ claim_type: 'EXCHANGE', page: String(page.value), per_page: String(PER_PAGE) })
    if (tab.value) params.set('status', tab.value)
    const res = await fetch(`${API_BASE_URL}/api/v1/partner/returns?${params}`, { headers: getPartnerHeaders() })
    const json = await res.json().catch(() => null)
    if (!res.ok || !json?.success) throw new Error(json?.error || '교환 목록을 불러오지 못했습니다.')
    rows.value = Array.isArray(json.data) ? json.data : []
    total.value = json.pagination?.total ?? rows.value.length
    selected.value = []
  } catch (e: any) {
    loadError.value = userErrorMessage(e, U)
  } finally {
    loading.value = false
  }
}
function setTab(v: string) { tab.value = v; page.value = 1; void load() }
watch(page, () => void load())

function openDecide(targets: any[], approve: boolean) {
  decideTargets.value = targets
  decideApprove.value = approve
  decideNotes.value = ''
  decideOpen.value = true
}
async function submitDecide() {
  if (!decideApprove.value && !decideNotes.value.trim()) { toastApi.error('거절 사유를 입력해 주세요.'); return }
  if (!(await askConfirm({ title: decideApprove.value ? '교환 승인' : '교환 반려', body: `${decideTargets.value.length}건을 처리합니다.${decideApprove.value ? ' 승인 후 재발송 송장을 등록해야 합니다.' : ''}`, danger: true }))) return
  decideBusy.value = true
  let ok = 0
  let firstError = ''
  try {
    for (const t of decideTargets.value) {
      const res = await fetch(`${API_BASE_URL}/api/v1/partner/returns/${t.id}/status`, {
        method: 'PUT', headers: getPartnerHeaders(),
        body: JSON.stringify({ decision: decideApprove.value ? 'APPROVE' : 'REJECT', notes: decideNotes.value.trim() || undefined })
      })
      const json = await res.json().catch(() => ({}))
      if (res.ok && json.success) ok += 1
      else if (!firstError) firstError = json.error || '처리에 실패했습니다.'
    }
    if (ok === decideTargets.value.length) toastApi.success(`${ok}건 처리되었습니다.`)
    else toastApi.error(`부분 실패 (성공 ${ok}건): ${firstError}`)
    decideOpen.value = false
  } finally {
    decideBusy.value = false
  }
  void load()
}

function openReship(row: any) {
  reshipTarget.value = row
  reshipCarrier.value = ''
  reshipTracking.value = ''
  reshipReceived.value = false
  reshipOpen.value = true
}
async function submitReship() {
  if (!reshipTarget.value) return
  if (!reshipCarrier.value.trim()) { toastApi.error('택배사를 입력해 주세요.'); return }
  if (!/^[A-Za-z0-9-]{6,40}$/.test(reshipTracking.value.trim())) { toastApi.error('송장번호 형식을 확인해 주세요.'); return }
  reshipBusy.value = true
  try {
    const res = await fetch(`${API_BASE_URL}/api/v1/partner/returns/${reshipTarget.value.id}/reship`, {
      method: 'POST', headers: getPartnerHeaders(),
      body: JSON.stringify({ carrier: reshipCarrier.value.trim(), tracking_number: reshipTracking.value.trim(), return_received: reshipReceived.value })
    })
    const json = await res.json().catch(() => ({}))
    if (!res.ok || !json.success) throw new Error(json.error || '재발송 등록에 실패했습니다.')
    toastApi.success('교환품이 재발송되었습니다. 교체 재고가 차감되었습니다.')
    reshipOpen.value = false
  } catch (e: any) {
    toastApi.error(userErrorMessage(e, '재발송 등록에 실패했습니다.'))
  } finally {
    reshipBusy.value = false
  }
  void load()
}

onMounted(() => void load())
</script>

<template>
  <div class="space-y-4">
    <h1 class="text-xl font-bold text-ink">교환 클레임</h1>
    <OmStatusTabs v-model="tab" :tabs="TABS.map((t) => ({ value: t.value, label: t.label }))" @update:model-value="setTab" />

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
        selectable
        v-model:selected="selected"
        empty-title="교환 요청이 없습니다"
        empty-description="구매자의 교환 신청이 이곳에 표시됩니다."
      >
        <template #cell-claim="{ row }">
          <div class="min-w-0">
            <p class="truncate font-bold text-ink">{{ row.order_no || row.order_id }}</p>
            <p class="om-num truncate text-2xs text-ink-subtle">{{ row.id }}</p>
          </div>
        </template>
        <template #cell-exchange="{ row }"><span class="text-ink-muted">{{ row.exchange_summary || row.reason_code || '-' }}</span></template>
        <template #cell-reship="{ row }">
          <span class="text-ink-muted">{{ row.exchange_status ? (EXCHANGE_LABEL[row.exchange_status] || row.exchange_status) : '-' }}</span>
          <span v-if="row.exchange_tracking_number" class="block font-mono text-2xs text-ink-subtle">{{ row.exchange_tracking_number }}</span>
        </template>
        <template #cell-status="{ row }">
          <span class="rounded-full px-2 py-0.5 text-2xs font-bold whitespace-nowrap" :class="row.status === 'REQUESTED' ? 'bg-warning-soft text-warning' : row.status === 'REJECTED' ? 'bg-danger-soft text-danger' : 'bg-success-soft text-success'">{{ STATUS_LABEL[row.status] || row.status }}</span>
        </template>
        <template #actions="{ row }">
          <div class="flex gap-1">
            <template v-if="row.status === 'REQUESTED'">
              <button type="button" class="rounded-lg bg-primary px-2.5 py-1.5 text-xs font-bold text-primary-on hover:bg-primary-hover" @click="openDecide([row], true)">승인</button>
              <button type="button" class="rounded-lg border border-danger bg-danger-soft px-2.5 py-1.5 text-xs font-bold text-danger" @click="openDecide([row], false)">반려</button>
            </template>
            <button v-if="row.status === 'APPROVED' && row.exchange_status === 'AWAITING_RESHIPMENT'" type="button" class="rounded-lg bg-secondary px-2.5 py-1.5 text-xs font-bold text-secondary-on hover:bg-secondary-hover" @click="openReship(row)">재발송 등록</button>
          </div>
        </template>
      </OmDataTable>
      <OmEmptyState v-if="!loading && !rows.length" title="교환 요청이 없습니다" description="구매자의 교환 신청이 이곳에 표시됩니다." compact />
    </div>

    <OmBulkActionBar :count="selected.length" @clear="selected = []">
      <button type="button" class="rounded-lg bg-primary px-3 py-1.5 text-xs font-bold text-primary-on hover:bg-primary-hover" @click="openDecide(rows.filter((r) => selected.includes(r.id) && r.status === 'REQUESTED'), true)">선택 승인</button>
      <button type="button" class="rounded-lg border border-danger bg-danger-soft px-3 py-1.5 text-xs font-bold text-danger" @click="openDecide(rows.filter((r) => selected.includes(r.id) && r.status === 'REQUESTED'), false)">선택 반려</button>
    </OmBulkActionBar>

    <OmModal v-model:open="decideOpen" :title="decideApprove ? '교환 승인' : '교환 반려'">
      <div class="space-y-3 text-xs">
        <p class="text-ink-muted">{{ decideTargets.length }}건을 {{ decideApprove ? '승인합니다. 이후 재발송 송장을 등록해야 합니다.' : '반려합니다.' }}</p>
        <textarea v-model="decideNotes" rows="3" :placeholder="decideApprove ? '메모 (선택)' : '거절 사유 (필수)'" aria-label="처리 메모" class="w-full rounded-lg border border-line bg-surface p-3 text-ink" />
      </div>
      <template #footer>
        <button type="button" class="h-10 rounded-lg border border-line px-4 text-sm font-bold text-ink hover:bg-surface-2" @click="decideOpen = false">취소</button>
        <button type="button" :disabled="decideBusy" class="h-10 rounded-lg bg-primary px-4 text-sm font-bold text-primary-on hover:bg-primary-hover disabled:opacity-50" @click="submitDecide">{{ decideBusy ? '처리 중…' : decideApprove ? '승인' : '반려' }}</button>
      </template>
    </OmModal>

    <OmModal v-model:open="reshipOpen" title="교환품 재발송">
      <div class="space-y-3 text-xs">
        <p class="font-mono text-ink-muted">{{ reshipTarget?.id }}</p>
        <input v-model="reshipCarrier" placeholder="택배사" aria-label="택배사" class="h-10 w-full rounded-lg border border-line bg-surface px-3 text-ink" />
        <input v-model="reshipTracking" placeholder="송장번호 (영숫자·- 6~40자)" aria-label="송장번호" class="h-10 w-full rounded-lg border border-line bg-surface px-3 font-mono text-ink" />
        <label class="flex cursor-pointer items-center gap-2 font-bold text-ink"><input v-model="reshipReceived" type="checkbox" class="rounded" />반품 회수 확인됨 (재고 복원)</label>
      </div>
      <template #footer>
        <button type="button" class="h-10 rounded-lg border border-line px-4 text-sm font-bold text-ink hover:bg-surface-2" @click="reshipOpen = false">취소</button>
        <button type="button" :disabled="reshipBusy" class="h-10 rounded-lg bg-primary px-4 text-sm font-bold text-primary-on hover:bg-primary-hover disabled:opacity-50" @click="submitReship">{{ reshipBusy ? '등록 중…' : '재발송 등록' }}</button>
      </template>
    </OmModal>
  </div>
</template>
