<script setup lang="ts">
// Flash-sale console (4-18): campaign windows, seller-application review,
// direct picks and live sell-through.
import { ref, onMounted } from 'vue'
import { adminApi } from '../../config'
import { userErrorMessage, useConfirm, useToast, OmEmptyState, OmModal, OmSkeleton } from '@olmoa/ui'

const { confirm: askConfirm } = useConfirm()
const toastApi = useToast()
const U = '문제가 발생했습니다. 잠시 후 다시 시도해주세요.'
const STATUS_LABEL: Record<string, string> = { DRAFT: '작성 중', ACTIVE: '진행 중', ENDED: '종료', UPCOMING: '예정' }
const ITEM_LABEL: Record<string, string> = { REQUESTED: '심사중', APPROVED: '편성됨', REJECTED: '반려됨' }

const rows = ref<any[]>([])
const loading = ref(true)
const loadError = ref('')
const formOpen = ref(false)
const saving = ref(false)
const formError = ref('')
const form = ref({ title: '', starts_at: '', ends_at: '', status: 'DRAFT' })
const pickOpen = ref(false)
const pickCamp = ref<any>(null)
const pickSku = ref('')
const pickDeal = ref('')
const pickAlloc = ref('')
const pickBusy = ref(false)
const pickError = ref('')
const rulingId = ref<string | null>(null)

const won = (v: any) => `${(Number(v) || 0).toLocaleString('ko-KR')}원`
const toServerDt = (v: string) => `${v.replace('T', ' ')}:00`.slice(0, 19)
const sellThrough = (it: any) => {
  const alloc = Number(it.allocated_stock) || 0
  if (alloc <= 0) return 0
  return Math.min(100, Math.floor(((Number(it.sold_stock) || 0) * 100) / alloc))
}

async function load() {
  loading.value = true
  loadError.value = ''
  try {
    const r = await adminApi('/api/v1/admin/flash-sales')
    if (!r.ok) throw new Error(r.data.error || '특가 캠페인을 불러오지 못했습니다.')
    rows.value = Array.isArray(r.data.data) ? r.data.data : []
  } catch (e: any) {
    loadError.value = userErrorMessage(e, U)
  } finally {
    loading.value = false
  }
}

async function submitCampaign() {
  formError.value = ''
  if (!form.value.title.trim() || !form.value.starts_at || !form.value.ends_at) {
    formError.value = '캠페인명과 기간을 입력해 주세요.'
    return
  }
  saving.value = true
  try {
    const r = await adminApi('/api/v1/admin/flash-sales', {
      method: 'POST',
      json: { title: form.value.title.trim(), starts_at: toServerDt(form.value.starts_at), ends_at: toServerDt(form.value.ends_at), status: form.value.status }
    })
    if (!r.ok) throw new Error(r.data.error || '등록에 실패했습니다.')
    toastApi.success('특가 캠페인이 등록되었습니다.')
    formOpen.value = false
    form.value = { title: '', starts_at: '', ends_at: '', status: 'DRAFT' }
  } catch (e: any) {
    formError.value = userErrorMessage(e, '등록에 실패했습니다.')
  } finally {
    saving.value = false
  }
  void load()
}

async function decide(campId: string, itemId: string, decision: 'APPROVE' | 'REJECT') {
  const ok = await askConfirm({
    title: decision === 'APPROVE' ? '특가 편성 승인' : '특가 신청 반려',
    body: `셀러 신청 건을 ${decision === 'APPROVE' ? '승인해 특가에 편성' : '반려'}합니다.`,
    danger: decision === 'REJECT'
  })
  if (!ok) return
  rulingId.value = itemId
  try {
    const r = await adminApi(`/api/v1/admin/flash-sales/${campId}/items/${itemId}`, { method: 'PUT', json: { decision } })
    if (!r.ok) throw new Error(r.data.error || '처리에 실패했습니다.')
    toastApi.success(decision === 'APPROVE' ? '특가에 편성되었습니다.' : '신청이 반려되었습니다.')
  } catch (e: any) {
    toastApi.error(userErrorMessage(e, '처리에 실패했습니다.'))
  } finally {
    rulingId.value = null
  }
  void load()
}

