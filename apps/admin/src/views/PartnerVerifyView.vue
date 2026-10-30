<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { API_BASE_URL, getAdminHeaders } from '../config';

interface Partner {
  id: string;
  business_name: string;
  business_reg_number: string;
  partner_type?: string;
  country_code?: string;
  kyc_status?: string;
  risk_tier?: string;
  rolling_reserve_pct?: number;
  settlement_currency?: string;
  payout_channel?: string;
  kyc_notes?: string;
  created_at: string;
  commission_rate: number;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'SUSPENDED';
}

const partners = ref<Partner[]>([]);
const loading = ref(true);
const isProcessing = ref<string | null>(null);
const selectedRiskTier = ref<Record<string, string>>({});
const toastMsg = ref('');

async function loadPartners() {
  loading.value = true;
  try {
    const res = await fetch(`${API_BASE_URL}/api/v1/admin/partners`, {
      headers: getAdminHeaders()
    });
    const json = await res.json();
    if (json.success && json.data) {
      partners.value = json.data;
      for (const p of partners.value) {
        selectedRiskTier.value[p.id] = p.risk_tier || 'TIER_1_NORMAL';
      }
    }
  } catch (_) {
  } finally {
    loading.value = false;
  }
}

async function verify(p: Partner, newStatus: 'APPROVED' | 'REJECTED' | 'SUSPENDED') {
  isProcessing.value = p.id;
  const tier = selectedRiskTier.value[p.id] || 'TIER_1_NORMAL';
  const reserve = tier === 'TIER_3_HIGH_RISK' ? 10.0 : tier === 'TIER_2_WATCH' ? 5.0 : 0.0;

  try {
    const res = await fetch(`${API_BASE_URL}/api/v1/admin/partners/${p.id}/verify`, {
      method: 'PUT',
      headers: getAdminHeaders(),
      body: JSON.stringify({
        status: newStatus,
        risk_tier: tier,
        rolling_reserve_pct: reserve,
        kyc_notes: `관리자 심사 조치 (${newStatus} / ${tier})`
      })
    });
    if (res.ok) {
      p.status = newStatus;
      p.risk_tier = tier;
      p.rolling_reserve_pct = reserve;
      toastMsg.value = `✓ [${p.business_name}] 파트너가 ${newStatus} (위험등급: ${tier}, 유보금: ${reserve}%) 처리되었습니다.`;
      setTimeout(() => { toastMsg.value = ''; }, 3500);
    }
  } catch (_) {
  } finally {
    isProcessing.value = null;
  }
}

onMounted(() => {
  loadPartners();
});
</script>

<template>
  <div class="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-4">
    <div class="flex flex-wrap items-center justify-between gap-3 border-b pb-3">
      <div>
        <h2 class="text-base font-bold text-slate-900 flex items-center gap-2">
          <span>글로벌 파트너 입점 & KYC 심사 데스크</span>
          <span class="px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-600 text-[10px] font-bold">Global KYB & Rolling Reserve</span>
        </h2>
        <p class="text-xs text-slate-500 mt-0.5">국내/해외 크로스보더 셀러 자격 심사, 위험 등급(Risk Tier) 및 정산 롤링 리저브(유보금) 비율을 관리합니다.</p>
      </div>
      <button @click="loadPartners" class="text-xs text-indigo-600 font-bold hover:underline cursor-pointer">
        <i class="fa-solid fa-rotate mr-1"></i>새로고침
      </button>
    </div>

    <div v-if="toastMsg" class="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs font-bold">
      {{ toastMsg }}
    </div>

    <div v-if="loading" class="p-12 text-center text-slate-400 text-xs">
      <i class="fa-solid fa-spinner fa-spin mr-2"></i>파트너사 목록을 불러오는 중...
    </div>

    <div v-else class="overflow-x-auto text-xs">
      <table class="w-full text-left">
        <thead class="bg-slate-50 text-slate-500 uppercase border-b text-[10px]">
          <tr>
            <th class="p-3">파트너 상호명 (국가)</th>
            <th class="p-3">사업자/법인번호</th>
            <th class="p-3">정산 통화/채널</th>
            <th class="p-3">수수료</th>
            <th class="p-3">위험 등급 (Rolling Reserve)</th>
            <th class="p-3">상태</th>
            <th class="p-3 text-right">KYC 심사 조치</th>
          </tr>
        </thead>
        <tbody class="divide-y text-slate-700">
          <tr v-for="p in partners" :key="p.id" class="hover:bg-slate-50">
            <td class="p-3">
              <div class="font-bold text-slate-900">{{ p.business_name }}</div>
              <div class="text-[10px] text-slate-400 mt-0.5">
                <span class="px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 font-mono font-bold mr-1">
                  {{ p.country_code || 'KR' }}
                </span>
                <span>{{ p.partner_type === 'CROSS_BORDER' ? '해외 글로벌 셀러' : '국내 법인/개인' }}</span>
              </div>
            </td>
            <td class="p-3 font-mono">{{ p.business_reg_number }}</td>
            <td class="p-3">
              <span class="font-bold text-slate-800">{{ p.settlement_currency || 'KRW' }}</span>
              <span class="text-[10px] text-slate-400 block">{{ p.payout_channel || 'LOCAL_BANK' }}</span>
            </td>
            <td class="p-3 font-bold text-blue-600">{{ p.commission_rate }}%</td>
            <td class="p-3">
              <select
                v-model="selectedRiskTier[p.id]"
                class="border border-slate-300 rounded-lg px-2 py-1 text-[11px] font-bold bg-white"
              >
                <option value="TIER_1_NORMAL">정상 (유보금 0%)</option>
                <option value="TIER_2_WATCH">주의 (리저브 5%)</option>
                <option value="TIER_3_HIGH_RISK">고위험 (리저브 10%)</option>
              </select>
            </td>
            <td class="p-3">
              <span
                :class="{
                  'bg-emerald-100 text-emerald-800': p.status === 'APPROVED',
                  'bg-amber-100 text-amber-800': p.status === 'PENDING',
                  'bg-rose-100 text-rose-800': p.status === 'REJECTED' || p.status === 'SUSPENDED'
                }"
                class="px-2 py-0.5 rounded-full text-[10px] font-bold"
              >
                {{ p.status }}
              </span>
            </td>
            <td class="p-3 text-right">
              <div class="flex gap-1.5 justify-end">
                <button
                  @click="verify(p, 'APPROVED')"
                  :disabled="isProcessing === p.id"
                  class="px-2.5 py-1 bg-indigo-600 text-white rounded-lg font-bold text-[11px] hover:bg-indigo-700 disabled:opacity-50 cursor-pointer"
                >
                  승인/등급적용
                </button>
                <button
                  v-if="p.status !== 'SUSPENDED'"
                  @click="verify(p, 'SUSPENDED')"
                  :disabled="isProcessing === p.id"
                  class="px-2.5 py-1 bg-rose-50 text-rose-600 border border-rose-200 rounded-lg font-bold text-[11px] hover:bg-rose-100 disabled:opacity-50 cursor-pointer"
                >
                  정지
                </button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
