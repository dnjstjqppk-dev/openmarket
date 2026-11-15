<script setup lang="ts">
// Dispute tribunal (4-16): buyer refund, seller-borne returnless refund and
// split rulings over RETURN claims, capped grants over PRICE_ADJUSTMENT.
import { ref, onMounted, watch } from 'vue'
import { adminApi } from '../../config'
import { userErrorMessage, useConfirm, useToast, formatNumber, OmDataTable, OmStatusTabs, OmModal, OmSkeleton } from '@olmoa/ui'

const { confirm: askConfirm } = useConfirm()
const toastApi = useToast()
const U = '문제가 발생했습니다. 잠시 후 다시 시도해주세요.'
const PER_PAGE = 50
const TYPE_LABEL: Record<string, string> = { RETURN: '반품', EXCHANGE: '교환', PRICE_ADJUSTMENT: '차액보상' }

const tab = ref('REQUESTED')
const claimType = ref('')
const rows = ref<any[]>([])
const page = ref(1)
const total = ref(0)
const loading = ref(true)
const loadError = ref('')
const rulingId = ref<string | null>(null)
const splitOpen = ref(false)
const splitTarget = ref<any>(null)
const splitQty = ref<Record<string, number>>({})
const rejectOpen = ref(false)
const rejectTarget = ref<any>(null)
const rejectNote = ref('')

const columns = [
  { key: 'claim', label: '클레임', primary: true },
  { key: 'type', label: '유형' },
  { key: 'amount', label: '요청액', align: 'right' as const },
  { key: 'status', label: '상태' },
  { key: 'date', label: '접수일', mobileHidden: true }
]
const won = (v: any) => `${(Number(v) || 0).toLocaleString('ko-KR')}원`
const claimLines = (row: any) => {
  try {
    const arr = JSON.parse(row.items_json || '[]')
    return Array.isArray(arr) ? arr : []
  } catch { return [] }
}

async function load() {
  loading.value = true
  loadError.value = ''
  try {
    const params = new URLSearchParams({ page: String(page.value), per_page: String(PER_PAGE) })
    if (tab.value) params.set('status', tab.value)
    if (claimType.value) params.set('claim_type', claimType.value)
    const r = await adminApi(`/api/v1/admin/claims?${params}`)
    if (!r.ok) throw new Error(r.data.error || '분쟁 목록을 불러오지 못했습니다.')
    rows.value = Array.isArray(r.data.data) ? r.data.data : []
    total.value = r.data.pagination?.total ?? rows.value.length
  } catch (e: any) {
    loadError.value = userErrorMessage(e, U)
  } finally {
    loading.value = false
  }
}
watch(page, () => void load())
function setTab(v: string) { tab.value = v; page.value = 1; void load() }

async function ruleFull(row: any, returnless: boolean) {
  const label = returnless ? '판매자 부담(반품 면제 환불)' : '구매자 환불'
  const ok = await askConfirm({
    title: '분쟁 판정', body: `클레임 ${row.id} (${won(row.refund_amount)}) ${label} 시 실제 환불이 실행됩니다. 계속할까요?`,
    amounts: [`환불 ${formatNumber(row.refund_amount)}`], danger: true
  })
  if (!ok) return
  rulingId.value = row.id
  try {
    const r = await adminApi(`/api/v1/admin/claims/${row.id}`, { method: 'PUT', json: { decision: 'APPROVE', returnless } })
    if (!r.ok) throw new Error(r.data.error || '판정에 실패했습니다.')
    toastApi.success(`클레임 ${row.id} 처리 완료 (${r.data.status})`)
  } catch (e: any) {
    toastApi.error(userErrorMessage(e, '판정에 실패했습니다.'))
  } finally {
    rulingId.value = null
  }
  void load()
}

function openSplit(row: any) {
  splitTarget.value = row
  splitQty.value = {}
  for (const l of claimLines(row)) splitQty.value[l.order_item_id] = 0
  splitOpen.value = true
}

