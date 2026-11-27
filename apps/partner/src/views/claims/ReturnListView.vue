<script setup lang="ts">
// Seller return claims (4-5): pickup registration, inspection results and
// approve/reject with fault notes. Approve refunds and restocks (server);
// the timeline below each row shows pickup → inspection → decision.
import { ref, onMounted, watch } from 'vue'
import { API_BASE_URL, getPartnerHeaders } from '../../config'
import { userErrorMessage, useConfirm, useToast, OmDataTable, OmStatusTabs, OmModal, OmSkeleton, OmBulkActionBar } from '@olmoa/ui'
import { STATUS_LABEL } from '../../lib/claims'

const U = '문제가 발생했습니다. 잠시 후 다시 시도해주세요.'

const { confirm: askConfirm } = useConfirm()
const toastApi = useToast()

const PER_PAGE = 30
const TABS = [
  { value: '', label: '전체' },
  { value: 'REQUESTED', label: '요청' },
  { value: 'APPROVED', label: '승인됨' },
  { value: 'REFUNDED', label: '환불완료' },
  { value: 'REJECTED', label: '거절됨' }
]
const columns = [
  { key: 'claim', label: '클레임', primary: true },
  { key: 'order', label: '주문', mobileHidden: true },
  { key: 'reason', label: '사유' },
  { key: 'pickup', label: '회수/검수', mobileHidden: true },
  { key: 'status', label: '상태' }
]

const tab = ref('')
const page = ref(1)
const total = ref(0)
const rows = ref<any[]>([])
const loading = ref(true)
const loadError = ref('')
const selected = ref<(string | number)[]>([])

const pickupOpen = ref(false)
const pickupTarget = ref<any>(null)
const pickupCarrier = ref('')
const pickupTracking = ref('')
const pickupBusy = ref(false)
const inspectOpen = ref(false)
const inspectTarget = ref<any>(null)
const inspectResult = ref('NORMAL')
const inspectMemo = ref('')
const inspectBusy = ref(false)
const decideOpen = ref(false)
const decideTargets = ref<any[]>([])
const decideApprove = ref(true)
const decideNotes = ref('')
const decideFault = ref('')
const decideReturnless = ref(false)
const decideBusy = ref(false)

const won = (v: any) => `${(Number(v) || 0).toLocaleString('ko-KR')}원`

