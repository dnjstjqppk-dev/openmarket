<script setup lang="ts">
// Payout-request approvals (4-17): seller withdrawal requests — approve,
// reject with a reason, and transfer-result recording.
import { ref, onMounted } from 'vue'
import { adminApi } from '../../config'
import { userErrorMessage, useConfirm, useToast, formatNumber, OmDataTable, OmStatusTabs, OmModal, OmSkeleton } from '@olmoa/ui'

const { confirm: askConfirm } = useConfirm()
const toastApi = useToast()
const U = '문제가 발생했습니다. 잠시 후 다시 시도해주세요.'
const STATUS_LABEL: Record<string, string> = { REQUESTED: '승인 대기', APPROVED: '승인됨', REJECTED: '반려됨', TRANSFERRED: '이체 완료', CANCELLED: '취소됨' }

const tab = ref('REQUESTED')
const rows = ref<any[]>([])
const loading = ref(true)
const loadError = ref('')
const busyId = ref<string | null>(null)
const rejectOpen = ref(false)
const rejectTarget = ref<any>(null)
const rejectReason = ref('')
const transferOpen = ref(false)
const transferTarget = ref<any>(null)
const transferRef = ref('')

const columns = [
  { key: 'seller', label: '판매자', primary: true },
  { key: 'amount', label: '신청액', align: 'right' as const },
  { key: 'status', label: '상태' },
  { key: 'date', label: '신청일', mobileHidden: true }
]
const won = (v: any) => `${(Number(v) || 0).toLocaleString('ko-KR')}원`

async function load() {
  loading.value = true
  loadError.value = ''
  try {
    const r = await adminApi(`/api/v1/admin/payout-requests${tab.value ? `?status=${tab.value}` : ''}`)
    if (!r.ok) throw new Error(r.data.error || '출금 신청을 불러오지 못했습니다.')
    rows.value = Array.isArray(r.data.data) ? r.data.data : []
  } catch (e: any) {
    loadError.value = userErrorMessage(e, U)
  } finally {
    loading.value = false
  }
}
function setTab(v: string) { tab.value = v; void load() }

async function approve(row: any) {
  const ok = await askConfirm({ title: '출금 승인', body: `${row.business_name} 출금 신청을 승인합니다. 실제 이체는 은행에서 별도로 진행합니다.`, amounts: [`출금 ${formatNumber(row.amount)}`], danger: true })
  if (!ok) return
  busyId.value = row.id
  try {
    const r = await adminApi(`/api/v1/admin/payout-requests/${row.id}`, {
      method: 'PUT', headers: { 'X-Idempotency-Key': `pwr-${row.id}-${Date.now()}` }, json: { decision: 'APPROVE' }
    })
    if (!r.ok) throw new Error(r.data.error || '승인에 실패했습니다.')
    toastApi.success('출금 신청이 승인되었습니다. 이체 후 결과를 입력해 주세요.')
  } catch (e: any) {
    toastApi.error(userErrorMessage(e, '승인에 실패했습니다.'))
  } finally {
    busyId.value = null
  }
  void load()
}

function openReject(row: any) {
  rejectTarget.value = row
  rejectReason.value = ''
  rejectOpen.value = true
}

async function submitReject() {
  if (!rejectTarget.value || !rejectReason.value.trim()) { toastApi.error('반려 사유를 입력해 주세요.'); return }
  busyId.value = rejectTarget.value.id
  try {
    const r = await adminApi(`/api/v1/admin/payout-requests/${rejectTarget.value.id}`, {
      method: 'PUT', headers: { 'X-Idempotency-Key': `pwr-${rejectTarget.value.id}-${Date.now()}` },
      json: { decision: 'REJECT', reason: rejectReason.value.trim() }
    })
    if (!r.ok) throw new Error(r.data.error || '반려에 실패했습니다.')
    toastApi.success('출금 신청이 반려되었습니다.')
    rejectOpen.value = false
  } catch (e: any) {
    toastApi.error(userErrorMessage(e, '반려에 실패했습니다.'))
  } finally {
    busyId.value = null
  }
  void load()
}

function openTransfer(row: any) {
  transferTarget.value = row
  transferRef.value = ''
  transferOpen.value = true
}

async function submitTransfer() {
  if (!transferTarget.value || !transferRef.value.trim()) { toastApi.error('이체 참조번호를 입력해 주세요.'); return }
  busyId.value = transferTarget.value.id
  try {
    const r = await adminApi(`/api/v1/admin/payout-requests/${transferTarget.value.id}`, {
      method: 'PUT', headers: { 'X-Idempotency-Key': `pwr-${transferTarget.value.id}-${Date.now()}` },
      json: { decision: 'TRANSFER', bank_transfer_ref: transferRef.value.trim() }
    })
    if (!r.ok) throw new Error(r.data.error || '기록에 실패했습니다.')
    toastApi.success('이체 완료로 기록되었습니다.')
    transferOpen.value = false
  } catch (e: any) {
    toastApi.error(userErrorMessage(e, '기록에 실패했습니다.'))
  } finally {
    busyId.value = null
  }
  void load()
}

onMounted(() => void load())
</script>

