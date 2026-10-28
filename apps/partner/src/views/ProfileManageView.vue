<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { API_BASE, getPartnerHeaders } from '../config';

interface PartnerProfile {
  id: string;
  business_name: string;
  business_reg_number: string;
  commission_rate: number;
  bank_code: string;
  bank_account_number: string;
  bank_account_holder: string;
  settlement_cycle: string;
  return_shipping_address: string;
  customer_service_phone: string;
  base_shipping_fee: number;
  free_shipping_threshold: number;
  status: string;
}

const profile = ref<PartnerProfile>({
  id: '',
  business_name: '',
  business_reg_number: '',
  commission_rate: 10,
  bank_code: '004',
  bank_account_number: '',
  bank_account_holder: '',
  settlement_cycle: 'WEEKLY',
  return_shipping_address: '',
  customer_service_phone: '',
  base_shipping_fee: 3000,
  free_shipping_threshold: 30000,
  status: 'APPROVED'
});

const loading = ref(true);
const isSaving = ref(false);
const toastMsg = ref('');

const bankList = [
  { code: '004', name: 'KB국민은행' },
  { code: '088', name: '신한은행' },
  { code: '020', name: '우리은행' },
  { code: '081', name: '하나은행' },
  { code: '090', name: '카카오뱅크' },
  { code: '092', name: '토스뱅크' },
  { code: '011', name: 'NH농협은행' },
  { code: '003', name: 'IBK기업은행' }
];

async function loadProfile() {
  loading.value = true;
  try {
    const res = await fetch(`${API_BASE}/api/v1/partner/profile`, {
      headers: getPartnerHeaders()
    });
    const json = await res.json();
    if (json.success && json.data) {
      profile.value = json.data;
    }
  } catch (e) {
    console.error('Failed to load partner profile:', e);
  } finally {
    loading.value = false;
  }
}

async function saveProfile() {
  isSaving.value = true;
  try {
    const res = await fetch(`${API_BASE}/api/v1/partner/profile`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...getPartnerHeaders() },
      body: JSON.stringify(profile.value)
    });
    const json = await res.json();
    if (json.success) {
      toastMsg.value = '✓ 정산 계좌 및 배송 설정이 성공적으로 저장되었습니다.';
      setTimeout(() => { toastMsg.value = ''; }, 3500);
    }
  } catch (e) {
    console.error(e);
  } finally {
    isSaving.value = false;
  }
}

onMounted(loadProfile);
</script>

