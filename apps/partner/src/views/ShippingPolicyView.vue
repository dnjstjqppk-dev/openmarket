<script setup lang="ts">
// Seller shipping/return templates (4-9): every 2-2 field, one default per
// seller (server-enforced), in-use templates refuse deletion (server 409).
import { ref, onMounted } from 'vue'
import { API_BASE_URL, getPartnerHeaders } from '../config'
import { userErrorMessage, useConfirm, useToast, OmDataTable, OmModal, OmSkeleton } from '@olmoa/ui'

const { confirm: askConfirm } = useConfirm()
const toastApi = useToast()
const U = '문제가 발생했습니다. 잠시 후 다시 시도해주세요.'

const METHOD_LABEL: Record<string, string> = { PARCEL: '택배', DIRECT: '직접배송', OVERSEAS: '해외배송' }
const FEE_LABEL: Record<string, string> = { FREE: '무료', PAID: '유료', CONDITIONAL: '조건부 무료', PER_QTY: '수량별' }

const rows = ref<any[]>([])
const carriers = ref<any[]>([])
const loading = ref(true)
const loadError = ref('')
const formOpen = ref(false)
const editing = ref<any>(null)
const saving = ref(false)
const formError = ref('')
const emptyForm = () => ({
  name: '', method: 'PARCEL', carrier_code: '', fee_type: 'PAID', base_fee: 3000,
  free_threshold: null as number | null, qty_unit: null as number | null,
  remote_surcharge: null as number | null, return_fee: 3000, exchange_fee: 6000,
  processing_days: 1, today_cutoff: '', origin_address: '', return_address: '',
  is_default: false, status: 'ACTIVE'
})
const form = ref(emptyForm())

const won = (v: any) => `${(Number(v) || 0).toLocaleString('ko-KR')}원`
const columns = [
  { key: 'tpl', label: '템플릿', primary: true },
  { key: 'method', label: '방식', mobileHidden: true },
  { key: 'fee', label: '배송비' },
  { key: 'dispatch', label: '출고', mobileHidden: true },
  { key: 'status', label: '상태' }
]
const feeText = (r: any) => {
  if (r.fee_type === 'FREE') return '무료배송'
  if (r.fee_type === 'CONDITIONAL') return `${won(r.free_threshold)} 이상 무료`
  if (r.fee_type === 'PER_QTY') return `${won(r.base_fee)} / ${r.qty_unit ?? '-'}개당`
  return won(r.base_fee)
}
const dispatchText = (r: any) => {
  const d = `출고 ${r.processing_days ?? 0}일`
  return r.today_cutoff ? `${d} · 오늘출발 ${r.today_cutoff} 마감` : d
}

async function load() {
  loading.value = true
  loadError.value = ''
  try {
    const res = await fetch(`${API_BASE_URL}/api/v1/partner/shipping-policies`, { headers: getPartnerHeaders() })
    const json = await res.json().catch(() => null)
    if (!res.ok || !json?.success) throw new Error(json?.error || '배송 템플릿을 불러오지 못했습니다.')
    rows.value = Array.isArray(json.data) ? json.data : []
  } catch (e: any) {
    loadError.value = userErrorMessage(e, U)
  } finally {
    loading.value = false
  }
}

async function loadCarriers() {
  try {
    const res = await fetch(`${API_BASE_URL}/api/v1/logistics/carriers`)
    const json = await res.json().catch(() => null)
    if (res.ok && Array.isArray(json?.data)) carriers.value = json.data
  } catch { /* falls back to free text */ }
}

function openCreate() {
  editing.value = null
  form.value = emptyForm()
  formError.value = ''
  formOpen.value = true
}

function openEdit(row: any) {
  editing.value = row
  form.value = {
    name: row.name || '', method: row.method || 'PARCEL', carrier_code: row.carrier_code || '',
    fee_type: row.fee_type || 'PAID', base_fee: row.base_fee ?? 0,
    free_threshold: row.free_threshold ?? null, qty_unit: row.qty_unit ?? null,
    remote_surcharge: row.remote_surcharge ?? null, return_fee: row.return_fee ?? 0,
    exchange_fee: row.exchange_fee ?? 0, processing_days: row.processing_days ?? 0,
    today_cutoff: row.today_cutoff || '', origin_address: row.origin_address || '',
    return_address: row.return_address || '', is_default: Number(row.is_default) === 1,
    status: row.status || 'ACTIVE'
  }
  formError.value = ''
  formOpen.value = true
}

