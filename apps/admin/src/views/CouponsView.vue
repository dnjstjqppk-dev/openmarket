<script setup lang="ts">
// Coupon console (4-19): platform coupon issuance with burden split and
// scopes, seller-coupon oversight and per-coupon performance.
import { ref, onMounted } from 'vue'
import { adminApi } from '../config'
import { userErrorMessage, useConfirm, useToast, OmDataTable, OmStatusTabs, OmModal, OmSkeleton } from '@olmoa/ui'

const { confirm: askConfirm } = useConfirm()
const toastApi = useToast()
const U = '문제가 발생했습니다. 잠시 후 다시 시도해주세요.'
const PERCENT_DEFAULT_CAP = 50000
const SCOPE_LABEL: Record<string, string> = { ALL: '전체', SELLER: '스토어', PRODUCT: '지정 상품', CATEGORY: '지정 카테고리' }
const METHOD_LABEL: Record<string, string> = { DOWNLOAD: '다운로드', CODE: '코드 입력', AUTO: '자동 발급' }

const tab = ref<'PLATFORM' | 'SELLER'>('PLATFORM')
const rows = ref<any[]>([])
const loading = ref(true)
const loadError = ref('')
const formOpen = ref(false)
const saving = ref(false)
const formError = ref('')
const form = ref({
  code: '', title: '', discount_type: 'FIXED_AMOUNT', discount_value: null as number | null,
  min_order_amount: 0, max_discount_amount: null as number | null,
  scope: 'ALL', platform_share_bps: 10000, seller_ids: '', target_ids: '',
  issue_method: 'DOWNLOAD', total_quantity: null as number | null, per_user_limit: 1,
  starts_at: '', expires_at: ''
})

const columns = [
  { key: 'coupon', label: '쿠폰', primary: true },
  { key: 'discount', label: '할인' },
  { key: 'scope', label: '범위', mobileHidden: true },
  { key: 'issued', label: '발급/사용', align: 'right' as const },
  { key: 'total', label: '할인 합계', align: 'right' as const },
  { key: 'status', label: '상태' }
]
const won = (v: any) => `${(Number(v) || 0).toLocaleString('ko-KR')}원`
const discountText = (c: any) => (c.discount_type === 'PERCENT'
  ? `${c.discount_value}%${c.max_discount_amount ? ` (최대 ${won(c.max_discount_amount)})` : ''}`
  : won(c.discount_value))
const discountTotal = (c: any) => c.issuer === 'SELLER' ? Number(c.store_discount_total || 0) : Number(c.platform_discount_total || 0)

function onDiscountTypeChange() {
  formError.value = ''
  if (form.value.discount_type === 'PERCENT' && form.value.max_discount_amount === null) {
    form.value.max_discount_amount = PERCENT_DEFAULT_CAP
  }
}

async function loadCoupons() {
  loading.value = true
  loadError.value = ''
  try {
    const r = await adminApi('/api/v1/admin/coupons')
    if (!r.ok) throw new Error(r.data.error || '쿠폰 목록을 불러오지 못했습니다.')
    rows.value = Array.isArray(r.data.data) ? r.data.data : []
  } catch (e: any) {
    loadError.value = userErrorMessage(e, U)
  } finally {
    loading.value = false
  }
}
const shown = () => rows.value.filter((c) => (c.issuer || 'PLATFORM') === tab.value)

