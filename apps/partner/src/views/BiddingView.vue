<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { API_BASE_URL, getPartnerHeaders } from '../config'

const activeTab = ref<'campaigns' | 'my-bids' | 'negotiations'>('campaigns')
const campaigns = ref<any[]>([])
const myBids = ref<any[]>([])
const negotiations = ref<any[]>([])
const loading = ref(true)
const toast = ref('')

// Bid Modal State
const showBidModal = ref(false)
const selectedCampaign = ref<any>(null)
const bidWholesalePrice = ref(25000)
const bidCapacity = ref(500)
const bidLeadDays = ref(3)
const bidNotes = ref('')
const submittingBid = ref(false)

// Negotiation Modal State
const showNegoModal = ref(false)
const selectedNego = ref<any>(null)
const counterPrice = ref(0)
const negoNotes = ref('')
const submittingNego = ref(false)

const won = (n: number) => `${Number(n || 0).toLocaleString('ko-KR')}원`

async function loadData() {
  loading.value = true
  try {
    const [cRes, bRes, nRes] = await Promise.all([
      fetch(`${API_BASE_URL}/api/v1/bidding/campaigns`, { headers: getPartnerHeaders() }),
      fetch(`${API_BASE_URL}/api/v1/bidding/my-bids`, { headers: getPartnerHeaders() }).catch(() => null),
      fetch(`${API_BASE_URL}/api/v1/bidding/negotiations`, { headers: getPartnerHeaders() }).catch(() => null)
    ])

    const cJson = await cRes.json()
    if (cJson.success) campaigns.value = cJson.data || []

    if (bRes && bRes.ok) {
      const bJson = await bRes.json()
      if (bJson.success) myBids.value = bJson.data || []
    }

    if (nRes && nRes.ok) {
      const nJson = await nRes.json()
      if (nJson.success) negotiations.value = nJson.data || []
    }
  } catch (e) {
    console.error(e)
  } finally {
    loading.value = false
  }
}

function openBid(c: any) {
  selectedCampaign.value = c
  bidWholesalePrice.value = c.target_wholesale_price || 25000
  bidCapacity.value = c.target_quantity || 500
  bidLeadDays.value = 3
  bidNotes.value = '공장 직접 출고 보증, KC 인증 완료'
  showBidModal.value = true
}

async function submitBid() {
  if (!selectedCampaign.value) return
  submittingBid.value = true
  try {
    const res = await fetch(`${API_BASE_URL}/api/v1/bidding/campaigns/${selectedCampaign.value.id}/bids`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getPartnerHeaders() },
      body: JSON.stringify({
        wholesale_supply_price: Number(bidWholesalePrice.value),
        supply_capacity: Number(bidCapacity.value),
        delivery_lead_days: Number(bidLeadDays.value),
        bid_notes: bidNotes.value
      })
    })
    const json = await res.json()
    if (res.ok && json.success) {
      showBidModal.value = false
      toast.value = '✓ 역경매 입찰 제안서가 등록되었습니다.'
      setTimeout(() => { toast.value = '' }, 3500)
      await loadData()
      activeTab.value = 'my-bids'
    } else {
      alert(json.error || '입찰 제출 실패')
    }
  } catch (e: any) {
    alert(e.message || '입찰 처리 중 오류')
  } finally {
    submittingBid.value = false
  }
}

async function respondNego(action: 'ACCEPT' | 'REJECT' | 'COUNTER', counter?: number) {
  if (!selectedNego.value) return
  submittingNego.value = true
  try {
    const res = await fetch(`${API_BASE_URL}/api/v1/bidding/negotiations/${selectedNego.value.id}/respond`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getPartnerHeaders() },
      body: JSON.stringify({
        action,
        counter_price: counter,
        notes: negoNotes.value
      })
    })
    const json = await res.json()
    if (res.ok && json.success) {
      showNegoModal.value = false
      toast.value = `✓ MD 공급가 협상 ${action === 'ACCEPT' ? '수락' : action === 'COUNTER' ? '역제안' : '거절'} 완료`
      setTimeout(() => { toast.value = '' }, 3500)
      await loadData()
    } else {
      alert(json.error || '협상 처리 실패')
    }
  } catch (e: any) {
    alert(e.message || '처리 오류')
  } finally {
    submittingNego.value = false
  }
}