async function submit() {
  formError.value = ''
  if (!form.value.name.trim()) { formError.value = '템플릿명을 입력해 주세요.'; return }
  if (form.value.today_cutoff && !/^\d{2}:\d{2}$/.test(form.value.today_cutoff)) { formError.value = '오늘출발 마감시각은 HH:MM 형식으로 입력해 주세요.'; return }
  saving.value = true
  try {
    const f = form.value
    const body: any = {
      name: f.name.trim(), method: f.method, fee_type: f.fee_type, base_fee: f.base_fee || 0,
      return_fee: f.return_fee || 0, exchange_fee: f.exchange_fee || 0,
      processing_days: f.processing_days || 0, is_default: f.is_default, status: f.status
    }
    if (f.carrier_code) body.carrier_code = f.carrier_code
    if (f.free_threshold !== null) body.free_threshold = f.free_threshold
    if (f.qty_unit !== null) body.qty_unit = f.qty_unit
    if (f.remote_surcharge !== null) body.remote_surcharge = f.remote_surcharge
    if (f.today_cutoff) body.today_cutoff = f.today_cutoff
    if (f.origin_address.trim()) body.origin_address = f.origin_address.trim()
    if (f.return_address.trim()) body.return_address = f.return_address.trim()
    const url = editing.value
      ? `${API_BASE_URL}/api/v1/partner/shipping-policies/${editing.value.id}`
      : `${API_BASE_URL}/api/v1/partner/shipping-policies`
    const res = await fetch(url, { method: editing.value ? 'PUT' : 'POST', headers: getPartnerHeaders(), body: JSON.stringify(body) })
    const json = await res.json().catch(() => ({}))
    if (!res.ok || !json.success) throw new Error(json.error || '저장에 실패했습니다.')
    toastApi.success(editing.value ? '템플릿이 수정되었습니다.' : '템플릿이 등록되었습니다.')
    formOpen.value = false
  } catch (e: any) {
    formError.value = userErrorMessage(e, '저장에 실패했습니다.')
  } finally {
    saving.value = false
  }
  void load()
}

async function remove(row: any) {
  if (!(await askConfirm({ title: '템플릿 삭제', body: `“${row.name}” 템플릿을 삭제합니다. 상품에 연결된 템플릿은 삭제할 수 없습니다.`, danger: true }))) return
  const res = await fetch(`${API_BASE_URL}/api/v1/partner/shipping-policies/${row.id}`, { method: 'DELETE', headers: getPartnerHeaders() })
  const json = await res.json().catch(() => ({}))
  if (!res.ok || !json.success) { toastApi.error(json.error || '삭제에 실패했습니다.'); return }
  toastApi.success('템플릿이 삭제되었습니다.')
  void load()
}

onMounted(() => { void load(); void loadCarriers() })
</script>

