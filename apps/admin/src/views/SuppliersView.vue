<script setup lang="ts">
// MODEL A 직영: 공급사 · SKU 소싱(원가·재판매 권한) · 발주서 & M2C 역경매 비딩 엔진
import { ref, onMounted } from 'vue'
import { adminApi, won } from '../config'
import { userErrorMessage, OmButton, OmEmptyState, OmModal, useConfirm } from '@olmoa/ui'

const { confirm: askConfirm } = useConfirm()

const tab = ref<'po' | 'suppliers' | 'bidding'>('po')
const suppliers = ref<any[]>([])
const pos = ref<any[]>([])
const poFilter = ref('')
const mappings = ref<any[]>([])
const selectedSupplier = ref<any>(null)
const msg = ref('')
const newSup = ref<any>({ name: '' })
const newMap = ref<any>({ fulfillment_mode: 'DROP_SHIP', resale_authorized: false, image_use_authorized: false })

// M2C Reverse Bidding Admin State
const campaigns = ref<any[]>([])
const activeCampaignId = ref('')
const campaignBids = ref<any[]>([])
const showNewCampaignModal = ref(false)
const newCampaign = ref<any>({ title: '', category_id: '', ceiling_supply_price: null, min_moq: null, notes: '' })

async function loadCampaigns() {
  try {
    const r = await adminApi('/api/v1/bidding/campaigns?status=ALL')
    campaigns.value = r.ok ? (r.data.data || []) : []
    if (!r.ok) msg.value = r.data.error || '캠페인 목록을 불러오지 못했습니다.'
  } catch (e: any) {
    msg.value = userErrorMessage(e, '캠페인 목록을 불러오지 못했습니다.')
  }
}

async function createCampaign() {
  const r = await adminApi('/api/v1/bidding/campaigns', {
    method: 'POST',
    json: {
      title: newCampaign.value.title,
      category_id: newCampaign.value.category_id,
      ceiling_supply_price: Number(newCampaign.value.ceiling_supply_price),
      min_moq: Number(newCampaign.value.min_moq),
      target_spec: { notes: newCampaign.value.notes }
    }
  })
  msg.value = r.ok ? `✓ ${r.data.message || 'M2C 역경매 캠페인이 개설되었습니다.'}` : (r.data.error || '캠페인 개설 실패')
  if (r.ok) {
    showNewCampaignModal.value = false
    newCampaign.value = { title: '', category_id: '', ceiling_supply_price: null, min_moq: null, notes: '' }
    loadCampaigns()
  }
}

async function viewBids(campaignId: string) {
  activeCampaignId.value = campaignId
  try {
    const r = await adminApi(`/api/v1/bidding/campaigns/${campaignId}`)
    campaignBids.value = r.ok ? (r.data.data?.bids || []) : []
    if (!r.ok) msg.value = r.data.error || '입찰 목록을 불러오지 못했습니다.'
  } catch (e: any) {
    msg.value = userErrorMessage(e, '입찰 목록을 불러오지 못했습니다.')
  }
}

async function awardBid(campaignId: string, bidId: string) {
  if (!(await askConfirm({ title: '최종 낙찰', body: '이 입찰을 최종 낙찰(Award)하시겠습니까? 캠페인은 완료 처리되고 나머지 입찰은 미선정됩니다.' }))) return
  const r = await adminApi(`/api/v1/admin/bidding/campaigns/${campaignId}/award`, {
    method: 'POST',
    json: { winning_bid_id: bidId }
  })
  msg.value = r.ok ? `✓ ${r.data.message || '낙찰 처리되었습니다.'}` : (r.data.error || '낙찰 처리 실패')
  if (r.ok) {
    loadCampaigns()
    viewBids(campaignId)
  }
}

const NEXT: Record<string, string[]> = { DRAFT: ['SENT', 'CANCELLED'], SENT: ['CONFIRMED', 'FAILED', 'CANCELLED'], CONFIRMED: ['SHIPPED', 'FAILED'], FAILED: ['SENT', 'CANCELLED'] }
const LABEL: Record<string, string> = { DRAFT: '발주 대기', SENT: '발주 전송', CONFIRMED: '공급사 확인', SHIPPED: '출고', FAILED: '실패/품절', CANCELLED: '취소' }

