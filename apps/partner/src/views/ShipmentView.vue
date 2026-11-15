<script setup lang="ts">
// Seller shipments (4-4): six status tabs over one server list, masked buyer
// contacts with reason-logged reveal, bulk confirm, single+bulk shipment
// with real carriers, and deadline-delay notices.
import { ref, computed, onMounted, watch } from 'vue'
import { useRoute, useRouter, RouterLink } from 'vue-router'
import { API_BASE_URL, getPartnerHeaders } from '../config'
import { userErrorMessage, useConfirm, useToast, OmDataTable, OmStatusTabs, OmModal, OmSkeleton, OmBulkActionBar } from '@olmoa/ui'

const { confirm: askConfirm } = useConfirm()
const toastApi = useToast()
const route = useRoute()
const router = useRouter()

const U = '문제가 발생했습니다. 잠시 후 다시 시도해주세요.'
const PER_PAGE = 30
const TABS = [
  { value: 'new', label: '신규주문', status: 'PAYMENT_CONFIRMED' },
  { value: 'confirmed', label: '발주확인', status: 'PREPARING' },
  { value: 'waiting', label: '발송대기', status: 'PREPARING', dueOnly: true },
  { value: 'shipping', label: '배송중', status: 'SHIPPED,IN_TRANSIT' },
  { value: 'delivered', label: '배송완료', status: 'DELIVERED' },
  { value: 'done', label: '구매확정', status: 'PURCHASE_CONFIRMED' }
]
const CARRIER_FALLBACK = ['CJ대한통운', '한진택배', '롯데택배']

const tab = ref(typeof route.query.tab === 'string' && TABS.some((t) => t.value === route.query.tab) ? String(route.query.tab) : 'new')
const page = ref(1)
const total = ref(0)
const rows = ref<any[]>([])
const loading = ref(true)
const loadError = ref('')
const selected = ref<(string | number)[]>([])
const carriers = ref<string[]>([])
const defaultPolicy = ref<any>(null)

const fQ = ref('')
const fField = ref('paid')
const fFrom = ref('')
const fTo = ref('')
const fCarrier = ref('')

const shipOpen = ref(false)
const shipTargets = ref<any[]>([])
const shipLines = ref<Record<string, { carrier: string; tracking: string }>>({})
const shipBusy = ref(false)
const delayOpen = ref(false)
const delayTarget = ref<any>(null)
const delayDate = ref('')
const delayReason = ref('')
const delayBusy = ref(false)
const revealOpen = ref(false)
const revealTarget = ref<any>(null)
const revealReason = ref('')
const revealResult = ref<any>(null)
const revealBusy = ref(false)

const won = (v: any) => `${(Number(v) || 0).toLocaleString('ko-KR')}원`
const activeTab = computed(() => TABS.find((t) => t.value === tab.value)!)
const filtered = computed(() => rows.value)

function dueText(deadline: any) {
  if (!deadline) return '-'
  const days = Math.ceil((new Date(String(deadline)).getTime() - Date.now()) / 86400000)
  if (days < 0) return `기한 지남 (${-days}일)`
  if (days === 0) return '오늘까지'
  return `D-${days}`
}
function itemSummary(items: any[]) {
  if (!items?.length) return '-'
  const first = items[0]
  return items.length > 1 ? `${first.product_title} 외 ${items.length - 1}건` : `${first.product_title} × ${first.quantity}`
}

const columns = [
  { key: 'buyer', label: '주문·수령인', primary: true },
  { key: 'sub', label: '하위주문번호' },
  { key: 'items', label: '상품/수량' },
  { key: 'amount', label: '금액', align: 'right' as const },
  { key: 'due', label: '출고기한' },
  { key: 'tracking', label: '운송장', mobileHidden: true }
]

async function loadCarriers() {
  try {
    const res = await fetch(`${API_BASE_URL}/api/v1/logistics/carriers`)
    const json = await res.json().catch(() => null)
    const list = json?.data || json?.carriers || []
    carriers.value = list.map((c: any) => c.name || c.code).filter(Boolean)
    if (!carriers.value.length) carriers.value = [...CARRIER_FALLBACK]
  } catch { carriers.value = [...CARRIER_FALLBACK] }
}
async function loadPolicy() {
  try {
    const res = await fetch(`${API_BASE_URL}/api/v1/partner/shipping-policies`, { headers: getPartnerHeaders() })
    const json = await res.json().catch(() => null)
    defaultPolicy.value = (json?.data || []).find((p: any) => Number(p.is_default) === 1) || (json?.data || [])[0] || null
  } catch { /* policy line hides */ }
}