<template>
  <div class="max-w-4xl mx-auto space-y-6">
    <div class="border-b border-slate-200 pb-4">
      <h1 class="text-xl sm:text-2xl font-black text-slate-900 flex items-center gap-2">
        <span>⚙️ 판매자 정보 및 정산·배송 설정</span>
      </h1>
      <p class="text-xs text-slate-500 mt-1">
        정산금 입금 계좌, 고객 반품 수거지 주소, 고객센터 연락처 및 무료배송 기준을 설정합니다.
      </p>
    </div>

    <div v-if="toastMsg" class="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-xs font-bold text-emerald-700 flex items-center gap-2 shadow-xs">
      <i class="fa-solid fa-circle-check"></i>
      <span>{{ toastMsg }}</span>
    </div>

    <div v-if="loading" class="p-16 text-center text-slate-400">
      <i class="fa-solid fa-spinner fa-spin text-3xl mb-3 text-indigo-500"></i>
      <p class="text-xs font-bold">판매자 설정을 불러오는 중입니다...</p>
    </div>

    <form v-else @submit.prevent="saveProfile" class="space-y-6">
      <!-- 1. Basic Merchant Information -->
      <div class="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs space-y-4">
        <h2 class="text-sm font-black text-slate-900 pb-2 border-b border-slate-100 flex items-center gap-2">
          <i class="fa-solid fa-building text-indigo-600"></i>
          <span>기본 사업자 정보 (수수료율 {{ profile.commission_rate }}%)</span>
        </h2>

        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
          <div>
            <label class="block font-bold text-slate-700 mb-1">상호명 (스토어명)</label>
            <input
              v-model="profile.business_name"
              required
              class="w-full border border-slate-300 rounded-xl px-3 py-2 text-xs focus:ring-2 focus:ring-indigo-500 outline-none"
            />
          </div>
          <div>
            <label class="block font-bold text-slate-700 mb-1">사업자등록번호</label>
            <input
              v-model="profile.business_reg_number"
              disabled
              class="w-full border border-slate-200 rounded-xl px-3 py-2 text-xs bg-slate-50 text-slate-400 font-mono"
            />
          </div>
          <div>
            <label class="block font-bold text-slate-700 mb-1">고객센터 전화번호</label>
            <input
              v-model="profile.customer_service_phone"
              placeholder="예: 02-1588-0000"
              class="w-full border border-slate-300 rounded-xl px-3 py-2 text-xs focus:ring-2 focus:ring-indigo-500 outline-none"
            />
          </div>
          <div>
            <label class="block font-bold text-slate-700 mb-1">입점 상태</label>
            <span class="inline-block px-3 py-2 rounded-xl bg-emerald-50 text-emerald-700 font-black text-xs border border-emerald-200">
              ● {{ profile.status }} (정상 가동)
            </span>
          </div>
        </div>
      </div>

      <!-- 2. Settlement Bank Account -->
      <div class="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs space-y-4">
        <h2 class="text-sm font-black text-slate-900 pb-2 border-b border-slate-100 flex items-center gap-2">
          <i class="fa-solid fa-piggy-bank text-emerald-600"></i>
          <span>정산금 지급 은행 계좌 설정</span>
        </h2>

        <div class="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs">
          <div>
            <label class="block font-bold text-slate-700 mb-1">거래 은행</label>
            <select
              v-model="profile.bank_code"
              class="w-full border border-slate-300 rounded-xl px-3 py-2 text-xs bg-white focus:ring-2 focus:ring-indigo-500 outline-none"
            >
              <option v-for="b in bankList" :key="b.code" :value="b.code">{{ b.name }}</option>
            </select>
          </div>
          <div>
            <label class="block font-bold text-slate-700 mb-1">계좌번호 (숫자만)</label>
            <input
              v-model="profile.bank_account_number"
              required
              placeholder="예: 123-456-789012"
              class="w-full border border-slate-300 rounded-xl px-3 py-2 text-xs font-mono focus:ring-2 focus:ring-indigo-500 outline-none"
            />
          </div>
          <div>
            <label class="block font-bold text-slate-700 mb-1">예금주명</label>
            <input
              v-model="profile.bank_account_holder"
              required
              class="w-full border border-slate-300 rounded-xl px-3 py-2 text-xs focus:ring-2 focus:ring-indigo-500 outline-none"
            />
          </div>
          <div class="sm:col-span-3">
            <label class="block font-bold text-slate-700 mb-1">정산 주기</label>
            <select
              v-model="profile.settlement_cycle"
              class="w-full sm:w-64 border border-slate-300 rounded-xl px-3 py-2 text-xs bg-white focus:ring-2 focus:ring-indigo-500 outline-none"
            >
              <option value="WEEKLY">주간 정산 (매주 수요일 지급)</option>
              <option value="BI_WEEKLY">격주 정산 (1일/15일 지급)</option>
              <option value="MONTHLY">월간 정산 (매월 10일 익월 지급)</option>
            </select>
            <p class="text-[11px] text-slate-400 mt-1">* 구매확정된 주문 금액에서 플랫폼 수수료 차감 후 자동 이체됩니다.</p>
          </div>
        </div>
      </div>

      <!-- 3. Logistics & Shipping Policy -->
      <div class="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs space-y-4">
        <h2 class="text-sm font-black text-slate-900 pb-2 border-b border-slate-100 flex items-center gap-2">
          <i class="fa-solid fa-truck-fast text-sky-600"></i>
          <span>배송비 정책 및 반품지 주소</span>
        </h2>

        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
          <div>
            <label class="block font-bold text-slate-700 mb-1">기본 배송비 (원)</label>
            <input
              v-model.number="profile.base_shipping_fee"
              type="number"
              step="500"
              class="w-full border border-slate-300 rounded-xl px-3 py-2 text-xs focus:ring-2 focus:ring-indigo-500 outline-none"
            />
          </div>
          <div>
            <label class="block font-bold text-slate-700 mb-1">스토어 무료배송 조건 (원)</label>
            <input
              v-model.number="profile.free_shipping_threshold"
              type="number"
              step="5000"
              class="w-full border border-slate-300 rounded-xl px-3 py-2 text-xs focus:ring-2 focus:ring-indigo-500 outline-none"
            />
          </div>
          <div class="sm:col-span-2">
            <label class="block font-bold text-slate-700 mb-1">고객 안심반품 수거지 주소</label>
            <input
              v-model="profile.return_shipping_address"
              placeholder="예: 인천광역시 중구 공항동 물류센터 B동 301호"
              class="w-full border border-slate-300 rounded-xl px-3 py-2 text-xs focus:ring-2 focus:ring-indigo-500 outline-none"
            />
          </div>
        </div>
      </div>

      <!-- Action Button -->
      <div class="flex justify-end pt-2">
        <button
          type="submit"
          :disabled="isSaving"
          class="px-8 py-3 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-black text-xs shadow-md transition disabled:opacity-50 cursor-pointer flex items-center gap-2"
        >
          <i class="fa-solid fa-floppy-disk"></i>
          <span>{{ isSaving ? '저장 중...' : '설정 저장하기' }}</span>
        </button>
      </div>
    </form>
  </div>
</template>