async function loadPos() {
  try {
    const r = await adminApi(`/api/v1/admin/purchase-orders${poFilter.value ? `?status=${poFilter.value}` : ''}`)
    pos.value = r.ok ? (r.data.data || []) : []
    if (!r.ok) msg.value = r.data.error || '발주 목록을 불러오지 못했습니다.'
  } catch (e: any) { msg.value = userErrorMessage(e, '발주 목록을 불러오지 못했습니다.') }
}
async function loadSuppliers() {
  try {
    const r = await adminApi('/api/v1/admin/suppliers')
    suppliers.value = r.ok ? (r.data.data || []) : []
    if (!r.ok) msg.value = r.data.error || '공급사 목록을 불러오지 못했습니다.'
  } catch (e: any) { msg.value = userErrorMessage(e, '공급사 목록을 불러오지 못했습니다.') }
}
async function openSupplier(s: any) {
  selectedSupplier.value = s
  try {
    const r = await adminApi(`/api/v1/admin/suppliers/${s.id}/mappings`)
    mappings.value = r.ok ? (r.data.data || []) : []
    if (!r.ok) msg.value = r.data.error || '소싱 정보를 불러오지 못했습니다.'
  } catch (e: any) { msg.value = userErrorMessage(e, '소싱 정보를 불러오지 못했습니다.') }
}

const poMoveOpen = ref(false)
const poMove = ref<{ po: any; status: string }>({ po: null, status: '' })
const poMoveForm = ref({ supplier_order_ref: '', failure_reason: '', tracking_number: '', carrier: 'CJ대한통운' })
const poMoveError = ref('')

function movePo(po: any, status: string) {
  poMove.value = { po, status }
  poMoveForm.value = { supplier_order_ref: '', failure_reason: '', tracking_number: '', carrier: 'CJ대한통운' }
  poMoveError.value = ''
  poMoveOpen.value = true
}

async function submitPoMove() {
  const { po, status } = poMove.value
  if (!po) return
  // P1-A10: CANCELLED is terminal (no outgoing transitions) and FAILED is
  // destructive — both need an explicit confirmation before the click lands.
  if (status === 'CANCELLED' && !(await askConfirm({ title: '발주 취소', body: `발주 ${po.po_no}를 취소합니다. 취소는 되돌릴 수 없습니다(terminal).`, danger: true }))) return
  if (status === 'FAILED' && !(await askConfirm({ title: '실패 처리', body: `발주 ${po.po_no}를 실패/품절 처리합니다.` }))) return
  const body: any = { status }
  if (status === 'SENT' || status === 'CONFIRMED') body.supplier_order_ref = poMoveForm.value.supplier_order_ref.trim() || undefined
  if (status === 'FAILED') {
    if (!poMoveForm.value.failure_reason.trim()) { poMoveError.value = '실패 사유를 입력해 주세요.'; return }
    body.failure_reason = poMoveForm.value.failure_reason.trim()
  }
  if (status === 'SHIPPED' && po.fulfillment_mode === 'DROP_SHIP') {
    if (!poMoveForm.value.tracking_number.trim()) { poMoveError.value = '공급사 직배송 송장번호를 입력해 주세요.'; return }
    body.tracking_number = poMoveForm.value.tracking_number.trim()
    body.carrier = poMoveForm.value.carrier.trim() || 'CJ대한통운'
  }
  const r = await adminApi(`/api/v1/admin/purchase-orders/${po.id}/status`, { method: 'PUT', json: body })
  msg.value = r.ok ? `${po.po_no} → ${LABEL[status]}${r.data.next_action ? ` · ${r.data.next_action}` : ''}` : (r.data.error || '변경 실패')
  poMoveOpen.value = false
  loadPos()
}

async function createSupplier() {
  const r = await adminApi('/api/v1/admin/suppliers', { method: 'POST', json: newSup.value })
  msg.value = r.ok ? '공급사가 등록되었습니다.' : (r.data.error || '등록 실패')
  newSup.value = { name: '' }
  loadSuppliers()
}

async function saveMapping() {
  const r = await adminApi('/api/v1/admin/supplier-mappings', { method: 'POST', json: { ...newMap.value, supplier_id: selectedSupplier.value.id, unit_cost: Number(newMap.value.unit_cost) } })
  msg.value = r.ok ? `소싱 연결 완료 · 마진 ${won(r.data.data.margin_amount)}${r.data.data.below_cost ? ' (⚠ 원가 이하 판매)' : ''}` : (r.data.error || '저장 실패')
  if (r.ok) openSupplier(selectedSupplier.value)
}