async function load() {
  loading.value = true
  loadError.value = ''
  try {
    const params = new URLSearchParams({ status: activeTab.value.status, page: String(page.value), per_page: String(PER_PAGE) })
    if (activeTab.value.dueOnly) params.set('due_before', new Date(Date.now() + 86400000).toISOString().slice(0, 10))
    if (fQ.value.trim()) params.set('q', fQ.value.trim())
    params.set('date_field', fField.value)
    if (fFrom.value) params.set('from', fFrom.value)
    if (fTo.value) params.set('to', fTo.value)
    if (fCarrier.value) params.set('carrier', fCarrier.value)
    const res = await fetch(`${API_BASE_URL}/api/v1/partner/orders?${params}`, { headers: getPartnerHeaders() })
    const json = await res.json().catch(() => null)
    if (!res.ok || !json?.success) throw new Error(json?.error || '발주 목록을 불러오지 못했습니다.')
    rows.value = Array.isArray(json.data) ? json.data : []
    total.value = json.pagination?.total ?? rows.value.length
    selected.value = []
  } catch (e: any) {
    loadError.value = userErrorMessage(e, U)
  } finally {
    loading.value = false
  }
}

function setTab(v: string) {
  tab.value = v
  page.value = 1
  router.replace({ path: '/shipments', query: { ...route.query, tab: v } })
  void load()
}
function applySearch() { page.value = 1; void load() }
function resetSearch() {
  fQ.value = ''; fField.value = 'paid'; fFrom.value = ''; fTo.value = ''; fCarrier.value = ''
  page.value = 1; void load()
}
watch(page, () => void load())
watch(() => route.query.tab, (q) => { if (typeof q === 'string' && TABS.some((t) => t.value === q) && q !== tab.value) setTab(q) })

async function bulkConfirm() {
  const ids = selected.value.map(String)
  if (!ids.length) return
  if (!(await askConfirm({ title: '발주 확인', body: `${ids.length}건을 발주 확인합니다. 출고 기한이 설정됩니다.` }))) return
  const res = await fetch(`${API_BASE_URL}/api/v1/partner/orders/confirm`, {
    method: 'PUT', headers: getPartnerHeaders(), body: JSON.stringify({ sub_order_ids: ids })
  })
  const json = await res.json().catch(() => ({}))
  if (res.ok && json.success) toastApi.success(`${json.updated_count ?? ids.length}건 발주 확인되었습니다.`)
  else toastApi.error(json.error || `일부 실패 (성공 ${json.updated_count ?? 0}건)`)
  void load()
}

function openShip(targets: any[]) {
  shipTargets.value = targets
  const lines: Record<string, { carrier: string; tracking: string }> = {}
  for (const t of targets) lines[t.id] = { carrier: t.carrier_code || '', tracking: t.tracking_number || '' }
  shipLines.value = lines
  shipOpen.value = true
}
async function submitShip() {
  for (const t of shipTargets.value) {
    const line = shipLines.value[t.id] || { carrier: '', tracking: '' }
    if (!line.carrier) { toastApi.error('택배사를 선택해 주세요.'); return }
    if (!/^[A-Za-z0-9-]{6,40}$/.test(line.tracking.trim())) { toastApi.error(`송장번호 형식을 확인해 주세요 (${t.sub_order_no}).`); return }
  }
  const names = shipTargets.value.map((t) => t.sub_order_no).join(', ')
  if (!(await askConfirm({ title: '발송 처리 확인', body: `${shipTargets.value.length}건을 발송 처리합니다.`, amounts: [`주문 ${names}`, `택배사 ${shipLines.value[shipTargets.value[0].id].carrier} 외`] }))) return
  shipBusy.value = true
  try {
    const res = await fetch(`${API_BASE_URL}/api/v1/partner/orders/bulk-shipment`, {
      method: 'PUT', headers: getPartnerHeaders(),
      body: JSON.stringify({ shipments: shipTargets.value.map((t) => ({ sub_order_id: t.id, carrier: shipLines.value[t.id].carrier, tracking_number: shipLines.value[t.id].tracking.trim() })) })
    })
    const json = await res.json().catch(() => ({}))
    if (res.ok && json.success) { toastApi.success(`${json.updated_count}건 발송 처리되었습니다.`); shipOpen.value = false }
    else toastApi.error(json.error || `일부 실패 (성공 ${json.updated_count ?? 0}건)`)
  } finally {
    shipBusy.value = false
  }
  void load()
}