function openPick(camp: any) {
  pickCamp.value = camp
  pickSku.value = ''
  pickDeal.value = ''
  pickAlloc.value = ''
  pickError.value = ''
  pickOpen.value = true
}

async function submitPick() {
  if (!pickCamp.value || !pickSku.value.trim()) { pickError.value = 'SKU ID를 입력해 주세요.'; return }
  pickBusy.value = true
  pickError.value = ''
  try {
    const r = await adminApi(`/api/v1/admin/flash-sales/${pickCamp.value.id}/items`, {
      method: 'POST',
      json: { sku_id: pickSku.value.trim(), deal_price: Number(pickDeal.value), allocated_stock: Number(pickAlloc.value) }
    })
    if (!r.ok) throw new Error(r.data.error || '편성에 실패했습니다.')
    toastApi.success('특가 상품이 직접 편성되었습니다.')
    pickOpen.value = false
  } catch (e: any) {
    pickError.value = userErrorMessage(e, '편성에 실패했습니다.')
  } finally {
    pickBusy.value = false
  }
  void load()
}

onMounted(() => void load())
</script>

<template>
  <div class="space-y-4">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 class="text-xl font-bold text-ink">타임딜 관리</h1>
        <p class="mt-1 text-xs text-ink-muted">캠페인 생성, 셀러 신청 승인, 직접 편성과 실시간 소진율을 관리합니다.</p>
      </div>
      <button type="button" class="rounded-xl bg-primary px-4 py-2 text-xs font-bold text-primary-on hover:bg-primary-hover" @click="formOpen = true">캠페인 등록</button>
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
    <OmEmptyState v-else-if="!rows.length" compact title="등록된 특가 캠페인이 없습니다." description="캠페인을 등록하면 이곳에 표시됩니다." />

    <section v-for="c in rows" v-else :key="c.id" class="space-y-3 rounded-2xl border border-line bg-surface p-5">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 class="text-sm font-bold text-ink">{{ c.title }}</h2>
          <p class="om-num mt-0.5 text-2xs text-ink-subtle">{{ String(c.starts_at || '').slice(0, 16) }} ~ {{ String(c.ends_at || '').slice(0, 16) }}</p>
        </div>
        <div class="flex items-center gap-2">
          <span class="rounded-full px-2 py-0.5 text-2xs font-bold" :class="c.status === 'ACTIVE' ? 'bg-success-soft text-success' : c.status === 'ENDED' ? 'bg-surface-3 text-ink-muted' : 'bg-warning-soft text-warning'">{{ STATUS_LABEL[c.status] || c.status }}</span>
          <button v-if="c.status !== 'ENDED'" type="button" class="rounded-lg bg-secondary px-3 py-1.5 text-xs font-bold text-secondary-on hover:bg-secondary-hover" @click="openPick(c)">직접 편성</button>
        </div>
      </div>
      <p v-if="!(c.items || []).length" class="text-xs text-ink-muted">편성된 상품이 없습니다.</p>
      <ul v-else class="divide-y divide-line-divider">
        <li v-for="it in c.items" :key="it.id" class="flex flex-wrap items-center justify-between gap-2 py-2 text-xs">
          <div class="min-w-0">
            <p class="om-num truncate font-bold text-ink">{{ it.sku_id }}</p>
            <p class="om-num mt-0.5 text-ink-subtle">{{ won(it.deal_price) }} · 배정 {{ it.allocated_stock }}개 · 판매 {{ it.sold_stock }}개 · 소진 {{ sellThrough(it) }}%</p>
            <div class="mt-1 h-1.5 w-40 overflow-hidden rounded-full bg-surface-3">
              <div class="h-full rounded-full bg-primary" :style="{ width: `${sellThrough(it)}%` }"></div>
            </div>
          </div>
          <div class="flex shrink-0 items-center gap-1.5">
            <span class="rounded-full px-2 py-0.5 text-2xs font-bold" :class="it.status === 'APPROVED' ? 'bg-success-soft text-success' : it.status === 'REJECTED' ? 'bg-danger-soft text-danger' : 'bg-warning-soft text-warning'">{{ ITEM_LABEL[it.status] || it.status }}</span>
            <template v-if="it.status === 'REQUESTED'">
              <button type="button" :disabled="rulingId === it.id" class="rounded-lg bg-success px-2.5 py-1.5 font-bold text-primary-on disabled:opacity-50" @click="decide(c.id, it.id, 'APPROVE')">승인</button>
              <button type="button" :disabled="rulingId === it.id" class="rounded-lg border border-line px-2.5 py-1.5 font-bold text-ink-muted hover:bg-surface-2 disabled:opacity-50" @click="decide(c.id, it.id, 'REJECT')">반려</button>
            </template>
          </div>
        </li>
      </ul>
    </section>

    <OmModal v-model:open="formOpen" title="특가 캠페인 등록">
      <div class="grid grid-cols-1 gap-3 text-xs sm:grid-cols-2">
        <label class="space-y-1 sm:col-span-2">캠페인명 *<input v-model="form.title" maxlength="200" class="h-10 w-full rounded-lg border border-line bg-surface px-3 text-ink" /></label>
        <label class="space-y-1">시작일시 *<input v-model="form.starts_at" type="datetime-local" class="h-10 w-full rounded-lg border border-line bg-surface px-2 text-ink" /></label>
        <label class="space-y-1">종료일시 *<input v-model="form.ends_at" type="datetime-local" class="h-10 w-full rounded-lg border border-line bg-surface px-2 text-ink" /></label>
        <label class="space-y-1">상태
          <select v-model="form.status" class="h-10 w-full rounded-lg border border-line bg-surface px-2 text-ink">
            <option value="DRAFT">작성 중</option>
            <option value="ACTIVE">진행 중</option>
            <option value="ENDED">종료</option>
          </select>
        </label>
      </div>
      <p v-if="formError" role="alert" class="mt-3 text-xs font-bold text-danger">{{ formError }}</p>
      <template #footer>
        <button type="button" class="h-10 rounded-lg border border-line px-4 text-sm font-bold text-ink hover:bg-surface-2" @click="formOpen = false">취소</button>
        <button type="button" :disabled="saving" class="h-10 rounded-lg bg-primary px-4 text-sm font-bold text-primary-on hover:bg-primary-hover disabled:opacity-50" @click="submitCampaign">{{ saving ? '등록 중…' : '등록' }}</button>
      </template>
    </OmModal>

    <OmModal v-model:open="pickOpen" title="특가 직접 편성">
      <div class="space-y-3 text-xs">
        <p class="font-bold text-ink">{{ pickCamp?.title }}</p>
        <label class="block space-y-1">SKU ID *<input v-model="pickSku" placeholder="예: sku_001_w" class="h-10 w-full rounded-lg border border-line bg-surface px-3 font-mono text-ink" /></label>
        <div class="grid grid-cols-2 gap-2">
          <label class="space-y-1">딜가 (판매가보다 낮게)<input v-model="pickDeal" type="number" min="100" class="h-10 w-full rounded-lg border border-line bg-surface px-3 text-ink" /></label>
          <label class="space-y-1">배정 수량 (재고 이내)<input v-model="pickAlloc" type="number" min="1" class="h-10 w-full rounded-lg border border-line bg-surface px-3 text-ink" /></label>
        </div>
        <p v-if="pickError" role="alert" class="font-bold text-danger">{{ pickError }}</p>
      </div>
      <template #footer>
        <button type="button" class="h-10 rounded-lg border border-line px-4 text-sm font-bold text-ink hover:bg-surface-2" @click="pickOpen = false">취소</button>
        <button type="button" :disabled="pickBusy" class="h-10 rounded-lg bg-primary px-4 text-sm font-bold text-primary-on hover:bg-primary-hover disabled:opacity-50" @click="submitPick">{{ pickBusy ? '편성 중…' : '편성' }}</button>
      </template>
    </OmModal>
  </div>
</template>