onMounted(loadData)
</script>

<template>
  <div class="space-y-6 text-xs">
    <!-- Header -->
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 class="text-xl font-black text-gray-900 flex items-center gap-2">
          <span>M2C 동적 역경매 비딩 &amp; MD 네고 워크벤치</span>
          <span class="px-2.5 py-0.5 rounded-full bg-indigo-100 text-indigo-800 text-[11px] font-black">Direct Factory M2C</span>
        </h1>
        <p class="text-gray-500 mt-1">
          올모아 MD의 대량 소싱 캠페인에 공장 직접 도매가를 제시하여 전탁(Fully-Managed) 공식 독점 납품 기회를 선점하세요.
        </p>
      </div>
      <div v-if="toast" class="px-4 py-2 rounded-xl bg-emerald-600 text-white font-bold animate-fade-in">
        {{ toast }}
      </div>
    </div>

    <!-- Navigation Tabs -->
    <div class="flex border-b border-gray-200 gap-2">
      <button
        @click="activeTab = 'campaigns'"
        :class="['pb-2.5 px-3 font-bold border-b-2 transition cursor-pointer', activeTab === 'campaigns' ? 'border-[#FF5000] text-[#FF5000]' : 'border-transparent text-gray-500 hover:text-gray-700']"
      >
        진행 중인 역경매 캠페인 ({{ campaigns.length }})
      </button>
      <button
        @click="activeTab = 'my-bids'"
        :class="['pb-2.5 px-3 font-bold border-b-2 transition cursor-pointer', activeTab === 'my-bids' ? 'border-[#FF5000] text-[#FF5000]' : 'border-transparent text-gray-500 hover:text-gray-700']"
      >
        내 입찰 내역 ({{ myBids.length }})
      </button>
      <button
        @click="activeTab = 'negotiations'"
        :class="['pb-2.5 px-3 font-bold border-b-2 transition cursor-pointer', activeTab === 'negotiations' ? 'border-[#FF5000] text-[#FF5000]' : 'border-transparent text-gray-500 hover:text-gray-700']"
      >
        MD 공급가 네고 제안 ({{ negotiations.length }})
      </button>
    </div>

    <div v-if="loading" class="p-12 text-center text-gray-400 font-bold animate-pulse">
      데이터를 불러오는 중입니다...
    </div>

    <!-- Tab 1: Campaigns List -->
    <div v-else-if="activeTab === 'campaigns'" class="space-y-4">
      <div v-if="campaigns.length === 0" class="bg-white rounded-2xl p-12 text-center border border-gray-200 text-gray-400 font-medium">
        현재 진행 중인 공장 소싱 역경매 캠페인이 없습니다.
      </div>
      <div v-else class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        <div
          v-for="c in campaigns"
          :key="c.id"
          class="bg-white rounded-2xl p-5 border border-gray-200/90 hover:border-[#FF5000] hover:shadow-lg transition flex flex-col justify-between"
        >
          <div class="space-y-3">
            <div class="flex items-center justify-between">
              <span class="px-2 py-0.5 rounded bg-orange-100 text-orange-800 font-mono font-bold text-[10px]">
                {{ c.category_id || '카테고리 소싱' }}
              </span>
              <span class="px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 font-black text-[10px]">
                {{ c.status }}
              </span>
            </div>
            <div>
              <h3 class="text-sm font-black text-gray-900">{{ c.title }}</h3>
              <p class="text-gray-500 text-[11px] mt-1">{{ c.notes || '품질 기준 충족 시 즉시 전탁 독점 SKU 배정' }}</p>
            </div>
            <div class="bg-slate-50 rounded-xl p-3 space-y-1.5 border border-slate-100">
              <div class="flex justify-between">
                <span class="text-gray-500">MD 목표 도매가:</span>
                <span class="font-black text-rose-600">{{ won(c.target_wholesale_price) }} 이하</span>
              </div>
              <div class="flex justify-between">
                <span class="text-gray-500">목표 조달 수량:</span>
                <span class="font-bold text-gray-900">{{ Number(c.target_quantity || 0).toLocaleString() }}개</span>
              </div>
              <div class="flex justify-between text-[11px]">
                <span class="text-gray-400">마감 일시:</span>
                <span class="text-gray-600 font-mono">{{ c.deadline_at || '상시 접수' }}</span>
              </div>
            </div>
          </div>

          <button
            @click="openBid(c)"
            class="mt-4 w-full py-2.5 rounded-xl bg-[#FF5000] hover:bg-[#E04600] text-white font-black text-xs transition active:scale-98 cursor-pointer"
          >
            입찰 제안서 제출하기 →
          </button>
        </div>
      </div>
    </div>

    <!-- Tab 2: My Submitted Bids -->
    <div v-else-if="activeTab === 'my-bids'" class="bg-white rounded-2xl border border-gray-200 overflow-hidden shadow-2xs">
      <table class="w-full text-left border-collapse">
        <thead>
          <tr class="bg-gray-50 border-b text-gray-500 uppercase text-[11px] font-bold">
            <th class="py-3 px-4">입찰 번호</th>
            <th class="py-3 px-4">캠페인</th>
            <th class="py-3 px-4 text-right">제시 도매 공급가</th>
            <th class="py-3 px-4 text-center">공급 가능 수량</th>
            <th class="py-3 px-4 text-center">출고 리드타임</th>
            <th class="py-3 px-4 text-center">심사 상태</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="b in myBids" :key="b.id" class="border-b last:border-b-0 hover:bg-slate-50 transition">
            <td class="py-3 px-4 font-mono font-bold text-gray-700">#{{ b.id }}</td>
            <td class="py-3 px-4 font-bold text-gray-900">{{ b.campaign_title || b.campaign_id }}</td>
            <td class="py-3 px-4 text-right font-black text-[#FF5000]">{{ won(b.wholesale_supply_price) }}</td>
            <td class="py-3 px-4 text-center font-bold">{{ Number(b.supply_capacity || 0).toLocaleString() }}개</td>
            <td class="py-3 px-4 text-center">{{ b.delivery_lead_days || 3 }}일 내 출고</td>
            <td class="py-3 px-4 text-center">
              <span
                :class="[
                  'px-2 py-0.5 rounded-full font-bold text-[10px]',
                  b.status === 'ACCEPTED' ? 'bg-emerald-100 text-emerald-800' :
                  b.status === 'REJECTED' ? 'bg-rose-100 text-rose-800' : 'bg-amber-100 text-amber-800'
                ]"
              >
                {{ b.status === 'ACCEPTED' ? '★ 낙찰 확정' : b.status === 'REJECTED' ? '미선정' : '검토 중' }}
              </span>
            </td>
          </tr>
          <tr v-if="myBids.length === 0">
            <td colspan="6" class="py-12 text-center text-gray-400">제출한 입찰 내역이 없습니다.</td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Tab 3: MD Price Negotiations -->
    <div v-else class="space-y-3">
      <div v-if="negotiations.length === 0" class="bg-white rounded-2xl p-12 text-center border border-gray-200 text-gray-400">
        진행 중인 MD 가격 협상 건이 없습니다.
      </div>
      <div v-for="n in negotiations" :key="n.id" class="bg-white rounded-2xl p-5 border border-gray-200 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div class="space-y-1">
          <div class="flex items-center gap-2">
            <span class="font-bold text-gray-900">{{ n.product_title || '등록 상품' }}</span>
            <span class="px-2 py-0.5 rounded bg-indigo-50 text-indigo-700 font-bold text-[10px]">{{ n.status }}</span>
          </div>
          <div class="text-gray-500 text-[11px]">
            기존 도매가 <strong class="text-gray-900">{{ won(n.current_wholesale_price) }}</strong> → MD 제안가 <strong class="text-rose-600">{{ won(n.target_wholesale_price) }}</strong>
          </div>
          <div v-if="n.md_notes" class="text-amber-800 bg-amber-50 px-2.5 py-1 rounded-lg text-[11px] inline-block">
            MD 코멘트: {{ n.md_notes }}
          </div>
        </div>

        <div v-if="n.status === 'PROPOSED'" class="flex items-center gap-2">
          <button
            @click="selectedNego = n; respondNego('ACCEPT')"
            :disabled="submittingNego"
            class="px-3.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-bold"
          >
            제안 수락
          </button>
          <button
            @click="selectedNego = n; showNegoModal = true; counterPrice = n.target_wholesale_price"
            class="px-3.5 py-1.5 rounded-lg border border-gray-300 hover:bg-gray-100 font-bold text-gray-700"
          >
            카운터 오퍼
          </button>
          <button
            @click="selectedNego = n; respondNego('REJECT')"
            class="px-3 py-1.5 rounded-lg text-rose-600 hover:bg-rose-50 font-bold"
          >
            거절
          </button>
        </div>
      </div>
    </div>

    <!-- Bid Submission Modal -->
    <div v-if="showBidModal" class="fixed inset-0 bg-black/50 backdrop-blur-xs flex items-center justify-center z-50 p-4">
      <div class="bg-white rounded-3xl max-w-md w-full p-6 shadow-2xl space-y-4">
        <div class="flex items-center justify-between border-b pb-3">
          <h3 class="text-sm font-black text-gray-900">M2C 역경매 입찰 제안서</h3>
          <button @click="showBidModal = false" class="text-gray-400 font-bold">✕</button>
        </div>

        <div class="bg-orange-50 rounded-xl p-3 border border-orange-200">
          <div class="font-bold text-orange-900">{{ selectedCampaign?.title }}</div>
          <div class="text-[11px] text-orange-700 mt-0.5">MD 목표가: {{ won(selectedCampaign?.target_wholesale_price) }} 이하</div>
        </div>

        <div class="space-y-3">
          <div>
            <label class="block font-bold text-gray-700 mb-1">제시 도매 공급가 (KRW) *</label>
            <input v-model.number="bidWholesalePrice" type="number" class="w-full h-10 px-3 rounded-xl border border-gray-300 font-black text-[#FF5000]" />
          </div>
          <div>
            <label class="block font-bold text-gray-700 mb-1">공급 가능 수량 (Units) *</label>
            <input v-model.number="bidCapacity" type="number" class="w-full h-10 px-3 rounded-xl border border-gray-300 font-bold" />
          </div>
          <div>
            <label class="block font-bold text-gray-700 mb-1">출고 리드타임 (Days) *</label>
            <input v-model.number="bidLeadDays" type="number" class="w-full h-10 px-3 rounded-xl border border-gray-300 font-bold" />
          </div>
          <div>
            <label class="block font-bold text-gray-700 mb-1">제조/품질 특이사항</label>
            <textarea v-model="bidNotes" rows="2" class="w-full p-2.5 rounded-xl border border-gray-300"></textarea>
          </div>
        </div>

        <div class="flex gap-2">
          <button @click="showBidModal = false" class="flex-1 py-2.5 rounded-xl border border-gray-300 font-bold text-gray-600">취소</button>
          <button @click="submitBid" :disabled="submittingBid" class="flex-1 py-2.5 rounded-xl bg-[#FF5000] text-white font-black">
            {{ submittingBid ? '제출 중...' : '입찰 제출' }}
          </button>
        </div>
      </div>
    </div>

    <!-- Counter Offer Modal -->
    <div v-if="showNegoModal" class="fixed inset-0 bg-black/50 backdrop-blur-xs flex items-center justify-center z-50 p-4">
      <div class="bg-white rounded-3xl max-w-sm w-full p-6 shadow-2xl space-y-4">
        <h3 class="text-sm font-black text-gray-900">MD 가격 역제안 (Counter Offer)</h3>
        <div>
          <label class="block font-bold text-gray-700 mb-1">역제안 도매가 (KRW)</label>
          <input v-model.number="counterPrice" type="number" class="w-full h-10 px-3 rounded-xl border border-gray-300 font-bold" />
        </div>
        <div>
          <label class="block font-bold text-gray-700 mb-1">사유 메모</label>
          <input v-model="negoNotes" placeholder="예: 원자재 상승으로 최소 27,000원 납품 가능" class="w-full h-10 px-3 rounded-xl border border-gray-300" />
        </div>
        <div class="flex gap-2">
          <button @click="showNegoModal = false" class="flex-1 py-2.5 rounded-xl border">취소</button>
          <button @click="respondNego('COUNTER', counterPrice)" :disabled="submittingNego" class="flex-1 py-2.5 rounded-xl bg-indigo-600 text-white font-bold">
            역제안 발송
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