function openDelay(row: any) {
  delayTarget.value = row
  delayDate.value = ''
  delayReason.value = ''
  delayOpen.value = true
}
async function submitDelay() {
  if (!delayTarget.value) return
  if (!/^\d{4}-\d{2}-\d{2}$/.test(delayDate.value)) { toastApi.error('새 출고기한을 날짜로 입력해 주세요.'); return }
  if (!delayReason.value.trim()) { toastApi.error('지연 사유를 입력해 주세요.'); return }
  delayBusy.value = true
  try {
    const res = await fetch(`${API_BASE_URL}/api/v1/partner/orders/${delayTarget.value.id}/delay-notice`, {
      method: 'PUT', headers: getPartnerHeaders(),
      body: JSON.stringify({ new_ship_by: delayDate.value, reason: delayReason.value.trim() })
    })
    const json = await res.json().catch(() => ({}))
    if (!res.ok || !json.success) throw new Error(json.error || '지연 통보에 실패했습니다.')
    toastApi.success('지연 통보가 접수되어 구매자에게 알림이 갑니다.')
    delayOpen.value = false
  } catch (e: any) {
    toastApi.error(userErrorMessage(e, '지연 통보에 실패했습니다.'))
  } finally {
    delayBusy.value = false
  }
  void load()
}

function openReveal(row: any) {
  revealTarget.value = row
  revealReason.value = ''
  revealResult.value = null
  revealOpen.value = true
}
async function submitReveal() {
  if (!revealTarget.value || !revealReason.value.trim()) { toastApi.error('열람 사유를 입력해 주세요.'); return }
  revealBusy.value = true
  try {
    const res = await fetch(`${API_BASE_URL}/api/v1/partner/orders/${revealTarget.value.id}/contact?reason=${encodeURIComponent(revealReason.value.trim())}`, { headers: getPartnerHeaders() })
    const json = await res.json().catch(() => ({}))
    if (!res.ok || !json.success) throw new Error(json.error || '열람에 실패했습니다.')
    revealResult.value = json.data
  } catch (e: any) {
    toastApi.error(userErrorMessage(e, '열람에 실패했습니다.'))
  } finally {
    revealBusy.value = false
  }
}