async function createCoupon() {
  formError.value = ''
  if (!form.value.code.trim() || !form.value.title.trim()) { formError.value = '쿠폰 코드와 제목은 필수입니다.'; return }
  if (form.value.discount_value === null || form.value.discount_value <= 0) { formError.value = '할인 값을 입력해 주세요.'; return }
  if (form.value.discount_type === 'PERCENT') {
    if (form.value.max_discount_amount === null || Number(form.value.max_discount_amount) <= 0) {
      form.value.max_discount_amount = PERCENT_DEFAULT_CAP
    }
    if (!(Number(form.value.max_discount_amount) > 0)) {
      formError.value = '정률(%) 쿠폰은 최대 할인금액(상한) 입력이 필수입니다.'
      return
    }
  }
  saving.value = true
  try {
    const f = form.value
    const body: any = {
      code: f.code.trim(), title: f.title.trim(), discount_type: f.discount_type, discount_value: f.discount_value,
      min_order_amount: f.min_order_amount || 0, scope: f.scope, platform_share_bps: f.platform_share_bps,
      issue_method: f.issue_method, per_user_limit: f.per_user_limit
    }
    if (f.max_discount_amount !== null) body.max_discount_amount = f.max_discount_amount
    if (f.total_quantity !== null) body.total_quantity = f.total_quantity
    if (f.starts_at) body.starts_at = f.starts_at
    if (f.expires_at) body.expires_at = f.expires_at
    if (f.seller_ids.trim()) body.seller_ids = f.seller_ids.split(',').map((s) => s.trim()).filter(Boolean)
    if (f.target_ids.trim()) body.target_ids = f.target_ids.split(',').map((s) => s.trim()).filter(Boolean)
    const r = await adminApi('/api/v1/admin/coupons', { method: 'POST', json: body })
    if (!r.ok) throw new Error(r.data.error || '쿠폰 생성에 실패했습니다.')
    toastApi.success('플랫폼 쿠폰이 생성되었습니다.')
    formOpen.value = false
    form.value = {
      code: '', title: '', discount_type: 'FIXED_AMOUNT', discount_value: null, min_order_amount: 0,
      max_discount_amount: null, scope: 'ALL', platform_share_bps: 10000, seller_ids: '', target_ids: '',
      issue_method: 'DOWNLOAD', total_quantity: null, per_user_limit: 1, starts_at: '', expires_at: ''
    }
  } catch (e: any) {
    formError.value = userErrorMessage(e, '쿠폰 생성 중 네트워크 오류가 발생했습니다.')
  } finally {
    saving.value = false
  }
  void loadCoupons()
}

async function suspend(row: any) {
  if (!(await askConfirm({ title: '쿠폰 중지', body: `“${row.title}” 발급을 중지합니다. 이미 받은 쿠폰에는 영향이 없습니다.`, danger: true }))) return
  try {
    const r = await adminApi(`/api/v1/admin/coupons/${row.id}/suspend`, { method: 'PUT' })
    if (!r.ok) throw new Error(r.data.error || '중지에 실패했습니다.')
    toastApi.success('쿠폰 발급이 중지되었습니다.')
  } catch (e: any) {
    toastApi.error(userErrorMessage(e, '중지에 실패했습니다.'))
  }
  void loadCoupons()
}

async function deleteCoupon(id: string) {
  if (!(await askConfirm({ title: '쿠폰 삭제', body: '쿠폰을 삭제하시겠습니까?', danger: true }))) return
  try {
    const r = await adminApi(`/api/v1/admin/coupons/${id}`, { method: 'DELETE' })
    if (!r.ok) throw new Error(r.data.error || '삭제에 실패했습니다.')
    toastApi.success('쿠폰이 삭제되었습니다.')
  } catch (e: any) {
    toastApi.error(userErrorMessage(e, '삭제에 실패했습니다.'))
  }
  void loadCoupons()
}

function setTab(v: string) { tab.value = v as 'PLATFORM' | 'SELLER' }

onMounted(() => void loadCoupons())
</script>

