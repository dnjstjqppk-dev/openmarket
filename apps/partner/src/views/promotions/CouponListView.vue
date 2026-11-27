<script setup lang="ts">
// Seller store coupons (4-7): list with issue/use counts, registration and
// suspend. Money and scope freeze once issuance starts (server rule).
import { ref, onMounted } from 'vue'
import { API_BASE_URL, getPartnerHeaders } from '../../config'
import { userErrorMessage, useConfirm, useToast, OmDataTable, OmModal, OmSkeleton } from '@olmoa/ui'

const { confirm: askConfirm } = useConfirm()
const toastApi = useToast()
const U = '문제가 발생했습니다. 잠시 후 다시 시도해주세요.'

const rows = ref<any[]>([])
const loading = ref(true)
const loadError = ref('')
const formOpen = ref(false)
const saving = ref(false)
const formError = ref('')
const form = ref({ code: '', title: '', discount_type: 'FIXED_AMOUNT', discount_value: null as number | null, scope: 'SELLER', target_ids: '', issue_method: 'DOWNLOAD', min_order_amount: 0, max_discount_amount: null as number | null, starts_at: '', expires_at: '', total_quantity: null as number | null, per_user_limit: 1 })

const won = (v: any) => `${(Number(v) || 0).toLocaleString('ko-KR')}원`
const columns = [
  { key: 'coupon', label: '쿠폰', primary: true },
  { key: 'discount', label: '할인' },
  { key: 'scope', label: '범위', mobileHidden: true },
  { key: 'issued', label: '발급/사용', align: 'right' as const },
  { key: 'burden', label: '할인 합계', align: 'right' as const },
  { key: 'period', label: '기간', mobileHidden: true },
  { key: 'status', label: '상태' }
]
const discountText = (c: any) => (c.discount_type === 'PERCENT' ? `${c.discount_value}%${c.max_discount_amount ? ` (최대 ${won(c.max_discount_amount)})` : ''}` : won(c.discount_value))

async function load() {
  loading.value = true
  loadError.value = ''
  try {
    const res = await fetch(`${API_BASE_URL}/api/v1/partner/coupons`, { headers: getPartnerHeaders() })
    const json = await res.json().catch(() => null)
    if (!res.ok || !json?.success) throw new Error(json?.error || '쿠폰 목록을 불러오지 못했습니다.')
    rows.value = Array.isArray(json.data) ? json.data : []
  } catch (e: any) {
    loadError.value = userErrorMessage(e, U)
  } finally {
    loading.value = false
  }
}

async function submit() {
  formError.value = ''
  if (!form.value.code.trim() || !form.value.title.trim()) { formError.value = '코드와 쿠폰명을 입력해 주세요.'; return }
  if (form.value.discount_value === null || form.value.discount_value <= 0) { formError.value = '할인 값을 입력해 주세요.'; return }
  saving.value = true
  try {
    const body: any = {
      code: form.value.code.trim(), title: form.value.title.trim(), discount_type: form.value.discount_type,
      discount_value: form.value.discount_value, scope: form.value.scope, issue_method: form.value.issue_method,
      min_order_amount: form.value.min_order_amount || 0
    }
    if (form.value.target_ids.trim()) body.target_ids = form.value.target_ids.split(',').map((s) => s.trim()).filter(Boolean)
    if (form.value.max_discount_amount !== null) body.max_discount_amount = form.value.max_discount_amount
    if (form.value.starts_at) body.starts_at = form.value.starts_at
    if (form.value.expires_at) body.expires_at = form.value.expires_at
    if (form.value.total_quantity !== null) body.total_quantity = form.value.total_quantity
    if (form.value.per_user_limit !== null) body.per_user_limit = form.value.per_user_limit
    const res = await fetch(`${API_BASE_URL}/api/v1/partner/coupons`, { method: 'POST', headers: getPartnerHeaders(), body: JSON.stringify(body) })
    const json = await res.json().catch(() => ({}))
    if (!res.ok || !json.success) throw new Error(json.error || '쿠폰 등록에 실패했습니다.')
    toastApi.success('쿠폰이 등록되었습니다.')
    formOpen.value = false
  } catch (e: any) {
    formError.value = userErrorMessage(e, '쿠폰 등록에 실패했습니다.')
  } finally {
    saving.value = false
  }
  void load()
}