<template>
  <div class="space-y-4">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 class="text-xl font-bold text-ink">배송·반품 템플릿</h1>
        <p class="mt-1 text-xs text-ink-muted">상품 등록 시 템플릿을 지정하면 배송비가 자동 계산됩니다. 기본 템플릿은 1개만 지정됩니다.</p>
      </div>
      <button type="button" class="rounded-xl bg-primary px-4 py-2 text-xs font-bold text-primary-on hover:bg-primary-hover" @click="openCreate">템플릿 등록</button>
    </div>

    <div v-if="loading && !rows.length" class="rounded-2xl border border-line bg-surface p-6">
      <p class="mb-3 text-xs text-ink-muted">불러오는 중입니다…</p>
      <OmSkeleton variant="row" :count="6" />
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
        empty-title="등록된 템플릿이 없습니다"
        empty-description="템플릿을 등록하면 이곳에 표시됩니다."
      >
        <template #cell-tpl="{ row }">
          <div class="flex min-w-0 items-center gap-2">
            <p class="truncate font-bold text-ink">{{ row.name }}</p>
            <span v-if="Number(row.is_default) === 1" class="shrink-0 rounded-full bg-primary-soft px-2 py-0.5 text-2xs font-bold text-primary-soft-ink">기본</span>
          </div>
        </template>
        <template #cell-method="{ row }"><span class="text-ink-muted">{{ METHOD_LABEL[row.method] || row.method }}</span></template>
        <template #cell-fee="{ row }"><span class="om-num font-bold text-ink">{{ feeText(row) }}</span></template>
        <template #cell-dispatch="{ row }"><span class="om-num text-ink-muted">{{ dispatchText(row) }}</span></template>
        <template #cell-status="{ row }">
          <span class="rounded-full px-2 py-0.5 text-2xs font-bold" :class="row.status === 'ACTIVE' ? 'bg-success-soft text-success' : 'bg-surface-3 text-ink-muted'">{{ row.status === 'ACTIVE' ? '사용중' : '중지됨' }}</span>
        </template>
        <template #actions="{ row }">
          <div class="flex gap-1.5">
            <button type="button" class="rounded-lg border border-line px-2.5 py-1.5 text-xs font-bold text-ink hover:bg-surface-2" @click="openEdit(row)">수정</button>
            <button type="button" class="rounded-lg border border-line px-2.5 py-1.5 text-xs font-bold text-danger hover:bg-danger-soft" @click="remove(row)">삭제</button>
          </div>
        </template>
      </OmDataTable>
      <OmEmptyState v-if="!loading && !rows.length" title="등록된 템플릿이 없습니다" description="템플릿을 등록하면 이곳에 표시됩니다." compact />
    </div>

    <OmModal v-model:open="formOpen" :title="editing ? '템플릿 수정' : '템플릿 등록'" size="lg">
      <div class="grid grid-cols-1 gap-3 text-xs sm:grid-cols-2">
        <label class="space-y-1 sm:col-span-2">템플릿명 *<input v-model="form.name" maxlength="100" placeholder="예: 기본 택배" class="h-10 w-full rounded-lg border border-line bg-surface px-3 text-ink" /></label>
        <label class="space-y-1">배송 방식<select v-model="form.method" class="h-10 w-full rounded-lg border border-line bg-surface px-2 text-ink">
          <option value="PARCEL">택배</option>
          <option value="DIRECT">직접배송</option>
          <option value="OVERSEAS">해외배송</option>
        </select></label>
        <label class="space-y-1">택배사
          <select v-if="carriers.length" v-model="form.carrier_code" class="h-10 w-full rounded-lg border border-line bg-surface px-2 text-ink">
            <option value="">선택 안 함</option>
            <option v-for="c in carriers" :key="c.code" :value="c.code">{{ c.name }}</option>
          </select>
          <input v-else v-model="form.carrier_code" maxlength="40" placeholder="택배사 코드" class="h-10 w-full rounded-lg border border-line bg-surface px-3 font-mono text-ink" />
        </label>
        <label class="space-y-1">배송비 유형<select v-model="form.fee_type" class="h-10 w-full rounded-lg border border-line bg-surface px-2 text-ink">
          <option value="FREE">무료</option>
          <option value="PAID">유료</option>
          <option value="CONDITIONAL">조건부 무료</option>
          <option value="PER_QTY">수량별</option>
        </select></label>
        <label class="space-y-1">기본 배송비<input v-model.number="form.base_fee" type="number" min="0" class="h-10 w-full rounded-lg border border-line bg-surface px-3 text-ink" /></label>
        <label v-if="form.fee_type === 'CONDITIONAL'" class="space-y-1">무료 기준금액<input v-model.number="form.free_threshold" type="number" min="0" class="h-10 w-full rounded-lg border border-line bg-surface px-3 text-ink" /></label>
        <label v-if="form.fee_type === 'PER_QTY'" class="space-y-1">수량 단위<input v-model.number="form.qty_unit" type="number" min="1" class="h-10 w-full rounded-lg border border-line bg-surface px-3 text-ink" /></label>
        <label class="space-y-1">제주·도서산간 추가비<input v-model.number="form.remote_surcharge" type="number" min="0" placeholder="비우면 플랫폼 기본" class="h-10 w-full rounded-lg border border-line bg-surface px-3 text-ink" /></label>
        <label class="space-y-1">반품 편도비<input v-model.number="form.return_fee" type="number" min="0" class="h-10 w-full rounded-lg border border-line bg-surface px-3 text-ink" /></label>
        <label class="space-y-1">교환 왕복비<input v-model.number="form.exchange_fee" type="number" min="0" class="h-10 w-full rounded-lg border border-line bg-surface px-3 text-ink" /></label>
        <label class="space-y-1">출고 소요일 (0~14)<input v-model.number="form.processing_days" type="number" min="0" max="14" class="h-10 w-full rounded-lg border border-line bg-surface px-3 text-ink" /></label>
        <label class="space-y-1">오늘출발 마감시각<input v-model="form.today_cutoff" type="time" class="h-10 w-full rounded-lg border border-line bg-surface px-2 text-ink" /></label>
        <label class="space-y-1 sm:col-span-2">출고지<input v-model="form.origin_address" maxlength="300" class="h-10 w-full rounded-lg border border-line bg-surface px-3 text-ink" /></label>
        <label class="space-y-1 sm:col-span-2">반품지<input v-model="form.return_address" maxlength="300" class="h-10 w-full rounded-lg border border-line bg-surface px-3 text-ink" /></label>
        <label class="flex items-center gap-2 text-ink"><input v-model="form.is_default" type="checkbox" class="accent-primary" /> 기본 템플릿으로 지정</label>
        <label class="space-y-1">상태<select v-model="form.status" class="h-10 w-full rounded-lg border border-line bg-surface px-2 text-ink">
          <option value="ACTIVE">사용중</option>
          <option value="INACTIVE">중지됨</option>
        </select></label>
      </div>
      <p v-if="formError" role="alert" class="mt-3 text-xs font-bold text-danger">{{ formError }}</p>
      <template #footer>
        <button type="button" class="h-10 rounded-lg border border-line px-4 text-sm font-bold text-ink hover:bg-surface-2" @click="formOpen = false">취소</button>
        <button type="button" :disabled="saving" class="h-10 rounded-lg bg-primary px-4 text-sm font-bold text-primary-on hover:bg-primary-hover disabled:opacity-50" @click="submit">{{ saving ? '저장 중…' : '저장' }}</button>
      </template>
    </OmModal>
  </div>
</template>