<template>
  <div class="space-y-4">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 class="text-xl font-bold text-ink">쿠폰 관리</h1>
        <p class="mt-1 text-xs text-ink-muted">주문당 플랫폼 1장·스토어 1장까지 중복 사용할 수 있습니다.</p>
      </div>
      <button type="button" class="rounded-xl bg-primary px-4 py-2 text-xs font-bold text-primary-on hover:bg-primary-hover" @click="formOpen = true">플랫폼 쿠폰 생성</button>
    </div>

    <OmStatusTabs
      v-model="tab"
      :tabs="[{ value: 'PLATFORM', label: '플랫폼 쿠폰' }, { value: 'SELLER', label: '셀러 쿠폰 감독' }]"
      @update:model-value="setTab"
    />

    <div v-if="loading && !rows.length" class="rounded-2xl border border-line bg-surface p-6">
      <p class="mb-3 text-xs text-ink-muted">불러오는 중입니다…</p>
      <OmSkeleton variant="row" :count="8" />
    </div>
    <div v-else-if="loadError" class="rounded-2xl border border-danger bg-danger-soft p-6 text-center text-xs text-danger" role="alert">
      <p class="font-bold">{{ U }}</p>
      <p class="mt-1">{{ loadError }}</p>
      <button type="button" class="mx-auto mt-2 block rounded-full bg-secondary px-4 py-1.5 font-bold text-secondary-on hover:bg-secondary-hover" @click="loadCoupons">다시 불러오기</button>
    </div>
    <div v-else>
      <OmDataTable
        :columns="columns"
        :rows="shown()"
        row-key="id"
        empty-title="등록된 쿠폰이 없습니다"
        empty-description="쿠폰을 생성하면 이곳에 표시됩니다."
      >
        <template #cell-coupon="{ row }">
          <div class="min-w-0">
            <p class="truncate font-bold text-ink">{{ row.title }}</p>
            <p class="font-mono text-2xs text-ink-subtle">{{ row.code }}{{ row.issuer === 'SELLER' ? ` · ${row.seller_id}` : '' }}</p>
          </div>
        </template>
        <template #cell-discount="{ row }"><span class="font-bold text-danger">{{ discountText(row) }}</span></template>
        <template #cell-scope="{ row }"><span class="text-ink-muted">{{ SCOPE_LABEL[row.scope] || row.scope }}{{ row.issuer === 'PLATFORM' ? ` · 플랫폼 ${Math.round(Number(row.platform_share_bps ?? 10000) / 100)}%` : '' }}</span></template>
        <template #cell-issued="{ row }"><span class="om-num text-ink">{{ row.issued_count ?? 0 }} / {{ row.used_count ?? 0 }}</span></template>
        <template #cell-total="{ row }">
          <span class="om-num text-ink">{{ won(discountTotal(row)) }}</span>
          <span v-if="row.issuer === 'PLATFORM' && Number(row.platform_seller_share) > 0" class="om-num block text-2xs text-ink-subtle">판매자 {{ won(row.platform_seller_share) }}</span>
        </template>
        <template #cell-status="{ row }">
          <span class="rounded-full px-2 py-0.5 text-2xs font-bold whitespace-nowrap" :class="Number(row.is_active) === 1 ? 'bg-success-soft text-success' : 'bg-surface-3 text-ink-muted'">{{ Number(row.is_active) === 1 ? '발급중' : '중지됨' }}</span>
        </template>
        <template #actions="{ row }">
          <div class="flex gap-1">
            <button v-if="Number(row.is_active) === 1" type="button" class="rounded-lg border border-line px-2.5 py-1.5 text-xs font-bold text-ink hover:bg-surface-2" @click="suspend(row)">중지</button>
            <button type="button" class="rounded-lg border border-line px-2.5 py-1.5 text-xs font-bold text-ink-muted hover:bg-surface-2" @click="deleteCoupon(row.id)">삭제</button>
          </div>
        </template>
      </OmDataTable>
      <OmEmptyState v-if="!loading && !shown().length" title="등록된 쿠폰이 없습니다" description="쿠폰을 생성하면 이곳에 표시됩니다." compact />
    </div>

    <OmModal v-model:open="formOpen" title="플랫폼 쿠폰 생성" size="lg">
      <div class="grid grid-cols-1 gap-3 text-xs sm:grid-cols-2">
        <label class="space-y-1">쿠폰 코드 *<input v-model="form.code" maxlength="40" placeholder="예: WELCOME10" class="h-10 w-full rounded-lg border border-line bg-surface px-3 font-mono text-ink" /></label>
        <label class="space-y-1">쿠폰명 *<input v-model="form.title" maxlength="200" class="h-10 w-full rounded-lg border border-line bg-surface px-3 text-ink" /></label>
        <label class="space-y-1">할인 방식<select v-model="form.discount_type" class="h-10 w-full rounded-lg border border-line bg-surface px-2 text-ink" @change="onDiscountTypeChange">
          <option value="FIXED_AMOUNT">정액</option>
          <option value="PERCENT">정률(%)</option>
        </select></label>
        <label class="space-y-1">할인 값 *<input v-model.number="form.discount_value" type="number" min="1" class="h-10 w-full rounded-lg border border-line bg-surface px-3 text-ink" /></label>
        <label class="space-y-1">적용 범위<select v-model="form.scope" class="h-10 w-full rounded-lg border border-line bg-surface px-2 text-ink">
          <option value="ALL">전체</option>
          <option value="SELLER">지정 판매자</option>
          <option value="PRODUCT">지정 상품</option>
          <option value="CATEGORY">지정 카테고리</option>
        </select></label>
        <label class="space-y-1">플랫폼 분담 (bps, 10000=전액)<input v-model.number="form.platform_share_bps" type="number" min="0" max="10000" class="h-10 w-full rounded-lg border border-line bg-surface px-3 text-ink" /></label>
        <label v-if="form.scope === 'SELLER'" class="space-y-1 sm:col-span-2">대상 판매자 ID (쉼표 구분)<input v-model="form.seller_ids" placeholder="pt_001, pt_002" class="h-10 w-full rounded-lg border border-line bg-surface px-3 font-mono text-ink" /></label>
        <label v-if="form.scope === 'PRODUCT' || form.scope === 'CATEGORY'" class="space-y-1 sm:col-span-2">대상 ID (쉼표 구분) *<input v-model="form.target_ids" placeholder="상품 ID 또는 카테고리 ID" class="h-10 w-full rounded-lg border border-line bg-surface px-3 font-mono text-ink" /></label>
        <label class="space-y-1">발급 방식<select v-model="form.issue_method" class="h-10 w-full rounded-lg border border-line bg-surface px-2 text-ink">
          <option value="DOWNLOAD">다운로드</option>
          <option value="CODE">코드 입력</option>
          <option value="AUTO">자동 발급</option>
        </select></label>
        <label class="space-y-1">최소 주문금액<input v-model.number="form.min_order_amount" type="number" min="0" class="h-10 w-full rounded-lg border border-line bg-surface px-3 text-ink" /></label>
        <label class="space-y-1">최대 할인액{{ form.discount_type === 'PERCENT' ? ' — 정률 필수' : ' (선택)' }}<input v-model.number="form.max_discount_amount" type="number" min="0" step="1000" :placeholder="form.discount_type === 'PERCENT' ? '50000' : '상한 없음'" class="h-10 w-full rounded-lg border border-line bg-surface px-3 text-ink" /></label>
        <label class="space-y-1">총 발급 수량<input v-model.number="form.total_quantity" type="number" min="1" class="h-10 w-full rounded-lg border border-line bg-surface px-3 text-ink" /></label>
        <label class="space-y-1">인당 한도<input v-model.number="form.per_user_limit" type="number" min="1" class="h-10 w-full rounded-lg border border-line bg-surface px-3 text-ink" /></label>
        <label class="space-y-1">시작일<input v-model="form.starts_at" type="date" class="h-10 w-full rounded-lg border border-line bg-surface px-2 text-ink" /></label>
        <label class="space-y-1">만료일<input v-model="form.expires_at" type="date" class="h-10 w-full rounded-lg border border-line bg-surface px-2 text-ink" /></label>
      </div>
      <p v-if="formError" role="alert" class="mt-3 text-xs font-bold text-danger">{{ formError }}</p>
      <template #footer>
        <button type="button" class="h-10 rounded-lg border border-line px-4 text-sm font-bold text-ink hover:bg-surface-2" @click="formOpen = false">취소</button>
        <button type="button" :disabled="saving" class="h-10 rounded-lg bg-primary px-4 text-sm font-bold text-primary-on hover:bg-primary-hover disabled:opacity-50" @click="createCoupon">{{ saving ? '생성 중…' : '생성' }}</button>
      </template>
    </OmModal>
  </div>
</template>