onMounted(() => { loadPos(); loadSuppliers(); loadCampaigns() })
</script>

<template>
  <div class="max-w-7xl mx-auto px-4 py-6 space-y-5 text-xs">
    <div>
      <h1 class="text-xl font-bold text-ink">직영(B2B 소싱) · 공급사 발주 &amp; M2C 역경매</h1>
      <p class="text-ink-muted mt-1">공급사 API 연동: <b class="text-warning">미연동</b> — 발주는 공급사에 수동 전달 후 이 화면에서 상태를 기록합니다. 재판매 권한이 확인되지 않은 SKU는 결제 단계에서 판매가 차단됩니다.</p>
    </div>
    <div class="flex gap-2">
      <button :class="['h-9 px-4 rounded-lg font-bold', tab === 'po' ? 'bg-secondary text-secondary-on' : 'bg-surface border border-line text-ink']" @click="tab = 'po'">발주서</button>
      <button :class="['h-9 px-4 rounded-lg font-bold', tab === 'suppliers' ? 'bg-secondary text-secondary-on' : 'bg-surface border border-line text-ink']" @click="tab = 'suppliers'">공급사 · 소싱</button>
      <button :class="['h-9 px-4 rounded-lg font-bold', tab === 'bidding' ? 'bg-secondary text-secondary-on' : 'bg-surface border border-line text-ink']" @click="tab = 'bidding'">M2C 역경매 비딩 &amp; MD 네고</button>
    </div>
    <div v-if="msg" role="status" class="p-3 rounded-lg bg-primary-soft text-primary-soft-ink font-bold">{{ msg }}</div>

    <!-- Tab 1: PO List -->
    <section v-if="tab === 'po'" class="bg-surface rounded-xl border border-line overflow-x-auto">
      <div class="p-3 flex gap-2 border-b border-line-divider">
        <select v-model="poFilter" @change="loadPos" class="h-8 px-2 rounded-lg border border-line bg-surface text-ink"><option value="">전체 상태</option><option v-for="(l, k) in LABEL" :key="k" :value="k">{{ l }}</option></select>
      </div>
      <table class="w-full min-w-[860px]">
        <thead class="bg-surface-2 text-ink-muted"><tr><th class="p-2 text-left">발주번호</th><th class="p-2 text-left">고객 주문</th><th class="p-2 text-left">공급사</th><th class="p-2 text-left">품목</th><th class="p-2 text-right">원가 합계</th><th class="p-2">방식</th><th class="p-2">상태</th><th class="p-2">처리</th></tr></thead>
        <tbody>
          <tr v-for="po in pos" :key="po.id" class="border-t border-line-divider align-top">
            <td class="p-2 font-mono text-ink">{{ po.po_no }}</td>
            <td class="p-2 text-ink">{{ po.order_no }}<div class="text-ink-subtle">{{ po.recipient_name }} · {{ po.shipping_postal_code }}</div></td>
            <td class="p-2 text-ink">{{ po.supplier_name }}</td>
            <td class="p-2 text-ink"><div v-for="it in po.items" :key="it.id">{{ it.product_title }} × {{ it.quantity }} <span class="text-ink-subtle">({{ it.supplier_sku_code }})</span></div></td>
            <td class="p-2 text-right text-ink">{{ won(po.total_cost) }}</td>
            <td class="p-2 text-center text-ink">{{ po.fulfillment_mode === 'DROP_SHIP' ? '공급사 직배송' : '자체 출고' }}</td>
            <td class="p-2 text-center font-bold text-ink">{{ LABEL[po.status] }}<div v-if="po.failure_reason" class="text-danger font-normal">{{ po.failure_reason }}</div></td>
            <td class="p-2"><div class="flex flex-wrap gap-1"><button v-for="n in (NEXT[po.status] || [])" :key="n" class="px-2 py-1 rounded-lg border border-line text-ink hover:bg-surface-2" @click="movePo(po, n)">{{ LABEL[n] }}</button></div></td>
          </tr>
          <tr v-if="!pos.length"><td colspan="8" class="p-6 text-center text-ink-subtle">발주서가 없습니다.</td></tr>
        </tbody>
      </table>
    </section>

    <!-- Tab 2: Suppliers List -->
    <section v-else-if="tab === 'suppliers'" class="grid lg:grid-cols-[320px_1fr] gap-4">
      <div class="bg-surface rounded-xl border border-line p-4 space-y-3">
        <form class="flex gap-2" @submit.prevent="createSupplier"><input v-model="newSup.name" required placeholder="새 공급사명" class="flex-1 h-9 px-2 rounded-lg border border-line bg-surface text-ink" /><button class="px-3 rounded-lg bg-secondary text-secondary-on font-bold hover:bg-secondary-hover">등록</button></form>
        <button v-for="s in suppliers" :key="s.id" class="w-full text-left p-3 rounded-lg border" :class="selectedSupplier?.id === s.id ? 'border-primary bg-primary-soft' : 'border-line'" @click="openSupplier(s)">
          <div class="font-bold text-ink">{{ s.name }}</div><div class="text-ink-muted">소싱 {{ s.active_mappings }} · 미결 발주 {{ s.open_pos }} · API {{ s.api_integration_status }}</div>
        </button>
      </div>
      <div v-if="selectedSupplier" class="bg-surface rounded-xl border border-line p-4 space-y-4 text-ink">
        <h2 class="font-bold text-sm">{{ selectedSupplier.name }} · SKU 소싱</h2>
        <form class="grid sm:grid-cols-3 gap-2" @submit.prevent="saveMapping">
          <input v-model="newMap.sku_id" required placeholder="직영 SKU ID" class="h-9 px-2 rounded-lg border border-line bg-surface text-ink" />
          <input v-model="newMap.supplier_sku_code" required placeholder="공급사 상품코드" class="h-9 px-2 rounded-lg border border-line bg-surface text-ink" />
          <input v-model="newMap.unit_cost" required type="number" min="0" placeholder="공급가(원)" class="h-9 px-2 rounded-lg border border-line bg-surface text-ink" />
          <select v-model="newMap.fulfillment_mode" class="h-9 px-2 rounded-lg border border-line bg-surface text-ink"><option value="DROP_SHIP">공급사 직배송</option><option value="SELF_SHIP">자체 출고</option></select>
          <label class="flex items-center gap-1"><input type="checkbox" v-model="newMap.resale_authorized" class="accent-primary" /> 재판매 권한 확인</label>
          <label class="flex items-center gap-1"><input type="checkbox" v-model="newMap.image_use_authorized" class="accent-primary" /> 이미지 사용 권한 확인</label>
          <input v-model="newMap.authorization_evidence" placeholder="권한 근거(계약서 번호/문서 링크)" class="sm:col-span-2 h-9 px-2 rounded-lg border border-line bg-surface text-ink" />
          <button class="h-9 rounded-lg bg-primary text-primary-on font-bold hover:bg-primary-hover">소싱 연결 저장</button>
        </form>
        <div class="overflow-x-auto"><table class="w-full min-w-[640px]">
          <thead class="bg-surface-2 text-ink-muted"><tr><th class="p-2 text-left">상품</th><th class="p-2 text-right">판매가</th><th class="p-2 text-right">공급가</th><th class="p-2 text-right">마진</th><th class="p-2">재판매 권한</th><th class="p-2">상태</th></tr></thead>
          <tbody><tr v-for="m in mappings" :key="m.id" class="border-t border-line-divider">
            <td class="p-2">{{ m.product_title }}<div class="text-ink-subtle font-mono">{{ m.sku_id }}</div></td>
            <td class="p-2 text-right">{{ won(m.sale_price) }}</td><td class="p-2 text-right">{{ won(m.unit_cost) }}</td>
            <td class="p-2 text-right" :class="m.margin_amount < 0 ? 'text-danger font-bold' : ''">{{ won(m.margin_amount) }}</td>
            <td class="p-2 text-center">{{ Number(m.resale_authorized) ? '확인' : '미확인(판매 차단)' }}</td>
            <td class="p-2 text-center">{{ Number(m.is_active) ? '사용' : '이력' }}</td>
          </tr></tbody>
        </table></div>
      </div>
    </section>

    <!-- Tab 3: M2C Reverse Bidding Admin Section -->
    <section v-else-if="tab === 'bidding'" class="space-y-4">
      <div class="flex items-center justify-between">
        <div>
          <h2 class="text-sm font-bold text-ink">M2C 공장 직접 역경매 캠페인 관리</h2>
          <p class="text-ink-muted">대량 조달 목표 도매가를 설정하고 등록 파트너사들의 역경매 입찰을 받아 전탁(위탁) 납품 계약을 체결합니다.</p>
        </div>
        <button
          @click="showNewCampaignModal = true"
          class="h-9 px-4 rounded-xl bg-primary hover:bg-primary-hover text-primary-on font-bold cursor-pointer"
        >
          + 새 역경매 캠페인 개설
        </button>
      </div>

      <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
        <!-- Campaigns List -->
        <div class="bg-surface rounded-xl border border-line p-4 space-y-3">
          <h3 class="font-bold text-ink border-b border-line-divider pb-2">개설된 비딩 캠페인 목록 ({{ campaigns.length }})</h3>
          <div v-for="c in campaigns" :key="c.id" class="p-3 rounded-lg border border-line-divider hover:border-primary cursor-pointer transition space-y-1" @click="viewBids(c.id)" :class="activeCampaignId === c.id ? 'bg-primary-soft border-primary' : ''">
            <div class="flex items-center justify-between">
              <span class="font-bold text-ink">{{ c.title }}</span>
              <span class="px-2 py-0.5 rounded font-mono text-[10px] bg-surface-2 font-bold text-ink-muted">{{ c.status }}</span>
            </div>
            <div class="text-[11px] text-ink-muted flex gap-3">
              <span>상한 공급가: <strong class="text-danger">{{ won(c.ceiling_supply_price) }}</strong></span>
              <span>최소 MOQ: <strong class="text-ink">{{ c.min_moq }}개</strong></span>
            </div>
            <div class="text-[10px] text-primary font-bold">클릭하여 입찰 제안서 {{ c.bid_count || 0 }}건 조회</div>
          </div>
          <OmEmptyState
            v-if="campaigns.length === 0"
            compact
            title="개설된 캠페인이 없습니다."
            description="상단 양식으로 첫 소싱 캠페인을 개설해 보세요."
          >
            <OmButton size="sm" @click="loadCampaigns">다시 불러오기</OmButton>
          </OmEmptyState>
        </div>

        <!-- Bids for selected campaign -->
        <div class="bg-surface rounded-xl border border-line p-4 space-y-3">
          <h3 class="font-bold text-ink border-b border-line-divider pb-2">
            제출된 파트너사 입찰 제안서 {{ activeCampaignId ? `(#${activeCampaignId})` : '' }}
          </h3>
          <div v-if="!activeCampaignId" class="py-12 text-center text-ink-subtle">
            좌측 캠페인을 선택하면 입찰 목록이 표시됩니다.
          </div>
          <OmEmptyState
            v-else-if="campaignBids.length === 0"
            compact
            title="아직 제출된 입찰 제안서가 없습니다."
            description="공급사가 입찰하면 이곳에 표시됩니다."
          >
            <OmButton size="sm" @click="loadCampaigns">다시 불러오기</OmButton>
          </OmEmptyState>
          <div v-else class="space-y-2">
            <div v-for="b in campaignBids" :key="b.id" class="p-3 rounded-lg border border-line-divider space-y-1.5 bg-surface-2">
              <div class="flex items-center justify-between">
                <span class="font-bold text-ink">{{ b.partner_name || b.partner_id }}</span>
                <span :class="['px-2 py-0.5 rounded text-[10px] font-bold', b.status === 'WON' ? 'bg-success-soft text-success' : b.status === 'LOST' ? 'bg-surface-3 text-ink-muted' : 'bg-warning-soft text-warning']">
                  {{ b.status === 'WON' ? '★ 낙찰 완료' : b.status === 'LOST' ? '미선정' : b.status }}
                </span>
              </div>
              <div class="flex justify-between text-[11px] text-ink">
                <span>제시 공급가: <strong class="text-danger">{{ won(b.bid_supply_price) }}</strong></span>
                <span>MOQ: <strong>{{ b.moq }}개</strong> ({{ b.production_lead_days }}일 리드타임)</span>
              </div>
              <div v-if="b.bid_notes" class="text-[10px] text-ink-muted italic">"{{ b.bid_notes }}"</div>
              <div v-if="b.status !== 'WON' && b.status !== 'LOST'" class="pt-1 flex justify-end">
                <button
                  @click="awardBid(activeCampaignId, b.id)"
                  class="px-3 py-1 rounded-lg bg-success text-primary-on font-bold text-[11px]"
                >
                  최종 낙찰(Award) 승인
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- New Campaign Modal -->
    <div v-if="showNewCampaignModal" class="fixed inset-0 bg-overlay/50 backdrop-blur-xs flex items-center justify-center z-50 p-4">
      <div class="bg-surface rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4 border border-line">
        <h3 class="text-sm font-bold text-ink">새 M2C 역경매 소싱 캠페인 개설</h3>
        <div class="space-y-3">
          <div>
            <label class="block font-bold text-ink-muted mb-1">캠페인 제목</label>
            <input v-model="newCampaign.title" placeholder="예: Q4 무선이어폰 대량 소싱" class="w-full h-9 px-3 rounded-lg border border-line bg-surface text-ink" />
          </div>
          <div class="grid grid-cols-2 gap-2">
            <div>
              <label class="block font-bold text-ink-muted mb-1">카테고리 ID</label>
              <input v-model="newCampaign.category_id" placeholder="예: cat_e_audio" class="w-full h-9 px-3 rounded-lg border border-line bg-surface text-ink" />
            </div>
            <div>
              <label class="block font-bold text-ink-muted mb-1">최소 MOQ</label>
              <input v-model.number="newCampaign.min_moq" type="number" min="1" placeholder="예: 100" class="w-full h-9 px-3 rounded-lg border border-line bg-surface text-ink" />
            </div>
          </div>
          <div>
            <label class="block font-bold text-ink-muted mb-1">상한 공급가 (KRW)</label>
            <input v-model.number="newCampaign.ceiling_supply_price" type="number" min="100" placeholder="예: 28000" class="w-full h-9 px-3 rounded-lg border border-line bg-surface text-ink font-bold text-danger" />
          </div>
          <div>
            <label class="block font-bold text-ink-muted mb-1">소싱 요건 및 품질 메모</label>
            <textarea v-model="newCampaign.notes" rows="2" class="w-full p-2 rounded-lg border border-line bg-surface text-ink"></textarea>
          </div>
        </div>
        <div class="flex gap-2">
          <button @click="showNewCampaignModal = false" class="flex-1 h-9 rounded-lg border border-line text-ink hover:bg-surface-2">취소</button>
          <button @click="createCampaign" class="flex-1 h-9 rounded-lg bg-primary text-primary-on font-bold hover:bg-primary-hover">캠페인 개설</button>
        </div>
      </div>
    </div>

    <OmModal v-model:open="poMoveOpen" title="발주 상태 변경">
      <div class="space-y-3 text-xs">
        <p class="font-bold text-ink">{{ poMove.po?.po_no }} → {{ LABEL[poMove.status] }}</p>
        <label v-if="poMove.status === 'SENT' || poMove.status === 'CONFIRMED'" class="block space-y-1 text-ink">공급사 주문번호 (선택)<input v-model="poMoveForm.supplier_order_ref" class="h-10 w-full rounded-lg border border-line bg-surface px-3 text-ink" /></label>
        <label v-if="poMove.status === 'FAILED'" class="block space-y-1 text-ink">실패 사유 *
          <input v-model="poMoveForm.failure_reason" placeholder="예: 공급사 재고 소진" class="h-10 w-full rounded-lg border border-line bg-surface px-3 text-ink" /></label>
        <template v-if="poMove.status === 'SHIPPED' && poMove.po?.fulfillment_mode === 'DROP_SHIP'">
          <label class="block space-y-1 text-ink">공급사 직배송 송장번호 *<input v-model="poMoveForm.tracking_number" class="h-10 w-full rounded-lg border border-line bg-surface px-3 font-mono text-ink" /></label>
          <label class="block space-y-1 text-ink">택배사<input v-model="poMoveForm.carrier" class="h-10 w-full rounded-lg border border-line bg-surface px-3 text-ink" /></label>
        </template>
        <p v-if="poMoveError" role="alert" class="font-bold text-danger">{{ poMoveError }}</p>
      </div>
      <template #footer>
        <button type="button" class="h-10 rounded-lg border border-line px-4 text-sm font-bold text-ink hover:bg-surface-2" @click="poMoveOpen = false">취소</button>
        <button type="button" class="h-10 rounded-lg bg-primary px-4 text-sm font-bold text-primary-on hover:bg-primary-hover" @click="submitPoMove">변경</button>
      </template>
    </OmModal>
  </div>
</template>