<template>
  <div class="space-y-4">
    <div>
      <h1 class="text-xl font-bold text-ink">출금 승인</h1>
      <p class="mt-1 text-xs text-ink-muted">판매자 출금 신청을 승인·반려하고 이체 결과를 기록합니다.</p>
    </div>

    <OmStatusTabs
      v-model="tab"
      :tabs="[
        { value: 'REQUESTED', label: '승인 대기' },
        { value: 'APPROVED', label: '승인됨' },
        { value: 'TRANSFERRED', label: '이체 완료' },
        { value: 'REJECTED', label: '반려됨' },
        { value: '', label: '전체' }
      ]"
      @update:model-value="setTab"
    />

    <div v-if="loading && !rows.length" class="rounded-2xl border border-line bg-surface p-6">
      <p class="mb-3 text-xs text-ink-muted">불러오는 중입니다…</p>
      <OmSkeleton variant="row" :count="8" />
    </div>
    <div v-else-if="loadError" class="rounded-2xl border border-danger bg-danger-soft p-6 text-center text-xs text-danger" role="alert">
      <p class="font-bold">{{ U }}</p>
      <p class="mt-1">{{ loadError }}</p>
      <button type="button" class="mx-auto mt-2 block rounded-full bg-secondary px-4 py-1.5 font-bold text-secondary-on hover:bg-secondary-hover" @click="load">다시 시도</button>
    </div>
    <div v-else>
      <OmDataTable
        :columns="columns"
        :rows="rows"
        row-key="id"
        empty-title="해당 조건의 출금 신청이 없습니다"
        empty-description="새 신청이 들어오면 이곳에 표시됩니다."
      >
        <template #cell-seller="{ row }">
          <div class="min-w-0">
            <p class="truncate font-bold text-ink">{{ row.business_name }}</p>
            <p v-if="row.reason" class="mt-0.5 truncate text-2xs text-ink-subtle">{{ row.reason }}</p>
          </div>
        </template>
        <template #cell-amount="{ row }"><span class="om-num font-bold text-ink">{{ won(row.amount) }}</span></template>
        <template #cell-status="{ row }">
          <span class="rounded-full px-2 py-0.5 text-2xs font-bold whitespace-nowrap" :class="row.status === 'REQUESTED' ? 'bg-warning-soft text-warning' : row.status === 'APPROVED' ? 'bg-info-soft text-info' : row.status === 'TRANSFERRED' ? 'bg-success-soft text-success' : 'bg-surface-3 text-ink-muted'">{{ STATUS_LABEL[row.status] || row.status }}</span>
        </template>
        <template #cell-date="{ row }"><span class="om-num text-ink-muted">{{ String(row.created_at || '').slice(0, 10) }}</span></template>
        <template #actions="{ row }">
          <div class="flex gap-1">
            <button v-if="row.status === 'REQUESTED'" type="button" :disabled="busyId === row.id" class="rounded-lg bg-success px-2.5 py-1.5 text-xs font-bold text-primary-on disabled:opacity-50" @click="approve(row)">승인</button>
            <button v-if="row.status === 'REQUESTED'" type="button" :disabled="busyId === row.id" class="rounded-lg border border-line px-2.5 py-1.5 text-xs font-bold text-ink-muted hover:bg-surface-2 disabled:opacity-50" @click="openReject(row)">반려</button>
            <button v-if="row.status === 'APPROVED'" type="button" :disabled="busyId === row.id" class="rounded-lg bg-secondary px-2.5 py-1.5 text-xs font-bold text-secondary-on hover:bg-secondary-hover disabled:opacity-50" @click="openTransfer(row)">이체 기록</button>
          </div>
        </template>
      </OmDataTable>
      <OmEmptyState v-if="!loading && !rows.length" title="해당 조건의 출금 신청이 없습니다" description="새 신청이 들어오면 이곳에 표시됩니다." compact />
    </div>

    <OmModal v-model:open="rejectOpen" title="출금 반려">
      <div class="space-y-3 text-xs">
        <p class="font-bold text-ink">{{ rejectTarget?.business_name }} · {{ won(rejectTarget?.amount) }}</p>
        <textarea v-model="rejectReason" rows="3" maxlength="500" placeholder="반려 사유를 입력해 주세요" aria-label="반려 사유" class="w-full rounded-lg border border-line bg-surface p-3 text-ink" />
      </div>
      <template #footer>
        <button type="button" class="h-10 rounded-lg border border-line px-4 text-sm font-bold text-ink hover:bg-surface-2" @click="rejectOpen = false">취소</button>
        <button type="button" :disabled="busyId !== null || !rejectReason.trim()" class="h-10 rounded-lg bg-primary px-4 text-sm font-bold text-primary-on hover:bg-primary-hover disabled:opacity-50" @click="submitReject">{{ busyId ? '처리 중…' : '반려' }}</button>
      </template>
    </OmModal>

    <OmModal v-model:open="transferOpen" title="이체 결과 기록">
      <div class="space-y-3 text-xs">
        <p class="font-bold text-ink">{{ transferTarget?.business_name }} · {{ won(transferTarget?.amount) }}</p>
        <input v-model="transferRef" maxlength="100" placeholder="은행 이체 참조번호" aria-label="이체 참조번호" class="h-10 w-full rounded-lg border border-line bg-surface px-3 text-ink" />
      </div>
      <template #footer>
        <button type="button" class="h-10 rounded-lg border border-line px-4 text-sm font-bold text-ink hover:bg-surface-2" @click="transferOpen = false">취소</button>
        <button type="button" :disabled="busyId !== null || !transferRef.trim()" class="h-10 rounded-lg bg-primary px-4 text-sm font-bold text-primary-on hover:bg-primary-hover disabled:opacity-50" @click="submitTransfer">{{ busyId ? '처리 중…' : '기록' }}</button>
      </template>
    </OmModal>
  </div>
</template>