async function submitSplit() {
  const lines = Object.entries(splitQty.value)
    .filter(([, q]) => Number(q) > 0)
    .map(([order_item_id, quantity]) => ({ order_item_id, quantity: Number(quantity) }))
  if (!splitTarget.value || !lines.length) { toastApi.error('환불할 품목과 수량을 입력해 주세요.'); return }
  const ok = await askConfirm({
    title: '분담 판정', body: `클레임 ${splitTarget.value.id} 중 ${lines.length}개 품목만 환불합니다(분담). 실제 환불이 실행됩니다. 계속할까요?`,
    amounts: [`요청 ${formatNumber(splitTarget.value.refund_amount)} 중 부분`], danger: true
  })
  if (!ok) return
  rulingId.value = splitTarget.value.id
  try {
    const r = await adminApi(`/api/v1/admin/claims/${splitTarget.value.id}`, { method: 'PUT', json: { decision: 'APPROVE', lines } })
    if (!r.ok) throw new Error(r.data.error || '판정에 실패했습니다.')
    toastApi.success(`클레임 ${splitTarget.value.id} 분담 처리 완료 (${r.data.status})`)
    splitOpen.value = false
  } catch (e: any) {
    toastApi.error(userErrorMessage(e, '판정에 실패했습니다.'))
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
  if (!rejectTarget.value || !rejectNote.value.trim()) { toastApi.error('거절 사유를 입력해 주세요.'); return }
  rulingId.value = rejectTarget.value.id
  try {
    const r = await adminApi(`/api/v1/admin/claims/${rejectTarget.value.id}`, { method: 'PUT', json: { decision: 'REJECT', notes: rejectNote.value.trim() } })
    if (!r.ok) throw new Error(r.data.error || '판정에 실패했습니다.')
    toastApi.success(`클레임 ${rejectTarget.value.id} 처리 완료 (${r.data.status})`)
    rejectOpen.value = false
  } catch (e: any) {
    toastApi.error(userErrorMessage(e, '판정에 실패했습니다.'))
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
      <h1 class="text-xl font-bold text-ink">분쟁 판정</h1>
      <p class="mt-1 text-xs text-ink-muted">구매자 환불·판매자 부담(반품 면제)·분담(부분 환불)을 판정합니다. 승인 시 실제 환불이 실행됩니다.</p>
    </div>

    <div class="flex flex-wrap items-center gap-2">
      <OmStatusTabs
        v-model="tab"
        :tabs="[
          { value: 'REQUESTED', label: '판정 대기' },
          { value: 'REFUNDED', label: '환불됨' },
          { value: 'REJECTED', label: '기각' },
          { value: '', label: '전체' }
        ]"
        @update:model-value="setTab"
      />
      <select v-model="claimType" aria-label="클레임 유형" class="h-9 rounded-lg border border-line bg-surface px-2 text-xs text-ink" @change="page = 1; load()">
        <option value="">전체 유형</option>
        <option value="RETURN">반품</option>
        <option value="EXCHANGE">교환</option>
        <option value="PRICE_ADJUSTMENT">차액보상</option>
      </select>
    </div>

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
        v-model:page="page"
        :total="total"
        :page-size="PER_PAGE"
        :loading="loading"
        empty-title="해당 조건의 분쟁이 없습니다"
        empty-description="새 분쟁이 접수되면 이곳에 표시됩니다."
      >
        <template #cell-claim="{ row }">
          <div class="min-w-0">
            <p class="om-num truncate font-bold text-ink">{{ row.id }}</p>
            <p class="mt-0.5 truncate text-2xs text-ink-subtle">{{ row.order_no || row.order_id }} · {{ row.customer_email }}</p>
            <p class="mt-0.5 truncate text-2xs text-ink-muted">{{ row.reason }}</p>
          </div>
        </template>
        <template #cell-type="{ row }"><span class="font-bold text-primary">{{ TYPE_LABEL[row.claim_type] || row.claim_type }}</span></template>
        <template #cell-amount="{ row }"><span class="om-num font-bold text-ink">{{ won(row.refund_amount) }}</span></template>
        <template #cell-status="{ row }">
          <span class="rounded-full px-2 py-0.5 text-2xs font-bold" :class="row.status === 'REQUESTED' ? 'bg-warning-soft text-warning' : row.status === 'REFUNDED' || row.status === 'APPROVED' ? 'bg-success-soft text-success' : 'bg-surface-3 text-ink-muted'">{{ row.status }}</span>
        </template>
        <template #cell-date="{ row }"><span class="om-num text-ink-muted">{{ String(row.created_at || '').slice(0, 10) }}</span></template>
        <template #actions="{ row }">
          <div v-if="row.status === 'REQUESTED'" class="flex flex-wrap gap-1">
            <template v-if="row.claim_type !== 'EXCHANGE'">
              <button type="button" :disabled="rulingId === row.id" class="rounded-lg bg-success px-2.5 py-1.5 text-xs font-bold text-primary-on disabled:opacity-50" @click="ruleFull(row, false)">{{ row.claim_type === 'PRICE_ADJUSTMENT' ? '승인·적립금 지급' : '구매자 환불' }}</button>
              <button v-if="row.claim_type === 'RETURN'" type="button" :disabled="rulingId === row.id" class="rounded-lg border border-line px-2.5 py-1.5 text-xs font-bold text-ink hover:bg-surface-2 disabled:opacity-50" @click="ruleFull(row, true)">판매자 부담</button>
              <button v-if="row.claim_type === 'RETURN'" type="button" :disabled="rulingId === row.id" class="rounded-lg border border-line px-2.5 py-1.5 text-xs font-bold text-ink hover:bg-surface-2 disabled:opacity-50" @click="openSplit(row)">분담</button>
            </template>
            <span v-else class="self-center text-2xs font-bold text-ink-subtle">판매자 승인·재출고 건</span>
            <button type="button" :disabled="rulingId === row.id" class="rounded-lg border border-danger px-2.5 py-1.5 text-xs font-bold text-danger hover:bg-danger-soft disabled:opacity-50" @click="openReject(row)">기각</button>
          </div>
        </template>
      </OmDataTable>
      <OmEmptyState v-if="!loading && !rows.length" title="해당 조건의 분쟁이 없습니다" description="새 분쟁이 접수되면 이곳에 표시됩니다." compact />
    </div>

    <OmModal v-model:open="splitOpen" title="분담 판정">
      <div class="space-y-3 text-xs">
        <p class="text-ink-muted">환불할 품목과 수량만 입력하세요. 나머지는 구매자가 부담합니다.</p>
        <div v-for="l in claimLines(splitTarget || {})" :key="l.order_item_id" class="flex items-center justify-between gap-2">
          <span class="om-num truncate text-ink">{{ l.order_item_id }} (최대 {{ l.quantity }}개)</span>
          <input v-model.number="splitQty[l.order_item_id]" type="number" min="0" :max="l.quantity" class="h-9 w-24 rounded-lg border border-line bg-surface px-2 text-ink" />
        </div>
      </div>
      <template #footer>
        <button type="button" class="h-10 rounded-lg border border-line px-4 text-sm font-bold text-ink hover:bg-surface-2" @click="splitOpen = false">취소</button>
        <button type="button" :disabled="rulingId !== null" class="h-10 rounded-lg bg-primary px-4 text-sm font-bold text-primary-on hover:bg-primary-hover disabled:opacity-50" @click="submitSplit">{{ rulingId ? '처리 중…' : '분담 확정' }}</button>
      </template>
    </OmModal>

    <OmModal v-model:open="rejectOpen" title="청구 기각">
      <div class="space-y-3 text-xs">
        <p class="text-ink-muted">기각 사유는 감사 로그에 기록됩니다.</p>
        <textarea v-model="rejectNote" rows="3" maxlength="500" placeholder="거절 사유를 입력하세요" aria-label="거절 사유" class="w-full rounded-lg border border-line bg-surface p-3 text-ink" />
      </div>
      <template #footer>
        <button type="button" class="h-10 rounded-lg border border-line px-4 text-sm font-bold text-ink hover:bg-surface-2" @click="rejectOpen = false">취소</button>
        <button type="button" :disabled="rulingId !== null || !rejectNote.trim()" class="h-10 rounded-lg bg-primary px-4 text-sm font-bold text-primary-on hover:bg-primary-hover disabled:opacity-50" @click="submitReject">{{ rulingId ? '처리 중…' : '기각 확정' }}</button>
      </template>
    </OmModal>
  </div>
</template>
