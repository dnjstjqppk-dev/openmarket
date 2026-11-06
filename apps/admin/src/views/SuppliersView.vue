<script setup lang="ts">
// MODEL A 직영: 공급사 · SKU 소싱(원가·재판매 권한) · 발주서 & M2C 역경매 비딩 엔진
import { ref, onMounted } from 'vue'
import { adminApi, won } from '../config'

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
  const r = await adminApi('/api/v1/bidding/campaigns?status=ALL')
  campaigns.value = r.data.data || []
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
  const r = await adminApi(`/api/v1/bidding/campaigns/${campaignId}`)
  campaignBids.value = r.data.data?.bids || []
}

async function awardBid(campaignId: string, bidId: string) {
  if (!confirm('이 입찰을 최종 낙찰(Award)하시겠습니까? 캠페인은 완료 처리되고 나머지 입찰은 미선정됩니다.')) return
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

async function loadPos() { const r = await adminApi(`/api/v1/admin/purchase-orders${poFilter.value ? `?status=${poFilter.value}` : ''}`); pos.value = r.data.data || [] }
async function loadSuppliers() { const r = await adminApi('/api/v1/admin/suppliers'); suppliers.value = r.data.data || [] }
async function openSupplier(s: any) { selectedSupplier.value = s; const r = await adminApi(`/api/v1/admin/suppliers/${s.id}/mappings`); mappings.value = r.data.data || [] }

async function movePo(po: any, status: string) {
  const body: any = { status }
  if (status === 'SENT' || status === 'CONFIRMED') body.supplier_order_ref = prompt('공급사 주문번호(선택)') || undefined
  if (status === 'FAILED') body.failure_reason = prompt('실패 사유 (예: 공급사 재고 소진)') || '공급사 발주 실패'
  if (status === 'SHIPPED' && po.fulfillment_mode === 'DROP_SHIP') {
    body.tracking_number = prompt('공급사 직배송 송장번호')
    if (!body.tracking_number) return
    body.carrier = prompt('택배사', 'CJ대한통운') || 'CJ대한통운'
  }
  const r = await adminApi(`/api/v1/admin/purchase-orders/${po.id}/status`, { method: 'PUT', json: body })
  msg.value = r.ok ? `${po.po_no} → ${LABEL[status]}${r.data.next_action ? ` · ${r.data.next_action}` : ''}` : (r.data.error || '변경 실패')
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
      <h1 class="text-xl font-black">직영(B2B 소싱) · 공급사 발주 &amp; M2C 역경매</h1>
      <p class="text-slate-500 mt-1">공급사 API 연동: <b class="text-amber-700">미연동</b> — 발주는 공급사에 수동 전달 후 이 화면에서 상태를 기록합니다. 재판매 권한이 확인되지 않은 SKU는 결제 단계에서 판매가 차단됩니다.</p>
    </div>
    <div class="flex gap-2">
      <button :class="['h-9 px-4 rounded-lg font-bold', tab === 'po' ? 'bg-slate-900 text-white' : 'bg-white border']" @click="tab = 'po'">발주서</button>
      <button :class="['h-9 px-4 rounded-lg font-bold', tab === 'suppliers' ? 'bg-slate-900 text-white' : 'bg-white border']" @click="tab = 'suppliers'">공급사 · 소싱</button>
      <button :class="['h-9 px-4 rounded-lg font-bold', tab === 'bidding' ? 'bg-slate-900 text-white' : 'bg-white border']" @click="tab = 'bidding'">M2C 역경매 비딩 &amp; MD 네고</button>
    </div>
    <div v-if="msg" role="status" class="p-3 rounded-lg bg-indigo-50 text-indigo-900 font-bold">{{ msg }}</div>

    <!-- Tab 1: PO List -->
    <section v-if="tab === 'po'" class="bg-white rounded-xl border border-slate-200 overflow-x-auto">
      <div class="p-3 flex gap-2 border-b">
        <select v-model="poFilter" @change="loadPos" class="h-8 px-2 rounded border"><option value="">전체 상태</option><option v-for="(l, k) in LABEL" :key="k" :value="k">{{ l }}</option></select>
      </div>
      <table class="w-full min-w-[860px]">
        <thead class="bg-slate-50 text-slate-500"><tr><th class="p-2 text-left">발주번호</th><th class="p-2 text-left">고객 주문</th><th class="p-2 text-left">공급사</th><th class="p-2 text-left">품목</th><th class="p-2 text-right">원가 합계</th><th class="p-2">방식</th><th class="p-2">상태</th><th class="p-2">처리</th></tr></thead>
        <tbody>
          <tr v-for="po in pos" :key="po.id" class="border-t align-top">
            <td class="p-2 font-mono">{{ po.po_no }}</td>
            <td class="p-2">{{ po.order_no }}<div class="text-slate-400">{{ po.recipient_name }} · {{ po.shipping_postal_code }}</div></td>
            <td class="p-2">{{ po.supplier_name }}</td>
            <td class="p-2"><div v-for="it in po.items" :key="it.id">{{ it.product_title }} × {{ it.quantity }} <span class="text-slate-400">({{ it.supplier_sku_code }})</span></div></td>
            <td class="p-2 text-right">{{ won(po.total_cost) }}</td>
            <td class="p-2 text-center">{{ po.fulfillment_mode === 'DROP_SHIP' ? '공급사 직배송' : '자체 출고' }}</td>
            <td class="p-2 text-center font-bold">{{ LABEL[po.status] }}<div v-if="po.failure_reason" class="text-red-600 font-normal">{{ po.failure_reason }}</div></td>
            <td class="p-2"><div class="flex flex-wrap gap-1"><button v-for="n in (NEXT[po.status] || [])" :key="n" class="px-2 py-1 rounded border" @click="movePo(po, n)">{{ LABEL[n] }}</button></div></td>
          </tr>
          <tr v-if="!pos.length"><td colspan="8" class="p-6 text-center text-slate-400">발주서가 없습니다.</td></tr>
        </tbody>
      </table>
    </section>

    <!-- Tab 2: Suppliers List -->
    <section v-else-if="tab === 'suppliers'" class="grid lg:grid-cols-[320px_1fr] gap-4">
      <div class="bg-white rounded-xl border border-slate-200 p-4 space-y-3">
        <form class="flex gap-2" @submit.prevent="createSupplier"><input v-model="newSup.name" required placeholder="새 공급사명" class="flex-1 h-9 px-2 rounded border" /><button class="px-3 rounded bg-slate-900 text-white font-bold">등록</button></form>
        <button v-for="s in suppliers" :key="s.id" class="w-full text-left p-3 rounded-lg border" :class="selectedSupplier?.id === s.id ? 'border-indigo-500 bg-indigo-50' : 'border-slate-200'" @click="openSupplier(s)">
          <div class="font-bold">{{ s.name }}</div><div class="text-slate-500">소싱 {{ s.active_mappings }} · 미결 발주 {{ s.open_pos }} · API {{ s.api_integration_status }}</div>
        </button>
      </div>
      <div v-if="selectedSupplier" class="bg-white rounded-xl border border-slate-200 p-4 space-y-4">
        <h2 class="font-black text-sm">{{ selectedSupplier.name }} · SKU 소싱</h2>
        <form class="grid sm:grid-cols-3 gap-2" @submit.prevent="saveMapping">
          <input v-model="newMap.sku_id" required placeholder="직영 SKU ID" class="h-9 px-2 rounded border" />
          <input v-model="newMap.supplier_sku_code" required placeholder="공급사 상품코드" class="h-9 px-2 rounded border" />
          <input v-model="newMap.unit_cost" required type="number" min="0" placeholder="공급가(원)" class="h-9 px-2 rounded border" />
          <select v-model="newMap.fulfillment_mode" class="h-9 px-2 rounded border"><option value="DROP_SHIP">공급사 직배송</option><option value="SELF_SHIP">자체 출고</option></select>
          <label class="flex items-center gap-1"><input type="checkbox" v-model="newMap.resale_authorized" /> 재판매 권한 확인</label>
          <label class="flex items-center gap-1"><input type="checkbox" v-model="newMap.image_use_authorized" /> 이미지 사용 권한 확인</label>
          <input v-model="newMap.authorization_evidence" placeholder="권한 근거(계약서 번호/문서 링크)" class="sm:col-span-2 h-9 px-2 rounded border" />
          <button class="h-9 rounded bg-indigo-600 text-white font-black">소싱 연결 저장</button>
        </form>
        <div class="overflow-x-auto"><table class="w-full min-w-[640px]">
          <thead class="bg-slate-50 text-slate-500"><tr><th class="p-2 text-left">상품</th><th class="p-2 text-right">판매가</th><th class="p-2 text-right">공급가</th><th class="p-2 text-right">마진</th><th class="p-2">재판매 권한</th><th class="p-2">상태</th></tr></thead>
          <tbody><tr v-for="m in mappings" :key="m.id" class="border-t">
            <td class="p-2">{{ m.product_title }}<div class="text-slate-400 font-mono">{{ m.sku_id }}</div></td>
            <td class="p-2 text-right">{{ won(m.sale_price) }}</td><td class="p-2 text-right">{{ won(m.unit_cost) }}</td>
            <td class="p-2 text-right" :class="m.margin_amount < 0 ? 'text-red-600 font-bold' : ''">{{ won(m.margin_amount) }}</td>
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
          <h2 class="text-sm font-black text-slate-900">M2C 공장 직접 역경매 캠페인 관리</h2>
          <p class="text-slate-500">대량 조달 목표 도매가를 설정하고 등록 파트너사들의 역경매 입찰을 받아 전탁(위탁) 납품 계약을 체결합니다.</p>
        </div>
        <button
          @click="showNewCampaignModal = true"
          class="h-9 px-4 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold cursor-pointer"
        >
          + 새 역경매 캠페인 개설
        </button>
      </div>

      <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
        <!-- Campaigns List -->
        <div class="bg-white rounded-xl border border-slate-200 p-4 space-y-3">
          <h3 class="font-bold text-slate-800 border-b pb-2">개설된 비딩 캠페인 목록 ({{ campaigns.length }})</h3>
          <div v-for="c in campaigns" :key="c.id" class="p-3 rounded-lg border border-slate-100 hover:border-indigo-400 cursor-pointer transition space-y-1" @click="viewBids(c.id)" :class="activeCampaignId === c.id ? 'bg-indigo-50/50 border-indigo-500' : ''">
            <div class="flex items-center justify-between">
              <span class="font-bold text-slate-900">{{ c.title }}</span>
              <span class="px-2 py-0.5 rounded font-mono text-[10px] bg-slate-100 font-bold">{{ c.status }}</span>
            </div>
            <div class="text-[11px] text-slate-500 flex gap-3">
              <span>상한 공급가: <strong class="text-rose-600">{{ won(c.ceiling_supply_price) }}</strong></span>
              <span>최소 MOQ: <strong>{{ c.min_moq }}개</strong></span>
            </div>
            <div class="text-[10px] text-indigo-600 font-bold">👉 클릭하여 입찰 제안서 {{ c.bid_count || 0 }}건 조회</div>
          </div>
          <div v-if="campaigns.length === 0" class="py-8 text-center text-slate-400">개설된 캠페인이 없습니다.</div>
        </div>

        <!-- Bids for selected campaign -->
        <div class="bg-white rounded-xl border border-slate-200 p-4 space-y-3">
          <h3 class="font-bold text-slate-800 border-b pb-2">
            제출된 파트너사 입찰 제안서 {{ activeCampaignId ? `(#${activeCampaignId})` : '' }}
          </h3>
          <div v-if="!activeCampaignId" class="py-12 text-center text-slate-400">
            좌측 캠페인을 선택하면 입찰 목록이 표시됩니다.
          </div>
          <div v-else-if="campaignBids.length === 0" class="py-12 text-center text-slate-400">
            아직 제출된 입찰 제안서가 없습니다.
          </div>
          <div v-else class="space-y-2">
            <div v-for="b in campaignBids" :key="b.id" class="p-3 rounded-lg border border-slate-100 space-y-1.5 bg-slate-50">
              <div class="flex items-center justify-between">
                <span class="font-bold text-slate-900">{{ b.partner_name || b.partner_id }}</span>
                <span :class="['px-2 py-0.5 rounded text-[10px] font-bold', b.status === 'WON' ? 'bg-emerald-100 text-emerald-800' : b.status === 'LOST' ? 'bg-slate-200 text-slate-500' : 'bg-amber-100 text-amber-800']">
                  {{ b.status === 'WON' ? '★ 낙찰 완료' : b.status === 'LOST' ? '미선정' : b.status }}
                </span>
              </div>
              <div class="flex justify-between text-[11px]">
                <span>제시 공급가: <strong class="text-rose-600">{{ won(b.bid_supply_price) }}</strong></span>
                <span>MOQ: <strong>{{ b.moq }}개</strong> ({{ b.production_lead_days }}일 리드타임)</span>
              </div>
              <div v-if="b.bid_notes" class="text-[10px] text-slate-500 italic">"{{ b.bid_notes }}"</div>
              <div v-if="b.status !== 'WON' && b.status !== 'LOST'" class="pt-1 flex justify-end">
                <button
                  @click="awardBid(activeCampaignId, b.id)"
                  class="px-3 py-1 rounded bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-[11px]"
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
    <div v-if="showNewCampaignModal" class="fixed inset-0 bg-black/50 backdrop-blur-xs flex items-center justify-center z-50 p-4">
      <div class="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4">
        <h3 class="text-sm font-black text-slate-900">새 M2C 역경매 소싱 캠페인 개설</h3>
        <div class="space-y-3">
          <div>
            <label class="block font-bold text-slate-700 mb-1">캠페인 제목</label>
            <input v-model="newCampaign.title" placeholder="예: Q4 무선이어폰 대량 소싱" class="w-full h-9 px-3 rounded border border-slate-300" />
          </div>
          <div class="grid grid-cols-2 gap-2">
            <div>
              <label class="block font-bold text-slate-700 mb-1">카테고리 ID</label>
              <input v-model="newCampaign.category_id" placeholder="예: cat_e_audio" class="w-full h-9 px-3 rounded border border-slate-300" />
            </div>
            <div>
              <label class="block font-bold text-slate-700 mb-1">최소 MOQ</label>
              <input v-model.number="newCampaign.min_moq" type="number" min="1" placeholder="예: 100" class="w-full h-9 px-3 rounded border border-slate-300" />
            </div>
          </div>
          <div>
            <label class="block font-bold text-slate-700 mb-1">상한 공급가 (KRW)</label>
            <input v-model.number="newCampaign.ceiling_supply_price" type="number" min="100" placeholder="예: 28000" class="w-full h-9 px-3 rounded border border-slate-300 font-bold text-rose-600" />
          </div>
          <div>
            <label class="block font-bold text-slate-700 mb-1">소싱 요건 및 품질 메모</label>
            <textarea v-model="newCampaign.notes" rows="2" class="w-full p-2 rounded border border-slate-300"></textarea>
          </div>
        </div>
        <div class="flex gap-2">
          <button @click="showNewCampaignModal = false" class="flex-1 h-9 rounded border">취소</button>
          <button @click="createCampaign" class="flex-1 h-9 rounded bg-indigo-600 text-white font-bold">캠페인 개설</button>
        </div>
      </div>
    </div>
  </div>
</template>