async function suspend(row: any) {
  if (!(await askConfirm({ title: '쿠폰 중지', body: `“${row.title}” 발급을 중지합니다. 이미 받은 쿠폰에는 영향이 없습니다.`, danger: true }))) return
  const res = await fetch(`${API_BASE_URL}/api/v1/partner/coupons/${row.id}/suspend`, { method: 'PUT', headers: getPartnerHeaders() })
  const json = await res.json().catch(() => ({}))
  if (!res.ok || !json.success) { toastApi.error(json.error || '중지에 실패했습니다.'); return }
  toastApi.success('쿠폰 발급이 중지되었습니다.')
  void load()
}

onMounted(() => void load())
</script>

<template>
  <div class="space-y-4">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 class="text-xl font-bold text-ink">스토어 쿠폰</h1>
        <p class="mt-1 text-xs text-ink-muted">스토어 쿠폰 할인액은 판매자 100% 부담이며 정산에서 차감됩니다.</p>
      </div>
      <button type="button" class="rounded-xl bg-primary px-4 py-2 text-xs font-bold text-primary-on hover:bg-primary-hover" @click="formOpen = true">쿠폰 등록</button>
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
        empty-title="등록된 쿠폰이 없습니다"
        empty-description="쿠폰을 등록하면 이곳에 표시됩니다."
      >
        <template #cell-coupon="{ row }">
          <div class="min-w-0">
            <p class="truncate font-bold text-ink">{{ row.title }}</p>
            <p class="font-mono text-2xs text-ink-subtle">{{ row.code }}</p>
          </div>
        </template>
        <template #cell-discount="{ row }"><span class="font-bold text-danger">{{ discountText(row) }}</span></template>
        <template #cell-scope="{ row }"><span class="text-ink-muted">{{ row.scope === 'SELLER' ? '스토어 전체' : row.scope === 'PRODUCT' ? '지정 상품' : '지정 카테고리' }}</span></template>
        <template #cell-issued="{ row }"><span class="om-num text-ink">{{ row.issued_count ?? 0 }} / {{ row.used_count ?? 0 }}</span></template>
        <template #cell-burden="{ row }"><span class="om-num text-ink">{{ won(row.discount_total ?? 0) }}</span></template>
        <template #cell-period="{ row }"><span class="om-num text-ink-muted">{{ String(row.starts_at || '').slice(0, 10) || '-' }} ~ {{ String(row.expires_at || '').slice(0, 10) }}</span></template>
        <template #cell-status="{ row }">
          <span class="rounded-full px-2 py-0.5 text-2xs font-bold whitespace-nowrap" :class="Number(row.is_active) === 1 ? 'bg-success-soft text-success' : 'bg-surface-3 text-ink-muted'">{{ Number(row.is_active) === 1 ? '발급중' : '중지됨' }}</span>
        </template>
        <template #actions="{ row }">
          <button v-if="Number(row.is_active) === 1" type="button" class="rounded-lg border border-line px-2.5 py-1.5 text-xs font-bold text-ink hover:bg-surface-2" @click="suspend(row)">중지</button>
        </template>
      </OmDataTable>
      <OmEmptyState v-if="!loading && !rows.length" title="등록된 쿠폰이 없습니다" description="쿠폰을 등록하면 이곳에 표시됩니다." compact />
    </div>

    <OmModal v-model:open="formOpen" title="스토어 쿠폰 등록" size="lg">
      <div class="grid grid-cols-1 gap-3 text-xs sm:grid-cols-2">
        <label class="space-y-1">쿠폰 코드 *<input v-model="form.code" maxlength="40" placeholder="예: STORE5000" class="h-10 w-full rounded-lg border border-line bg-surface px-3 font-mono text-ink" /></label>
        <label class="space-y-1">쿠폰명 *<input v-model="form.title" maxlength="200" class="h-10 w-full rounded-lg border border-line bg-surface px-3 text-ink" /></label>
        <label class="space-y-1">할인 방식<select v-model="form.discount_type" class="h-10 w-full rounded-lg border border-line bg-surface px-2 text-ink">
          <option value="FIXED_AMOUNT">정액</option>
          <option value="PERCENT">정률(%)</option>
        </select></label>
        <label class="space-y-1">할인 값 *<input v-model.number="form.discount_value" type="number" min="1" class="h-10 w-full rounded-lg border border-line bg-surface px-3 text-ink" /></label>
        <label class="space-y-1">적용 범위<select v-model="form.scope" class="h-10 w-full rounded-lg border border-line bg-surface px-2 text-ink">
          <option value="SELLER">스토어 전체</option>
          <option value="PRODUCT">지정 상품</option>
          <option value="CATEGORY">지정 카테고리</option>
        </select></label>
        <label class="space-y-1">발급 방식<select v-model="form.issue_method" class="h-10 w-full rounded-lg border border-line bg-surface px-2 text-ink">
          <option value="DOWNLOAD">다운로드</option>
          <option value="CODE">코드 입력</option>
          <option value="AUTO">자동 발급</option>
        </select></label>
        <label v-if="form.scope !== 'SELLER'" class="space-y-1 sm:col-span-2">대상 ID (쉼표 구분) *<input v-model="form.target_ids" placeholder="상품 ID 또는 카테고리 ID" class="h-10 w-full rounded-lg border border-line bg-surface px-3 font-mono text-ink" /></label>
        <label class="space-y-1">최소 주문금액<input v-model.number="form.min_order_amount" type="number" min="0" class="h-10 w-full rounded-lg border border-line bg-surface px-3 text-ink" /></label>
        <label class="space-y-1">최대 할인액(정률용)<input v-model.number="form.max_discount_amount" type="number" min="0" class="h-10 w-full rounded-lg border border-line bg-surface px-3 text-ink" /></label>
        <label class="space-y-1">시작일<input v-model="form.starts_at" type="date" class="h-10 w-full rounded-lg border border-line bg-surface px-2 text-ink" /></label>
        <label class="space-y-1">만료일<input v-model="form.expires_at" type="date" class="h-10 w-full rounded-lg border border-line bg-surface px-2 text-ink" /></label>
        <label class="space-y-1">총 발급 수량<input v-model.number="form.total_quantity" type="number" min="1" class="h-10 w-full rounded-lg border border-line bg-surface px-3 text-ink" /></label>
        <label class="space-y-1">인당 한도<input v-model.number="form.per_user_limit" type="number" min="1" class="h-10 w-full rounded-lg border border-line bg-surface px-3 text-ink" /></label>
      </div>
      <p v-if="formError" role="alert" class="mt-3 text-xs font-bold text-danger">{{ formError }}</p>
      <p class="mt-2 text-2xs text-ink-muted">발급 시작 후 금액·범위는 바꿀 수 없고 중지만 가능합니다.</p>
      <template #footer>
        <button type="button" class="h-10 rounded-lg border border-line px-4 text-sm font-bold text-ink hover:bg-surface-2" @click="formOpen = false">취소</button>
        <button type="button" :disabled="saving" class="h-10 rounded-lg bg-primary px-4 text-sm font-bold text-primary-on hover:bg-primary-hover disabled:opacity-50" @click="submit">{{ saving ? '등록 중…' : '등록' }}</button>
      </template>
    </OmModal>
  </div>
</template>