async function load() {
  loading.value = true
  loadError.value = ''
  try {
    const params = new URLSearchParams({ claim_type: 'RETURN', page: String(page.value), per_page: String(PER_PAGE) })
    if (tab.value) params.set('status', tab.value)
    const res = await fetch(`${API_BASE_URL}/api/v1/partner/returns?${params}`, { headers: getPartnerHeaders() })
    const json = await res.json().catch(() => null)
    if (!res.ok || !json?.success) throw new Error(json?.error || '반품 목록을 불러오지 못했습니다.')
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

function openPickup(row: any) {
  pickupTarget.value = row
  pickupCarrier.value = row.pickup_carrier || ''
  pickupTracking.value = row.pickup_tracking_number || ''
  pickupOpen.value = true
}
async function submitPickup() {
  if (!pickupTarget.value || !pickupCarrier.value.trim() || !pickupTracking.value.trim()) { toastApi.error('택배사와 송장번호를 입력해 주세요.'); return }
  pickupBusy.value = true
  try {
    const res = await fetch(`${API_BASE_URL}/api/v1/partner/returns/${pickupTarget.value.id}/pickup`, {
      method: 'PUT', headers: getPartnerHeaders(),
      body: JSON.stringify({ carrier: pickupCarrier.value.trim(), tracking_number: pickupTracking.value.trim() })
    })
    const json = await res.json().catch(() => ({}))
    if (!res.ok || !json.success) throw new Error(json.error || '회수 등록에 실패했습니다.')
    toastApi.success('회수 송장이 등록되었습니다.')
    pickupOpen.value = false
  } catch (e: any) {
    toastApi.error(userErrorMessage(e, '회수 등록에 실패했습니다.'))
  } finally {
    pickupBusy.value = false
  }
  void load()
}

function openInspect(row: any) {
  inspectTarget.value = row
  inspectResult.value = 'NORMAL'
  inspectMemo.value = ''
  inspectOpen.value = true
}
async function submitInspect() {
  if (!inspectTarget.value) return
  inspectBusy.value = true
  try {
    const res = await fetch(`${API_BASE_URL}/api/v1/partner/returns/${inspectTarget.value.id}/inspect`, {
      method: 'PUT', headers: getPartnerHeaders(),
      body: JSON.stringify({ result: inspectResult.value, memo: inspectMemo.value.trim() })
    })
    const json = await res.json().catch(() => ({}))
    if (!res.ok || !json.success) throw new Error(json.error || '검수 등록에 실패했습니다.')
    toastApi.success('검수 결과가 등록되었습니다.')
    inspectOpen.value = false
  } catch (e: any) {
    toastApi.error(userErrorMessage(e, '검수 등록에 실패했습니다.'))
  } finally {
    inspectBusy.value = false
  }
  void load()
}

function openDecide(targets: any[], approve: boolean) {
  decideTargets.value = targets
  decideApprove.value = approve
  decideNotes.value = ''
  decideFault.value = ''
  decideReturnless.value = false
  decideOpen.value = true
}
async function submitDecide() {
  if (!decideApprove.value && !decideNotes.value.trim()) { toastApi.error('거절 사유를 입력해 주세요.'); return }
  if (decideFault.value === 'CUSTOMER' && !decideNotes.value.trim()) { toastApi.error('고객 귀책 근거를 적어 주세요.'); return }
  if (!(await askConfirm({ title: decideApprove.value ? '반품 승인' : '반품 거절', body: `${decideTargets.value.length}건을 처리합니다.${decideApprove.value ? ' 승인 시 환불되고 재고가 복원됩니다.' : ''}`, danger: true }))) return
  decideBusy.value = true
  let ok = 0
  let firstError = ''
  try {
    for (const t of decideTargets.value) {
      const res = await fetch(`${API_BASE_URL}/api/v1/partner/returns/${t.id}/status`, {
        method: 'PUT', headers: getPartnerHeaders(),
        body: JSON.stringify({
          decision: decideApprove.value ? 'APPROVE' : 'REJECT',
          notes: decideNotes.value.trim() || undefined,
          fault: decideFault.value || undefined,
          returnless: decideApprove.value && decideReturnless.value ? true : undefined
        })
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

onMounted(() => void load())
</script>

<template>
  <div class="space-y-4">
    <h1 class="text-xl font-bold text-ink">반품 클레임</h1>
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
        empty-title="반품 요청이 없습니다"
        empty-description="구매자의 반품 신청이 이곳에 표시됩니다."
      >
        <template #cell-claim="{ row }">
          <div class="min-w-0">
            <p class="truncate font-bold text-ink">{{ row.order_no || row.order_id }}</p>
            <p class="om-num truncate text-2xs text-ink-subtle">{{ row.id }}</p>
          </div>
        </template>
        <template #cell-order="{ row }"><span class="om-num text-ink-muted">{{ won(row.refund_amount || row.estimated_refund_amount) }}</span></template>
        <template #cell-reason="{ row }"><span class="text-ink-muted">{{ row.reason_code || row.reason || '-' }}</span></template>
        <template #cell-pickup="{ row }">
          <span class="font-mono text-2xs text-ink-muted">{{ row.pickup_tracking_number || '회수 전' }}{{ row.inspect_result ? ` · 검수 ${row.inspect_result}` : '' }}</span>
        </template>
        <template #cell-status="{ row }">
          <span class="rounded-full px-2 py-0.5 text-2xs font-bold whitespace-nowrap" :class="row.status === 'REQUESTED' ? 'bg-warning-soft text-warning' : row.status === 'REJECTED' ? 'bg-danger-soft text-danger' : 'bg-success-soft text-success'">{{ STATUS_LABEL[row.status] || row.status }}</span>
        </template>
        <template #actions="{ row }">
          <div v-if="row.status === 'REQUESTED'" class="flex gap-1">
            <button type="button" class="rounded-lg border border-line px-2.5 py-1.5 text-xs font-bold text-ink hover:bg-surface-2" @click="openPickup(row)">회수등록</button>
            <button type="button" class="rounded-lg border border-line px-2.5 py-1.5 text-xs font-bold text-ink hover:bg-surface-2" @click="openInspect(row)">검수</button>
            <button type="button" class="rounded-lg bg-primary px-2.5 py-1.5 text-xs font-bold text-primary-on hover:bg-primary-hover" @click="openDecide([row], true)">승인</button>
            <button type="button" class="rounded-lg border border-danger bg-danger-soft px-2.5 py-1.5 text-xs font-bold text-danger" @click="openDecide([row], false)">반려</button>
          </div>
        </template>
      </OmDataTable>
      <OmEmptyState v-if="!loading && !rows.length" title="반품 요청이 없습니다" description="구매자의 반품 신청이 이곳에 표시됩니다." compact />
    </div>

    <OmBulkActionBar :count="selected.length" @clear="selected = []">
      <button type="button" class="rounded-lg bg-primary px-3 py-1.5 text-xs font-bold text-primary-on hover:bg-primary-hover" @click="openDecide(rows.filter((r) => selected.includes(r.id) && r.status === 'REQUESTED'), true)">선택 승인</button>
      <button type="button" class="rounded-lg border border-danger bg-danger-soft px-3 py-1.5 text-xs font-bold text-danger" @click="openDecide(rows.filter((r) => selected.includes(r.id) && r.status === 'REQUESTED'), false)">선택 반려</button>
    </OmBulkActionBar>

    <OmModal v-model:open="pickupOpen" title="회수 송장 등록">
      <div class="space-y-3 text-xs">
        <p class="font-mono text-ink-muted">{{ pickupTarget?.id }}</p>
        <input v-model="pickupCarrier" placeholder="택배사" aria-label="택배사" class="h-10 w-full rounded-lg border border-line bg-surface px-3 text-ink" />
        <input v-model="pickupTracking" placeholder="송장번호" aria-label="송장번호" class="h-10 w-full rounded-lg border border-line bg-surface px-3 font-mono text-ink" />
      </div>
      <template #footer>
        <button type="button" class="h-10 rounded-lg border border-line px-4 text-sm font-bold text-ink hover:bg-surface-2" @click="pickupOpen = false">취소</button>
        <button type="button" :disabled="pickupBusy" class="h-10 rounded-lg bg-primary px-4 text-sm font-bold text-primary-on hover:bg-primary-hover disabled:opacity-50" @click="submitPickup">{{ pickupBusy ? '등록 중…' : '등록' }}</button>
      </template>
    </OmModal>

    <OmModal v-model:open="inspectOpen" title="검수 결과 등록">
      <div class="space-y-3 text-xs">
        <div class="flex gap-2">
          <button v-for="r in ['NORMAL', 'DEFECTIVE', 'MISMATCH']" :key="r" type="button" :class="['h-9 flex-1 rounded-lg border font-bold', inspectResult === r ? 'border-primary bg-primary-soft text-primary-soft-ink' : 'border-line text-ink-muted']" @click="inspectResult = r">
            {{ r === 'NORMAL' ? '정상' : r === 'DEFECTIVE' ? '불량' : '오배송' }}
          </button>
        </div>
        <textarea v-model="inspectMemo" rows="3" placeholder="검수 메모" aria-label="검수 메모" class="w-full rounded-lg border border-line bg-surface p-3 text-ink" />
      </div>
      <template #footer>
        <button type="button" class="h-10 rounded-lg border border-line px-4 text-sm font-bold text-ink hover:bg-surface-2" @click="inspectOpen = false">취소</button>
        <button type="button" :disabled="inspectBusy" class="h-10 rounded-lg bg-primary px-4 text-sm font-bold text-primary-on hover:bg-primary-hover disabled:opacity-50" @click="submitInspect">{{ inspectBusy ? '등록 중…' : '등록' }}</button>
      </template>
    </OmModal>

    <OmModal v-model:open="decideOpen" :title="decideApprove ? '반품 승인' : '반품 반려'">
      <div class="space-y-3 text-xs">
        <p class="text-ink-muted">{{ decideTargets.length }}건을 {{ decideApprove ? '승인합니다. 환불되고 재고가 복원됩니다.' : '반려합니다.' }}</p>
        <textarea v-model="decideNotes" rows="3" :placeholder="decideApprove ? '메모 (선택)' : '거절 사유 (필수)'" aria-label="처리 메모" class="w-full rounded-lg border border-line bg-surface p-3 text-ink" />
        <div v-if="decideApprove" class="flex gap-2">
          <select v-model="decideFault" aria-label="귀책" class="h-9 rounded-lg border border-line bg-surface px-2 text-ink">
            <option value="">귀책 변경 없음</option>
            <option value="CUSTOMER">고객 귀책</option>
            <option value="SELLER">판매자 귀책</option>
          </select>
          <label class="flex cursor-pointer items-center gap-1.5 font-bold text-ink"><input v-model="decideReturnless" type="checkbox" class="rounded" />회수 생략</label>
        </div>
      </div>
      <template #footer>
        <button type="button" class="h-10 rounded-lg border border-line px-4 text-sm font-bold text-ink hover:bg-surface-2" @click="decideOpen = false">취소</button>
        <button type="button" :disabled="decideBusy" class="h-10 rounded-lg bg-primary px-4 text-sm font-bold text-primary-on hover:bg-primary-hover disabled:opacity-50" @click="submitDecide">{{ decideBusy ? '처리 중…' : decideApprove ? '승인' : '반려' }}</button>
      </template>
    </OmModal>
  </div>
</template>