const csvCell = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`
function exportCsv() {
  const head = ['주문번호', '하위주문번호', '상태', '수령인', '연락처', '우편번호', '주소1', '주소2', '상품금액', '배송비', '합계', '택배사', '운송장', '주문일']
  const lines = [head.map(csvCell).join(',')]
  for (const s of filtered.value) {
    lines.push([
      csvCell(s.order_no), csvCell(s.sub_order_no || s.id), csvCell(s.status), csvCell(s.recipient_name),
      csvCell(s.recipient_phone), csvCell(s.shipping_postal_code), csvCell(s.shipping_address_line1),
      csvCell(s.shipping_address_line2), csvCell(s.goods_amount), csvCell(s.shipping_fee), csvCell(s.total_amount),
      csvCell(s.carrier_code), csvCell(s.tracking_number), csvCell(s.order_date)
    ].join(','))
  }
  const blob = new Blob(['\uFEFF' + lines.join('\n')], { type: 'text/csv;charset=utf-8' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `shipments-${tab.value}-${new Date().toISOString().slice(0, 10)}.csv`
  a.click()
  URL.revokeObjectURL(a.href)
}

onMounted(() => { loadCarriers(); loadPolicy(); void load() })
</script>

<template>
  <div class="space-y-4">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <h1 class="text-xl font-bold text-ink">발주 · 발송</h1>
      <button type="button" class="rounded-xl border border-line px-4 py-2 text-xs font-bold text-ink hover:bg-surface-2" @click="exportCsv">현재 목록 CSV 저장</button>
    </div>

    <OmStatusTabs v-model="tab" :tabs="TABS.map((t) => ({ value: t.value, label: t.label }))" @update:model-value="setTab" />

    <div class="grid grid-cols-2 gap-2 rounded-2xl border border-line bg-surface p-4 text-xs md:grid-cols-6">
      <input v-model="fQ" placeholder="주문·하위번호·수령인·운송장·상품·SKU" aria-label="키워드 검색" class="h-9 rounded-lg border border-line bg-surface px-3 text-ink focus:outline-none focus:ring-2 focus-visible:ring-focus md:col-span-2" @keyup.enter="applySearch" />
      <select v-model="fField" aria-label="날짜 기준" class="h-9 rounded-lg border border-line bg-surface px-2 text-ink">
        <option value="paid">결제일</option>
        <option value="confirmed">발주확인일</option>
        <option value="shipped">발송일</option>
      </select>
      <input v-model="fFrom" type="date" aria-label="시작일" class="h-9 rounded-lg border border-line bg-surface px-2 text-ink" />
      <input v-model="fTo" type="date" aria-label="종료일" class="h-9 rounded-lg border border-line bg-surface px-2 text-ink" />
      <select v-model="fCarrier" aria-label="택배사" class="h-9 rounded-lg border border-line bg-surface px-2 text-ink">
        <option value="">전체 택배사</option>
        <option v-for="c in carriers" :key="c" :value="c">{{ c }}</option>
      </select>
      <div class="col-span-2 flex gap-2 md:col-span-6">
        <button type="button" class="h-9 rounded-lg bg-secondary px-4 font-bold text-secondary-on hover:bg-secondary-hover" @click="applySearch">검색</button>
        <button type="button" class="h-9 rounded-lg border border-line px-4 font-bold text-ink-muted hover:bg-surface-2" @click="resetSearch">초기화</button>
      </div>
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
        :rows="filtered"
        row-key="id"
        v-model:page="page"
        :total="total"
        :page-size="PER_PAGE"
        :loading="loading"
        selectable
        v-model:selected="selected"
        empty-title="해당 상태의 주문이 없습니다"
        empty-description="다른 탭이나 검색 조건을 확인해 보세요."
      >
        <template #cell-buyer="{ row }">
          <div class="min-w-0">
            <p class="truncate font-bold text-ink">{{ row.recipient_name }} <span class="font-normal text-ink-muted">{{ row.recipient_phone }}</span></p>
            <button type="button" class="text-2xs font-bold text-primary hover:underline" @click="openReveal(row)">연락처 보기</button>
          </div>
        </template>
        <template #cell-sub="{ row }"><span class="font-mono text-ink">{{ row.sub_order_no }}</span></template>
        <template #cell-items="{ row }"><span class="text-ink-muted">{{ itemSummary(row.items) }}</span></template>
        <template #cell-amount="{ row }"><span class="om-num font-bold text-ink">{{ won(row.total_amount) }}</span></template>
        <template #cell-due="{ row }">
          <span class="om-num font-bold" :class="row.ship_by_deadline && String(row.ship_by_deadline) < new Date().toISOString().slice(0, 10) ? 'text-danger' : 'text-ink'">{{ dueText(row.ship_by_deadline) }}</span>
        </template>
        <template #cell-tracking="{ row }"><span class="font-mono text-ink-muted">{{ row.tracking_number || '-' }}</span></template>
        <template #actions="{ row }">
          <div class="flex gap-1">
            <button v-if="row.status === 'PAYMENT_CONFIRMED'" type="button" class="rounded-lg border border-line px-2.5 py-1.5 text-xs font-bold text-ink hover:bg-surface-2" @click="selected = [row.id]; bulkConfirm()">발주확인</button>
            <button v-if="['PAYMENT_CONFIRMED', 'PREPARING'].includes(row.status)" type="button" class="rounded-lg bg-primary px-2.5 py-1.5 text-xs font-bold text-primary-on hover:bg-primary-hover" @click="openShip([row])">발송</button>
            <button v-if="['PAYMENT_CONFIRMED', 'PREPARING'].includes(row.status)" type="button" class="rounded-lg border border-line px-2.5 py-1.5 text-xs font-bold text-ink-muted hover:bg-surface-2" @click="openDelay(row)">지연</button>
          </div>
        </template>
      </OmDataTable>
      <OmEmptyState v-if="!loading && !filtered.length" title="해당 상태의 주문이 없습니다" description="다른 탭이나 검색 조건을 확인해 보세요." compact />
    </div>

    <OmBulkActionBar :count="selected.length" @clear="selected = []">
      <button type="button" class="rounded-lg bg-secondary px-3 py-1.5 text-xs font-bold text-secondary-on hover:bg-secondary-hover" @click="bulkConfirm">선택 발주확인</button>
      <button type="button" class="rounded-lg bg-primary px-3 py-1.5 text-xs font-bold text-primary-on hover:bg-primary-hover" @click="openShip(filtered.filter((r) => selected.includes(r.id)))">선택 발송</button>
    </OmBulkActionBar>

    <OmModal v-model:open="shipOpen" title="발송 처리" size="lg">
      <p v-if="defaultPolicy" class="mb-3 text-xs text-ink-muted">기본 배송 정책: {{ defaultPolicy.name }} <RouterLink to="/profile" class="font-bold text-primary hover:underline">설정에서 변경</RouterLink></p>
      <div class="max-h-80 space-y-3 overflow-y-auto">
        <div v-for="t in shipTargets" :key="t.id" class="space-y-1.5 rounded-xl border border-line p-3">
          <p class="font-mono text-xs font-bold text-ink">{{ t.sub_order_no }}</p>
          <div class="grid grid-cols-2 gap-2">
            <select v-model="shipLines[t.id].carrier" aria-label="택배사" class="h-9 rounded-lg border border-line bg-surface px-2 text-xs text-ink">
              <option value="" disabled>택배사 선택</option>
              <option v-for="c in carriers" :key="c" :value="c">{{ c }}</option>
            </select>
            <input v-model="shipLines[t.id].tracking" placeholder="송장번호 (영숫자·- 6~40자)" aria-label="송장번호" class="h-9 rounded-lg border border-line bg-surface px-3 font-mono text-xs text-ink" />
          </div>
        </div>
      </div>
      <template #footer>
        <button type="button" class="h-10 rounded-lg border border-line px-4 text-sm font-bold text-ink hover:bg-surface-2" @click="shipOpen = false">취소</button>
        <button type="button" :disabled="shipBusy" class="h-10 rounded-lg bg-primary px-4 text-sm font-bold text-primary-on hover:bg-primary-hover disabled:opacity-50" @click="submitShip">
          {{ shipBusy ? '처리 중…' : `${shipTargets.length}건 발송 확인` }}
        </button>
      </template>
    </OmModal>

    <OmModal v-model:open="delayOpen" title="출고 지연 통보">
      <p class="mb-3 font-mono text-xs text-ink-muted">{{ delayTarget?.sub_order_no }}</p>
      <div class="space-y-3 text-xs">
        <label class="block space-y-1">새 출고기한<input v-model="delayDate" type="date" class="h-10 w-full rounded-lg border border-line bg-surface px-3 text-ink" /></label>
        <label class="block space-y-1">지연 사유 ({{ delayReason.length }}/500)<textarea v-model="delayReason" rows="3" maxlength="500" placeholder="구매자에게 전달됩니다" class="w-full rounded-lg border border-line bg-surface p-3 text-ink" /></label>
      </div>
      <template #footer>
        <button type="button" class="h-10 rounded-lg border border-line px-4 text-sm font-bold text-ink hover:bg-surface-2" @click="delayOpen = false">취소</button>
        <button type="button" :disabled="delayBusy" class="h-10 rounded-lg bg-primary px-4 text-sm font-bold text-primary-on hover:bg-primary-hover disabled:opacity-50" @click="submitDelay">
          {{ delayBusy ? '접수 중…' : '지연 통보' }}
        </button>
      </template>
    </OmModal>

    <OmModal v-model:open="revealOpen" title="연락처 열람">
      <div class="space-y-3 text-xs">
        <p class="text-ink-muted">열람 사유를 입력하면 전체 연락처를 보여줍니다. 열람 기록은 감사 로그에 남습니다.</p>
        <input v-model="revealReason" placeholder="예: 송장 출력" aria-label="열람 사유" class="h-10 w-full rounded-lg border border-line bg-surface px-3 text-ink" @keyup.enter="submitReveal" />
        <button type="button" :disabled="revealBusy" class="h-10 w-full rounded-lg bg-secondary text-xs font-bold text-secondary-on hover:bg-secondary-hover disabled:opacity-50" @click="submitReveal">
          {{ revealBusy ? '열람 중…' : '연락처 보기' }}
        </button>
        <div v-if="revealResult" class="space-y-1 rounded-xl border border-line bg-surface-2 p-3 font-mono">
          <p class="text-ink">{{ revealResult.recipient_name }} {{ revealResult.recipient_phone }}</p>
          <p class="text-ink-muted">[{{ revealResult.shipping_postal_code }}] {{ revealResult.shipping_address_line1 }} {{ revealResult.shipping_address_line2 || '' }}</p>
        </div>
      </div>
    </OmModal>
  </div>
</template>
