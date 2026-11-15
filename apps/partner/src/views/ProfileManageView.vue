<script setup lang="ts">
// Seller settings (4-9): business identity (read-mostly), payout account
// (change requests need operator real-name verification), return/logistics
// defaults. Shipping policy templates live in ShippingPolicyView.
import { Building, CircleAlert, CircleCheck, LoaderCircle, PiggyBank, Save, Truck } from 'lucide-vue-next'
import { ref, computed, onMounted } from 'vue';
import { API_BASE, getPartnerHeaders } from '../config';
import { userErrorMessage } from '@olmoa/ui'

interface PartnerProfile {
  business_name: string;
  business_reg_number: string;
  representative_name: string;
  mail_order_reg_number: string;
  status: string;
  commission_rate: number;
  business_address: string;
  customer_service_phone: string;
  cs_email: string;
  bank_code: string;
  bank_account_number: string;
  bank_account_holder: string;
  settlement_cycle: string;
  base_shipping_fee: number;
  free_shipping_threshold: number;
  return_shipping_address: string;
  return_shipping_fee: number;
}

const profile = ref<PartnerProfile>({} as PartnerProfile);
const loadedBank = ref({ bank_code: '', bank_account_number: '', bank_account_holder: '' });

// P2-T04: status copy follows the account state.
const statusText = computed(() => ({
  APPROVED: 'APPROVED (정상 가동)',
  PENDING: 'PENDING (심사 대기)',
  SUSPENDED: 'SUSPENDED (판매 중지)',
  REJECTED: 'REJECTED (입점 반려)'
} as Record<string, string>)[profile.value.status] || `${profile.value.status || 'UNKNOWN'} (상태 확인 필요)`);

const loading = ref(true);
const isSaving = ref(false);
const toastMsg = ref('');
const toastErr = ref(false);
// T11: a failed load blocks the form (defaults must never overwrite the server).
const loadError = ref('');

const U = '문제가 발생했습니다. 잠시 후 다시 시도해주세요.';
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
  loadError.value = '';
  try {
    const res = await fetch(`${API_BASE}/api/v1/partner/profile`, {
      headers: getPartnerHeaders()
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json.success) throw new Error(json.error || `설정을 불러오지 못했습니다`);
    profile.value = json.data;
    // T10: legacy underscore value reads as the canonical enum.
    if ((profile.value.settlement_cycle as string) === 'BI_WEEKLY') profile.value.settlement_cycle = 'BIWEEKLY';
    loadedBank.value = { bank_code: json.data.bank_code, bank_account_number: json.data.bank_account_number, bank_account_holder: json.data.bank_account_holder };
  } catch (e: any) {
    loadError.value = userErrorMessage(e, '판매자 설정을 불러오지 못했습니다. 다시 시도해 주세요.');
  } finally {
    loading.value = false;
  }
}

function settingsPayload() {
  const p = profile.value;
  const body: Record<string, unknown> = {
    settlement_cycle: p.settlement_cycle, return_shipping_address: p.return_shipping_address, customer_service_phone: p.customer_service_phone,
    business_address: p.business_address, cs_email: p.cs_email,
    base_shipping_fee: p.base_shipping_fee, free_shipping_threshold: p.free_shipping_threshold, return_shipping_fee: p.return_shipping_fee
  };
  const b = loadedBank.value;
  const bankEdited = p.bank_code !== b.bank_code || p.bank_account_holder !== b.bank_account_holder
    || (p.bank_account_number !== b.bank_account_number && !String(p.bank_account_number).startsWith('****'));
  if (bankEdited) Object.assign(body, { bank_code: p.bank_code, bank_account_number: String(p.bank_account_number).startsWith('****') ? undefined : p.bank_account_number, bank_account_holder: p.bank_account_holder });
  return body;
}

async function saveProfile() {
  isSaving.value = true;
  try {
    const res = await fetch(`${API_BASE}/api/v1/partner/profile`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...getPartnerHeaders() },
      body: JSON.stringify(settingsPayload())
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json.success) throw new Error(json.error || `저장하지 못했습니다. 잠시 후 다시 시도해주세요.`);
    toastErr.value = false;
    toastMsg.value = `✓ ${json.message || '설정이 저장되었습니다.'}`;
    await loadProfile();
    setTimeout(() => { toastMsg.value = ''; }, 3500);
  } catch (e: any) {
    toastErr.value = true;
    toastMsg.value = `저장 실패 — ${userErrorMessage(e, '네트워크 오류')}`;
  } finally {
    isSaving.value = false;
  }
}

onMounted(loadProfile);
</script>

<template>
  <div class="mx-auto max-w-4xl space-y-6">
    <div class="border-b border-line pb-4">
      <h1 class="text-xl font-bold text-ink sm:text-2xl">판매자 정보 및 정산·배송 설정</h1>
      <p class="mt-1 text-xs text-ink-muted">
        정산금 입금 계좌, 고객 반품 수거지 주소, 고객센터 연락처 및 무료배송 기준을 설정합니다.
      </p>
    </div>

    <div v-if="toastMsg" role="status" class="flex items-center gap-2 rounded-xl border p-3.5 text-xs font-bold" :class="toastErr ? 'border-danger bg-danger-soft text-danger' : 'border-success bg-success-soft text-success'">
      <CircleAlert v-if="toastErr" class="h-4 w-4" aria-hidden="true" /><CircleCheck v-else class="h-4 w-4" aria-hidden="true" />
      <span>{{ toastMsg }}</span>
    </div>

    <div v-if="loading" class="p-16 text-center text-ink-subtle">
      <LoaderCircle class="mb-3 h-4 w-4 animate-spin text-3xl text-primary" aria-hidden="true" />
      <p class="text-xs font-bold">판매자 설정을 불러오는 중입니다...</p>
    </div>

    <div v-else-if="loadError" class="rounded-2xl border border-danger bg-surface p-12 text-center" role="alert">
      <h3 class="text-sm font-bold text-danger">{{ U }}</h3>
      <p class="mt-1 text-xs text-ink-muted">{{ loadError }}</p>
      <p class="mt-1 text-xs text-ink-subtle">불러오지 못한 상태에서는 저장할 수 없습니다.</p>
      <button type="button" class="mt-4 rounded-xl bg-secondary px-4 py-2 text-xs font-bold text-secondary-on" @click="loadProfile">다시 불러오기</button>
    </div>

    <form v-else class="space-y-6" @submit.prevent="saveProfile">
      <div class="space-y-4 rounded-2xl border border-line bg-surface p-6">
        <h2 class="flex items-center gap-2 border-b border-line-divider pb-3 text-sm font-bold text-ink">
          <Building class="h-4 w-4 text-ink-muted" aria-hidden="true" />
          <span>기본 사업자 정보 (수수료율 {{ profile.commission_rate }}%)</span>
        </h2>

        <div class="grid grid-cols-1 gap-4 text-xs sm:grid-cols-2">
          <div>
            <label class="mb-1 block font-bold text-ink-muted">상호명 (스토어명)</label>
            <input v-model="profile.business_name" disabled class="w-full cursor-not-allowed rounded-xl border border-line bg-surface-2 px-3 py-2 text-xs text-ink-subtle" />
            <p class="mt-1 text-2xs text-ink-subtle">상호 변경은 사업자등록증 재심사가 필요합니다. 고객센터로 요청해 주세요.</p>
          </div>
          <div>
            <label class="mb-1 block font-bold text-ink-muted">사업자등록번호</label>
            <input v-model="profile.business_reg_number" disabled class="w-full cursor-not-allowed rounded-xl border border-line bg-surface-2 px-3 py-2 font-mono text-xs text-ink-subtle" />
          </div>
          <div>
            <label class="mb-1 block font-bold text-ink-muted">대표자명</label>
            <input v-model="profile.representative_name" disabled class="w-full cursor-not-allowed rounded-xl border border-line bg-surface-2 px-3 py-2 text-xs text-ink-subtle" />
            <p class="mt-1 text-2xs text-ink-subtle">대표자명 변경은 사업자등록증 재심사가 필요합니다. 고객센터로 요청해 주세요.</p>
          </div>
          <div>
            <label class="mb-1 block font-bold text-ink-muted">통신판매업 신고번호</label>
            <input v-model="profile.mail_order_reg_number" disabled class="w-full cursor-not-allowed rounded-xl border border-line bg-surface-2 px-3 py-2 font-mono text-xs text-ink-subtle" />
          </div>
          <div class="sm:col-span-2">
            <label class="mb-1 block font-bold text-ink-muted">사업장 주소 (스토어 공개)</label>
            <input v-model="profile.business_address" placeholder="예: 서울특별시 강남구 사업로 2" class="h-10 w-full rounded-xl border border-line bg-surface px-3 text-xs text-ink focus:outline-none focus:ring-2 focus-visible:ring-focus" />
          </div>
          <div>
            <label class="mb-1 block font-bold text-ink-muted">고객센터 전화번호 (스토어 공개)</label>
            <input v-model="profile.customer_service_phone" placeholder="예: 02-1588-0000" class="h-10 w-full rounded-xl border border-line bg-surface px-3 text-xs text-ink focus:outline-none focus:ring-2 focus-visible:ring-focus" />
          </div>
          <div>
            <label class="mb-1 block font-bold text-ink-muted">고객센터 이메일 (스토어 공개)</label>
            <input v-model="profile.cs_email" type="email" placeholder="example@olmoa.com" class="h-10 w-full rounded-xl border border-line bg-surface px-3 text-xs text-ink focus:outline-none focus:ring-2 focus-visible:ring-focus" />
          </div>
          <div>
            <label class="mb-1 block font-bold text-ink-muted">입점 상태</label>
            <span class="inline-block rounded-xl border px-3 py-2 text-xs font-bold" :class="profile.status === 'APPROVED' ? 'border-success bg-success-soft text-success' : profile.status === 'SUSPENDED' || profile.status === 'REJECTED' ? 'border-danger bg-danger-soft text-danger' : 'border-warning bg-warning-soft text-warning'">
              ● {{ statusText }}
            </span>
          </div>
        </div>
      </div>

      <div class="space-y-4 rounded-2xl border border-line bg-surface p-6">
        <h2 class="flex items-center gap-2 border-b border-line-divider pb-3 text-sm font-bold text-ink">
          <PiggyBank class="h-4 w-4 text-ink-muted" aria-hidden="true" />
          <span>정산금 지급 은행 계좌 설정</span>
        </h2>
        <p class="rounded-xl border border-warning bg-warning-soft p-3 text-xs font-bold text-warning">계좌 변경은 운영자 실명 확인 후 반영됩니다. 확인 전까지 기존 계좌로 지급됩니다.</p>

        <div class="grid grid-cols-1 gap-4 text-xs sm:grid-cols-3">
          <div>
            <label class="mb-1 block font-bold text-ink-muted">거래 은행</label>
            <select v-model="profile.bank_code" class="h-10 w-full rounded-xl border border-line bg-surface px-3 text-xs text-ink">
              <option v-for="b in bankList" :key="b.code" :value="b.code">{{ b.name }}</option>
            </select>
          </div>
          <div>
            <label class="mb-1 block font-bold text-ink-muted">계좌번호 (숫자만)</label>
            <input v-model="profile.bank_account_number" required placeholder="예: 123-456-789012" class="h-10 w-full rounded-xl border border-line bg-surface px-3 font-mono text-xs text-ink focus:outline-none focus:ring-2 focus-visible:ring-focus" />
          </div>
          <div>
            <label class="mb-1 block font-bold text-ink-muted">예금주명</label>
            <input v-model="profile.bank_account_holder" required class="h-10 w-full rounded-xl border border-line bg-surface px-3 text-xs text-ink focus:outline-none focus:ring-2 focus-visible:ring-focus" />
          </div>
          <div class="sm:col-span-3">
            <label class="mb-1 block font-bold text-ink-muted">정산 주기</label>
            <select v-model="profile.settlement_cycle" class="h-10 w-full rounded-xl border border-line bg-surface px-3 text-xs text-ink sm:w-64">
              <option value="WEEKLY">주간 정산 (매주 수요일 지급)</option>
              <option value="BIWEEKLY">격주 정산 (1일/15일 지급)</option>
              <option value="MONTHLY">월간 정산 (매월 10일 익월 지급)</option>
            </select>
            <p class="mt-1 text-2xs text-ink-subtle">* 구매확정된 주문 금액에서 플랫폼 수수료 차감 후 자동 이체됩니다.</p>
          </div>
        </div>
      </div>

      <div class="space-y-4 rounded-2xl border border-line bg-surface p-6">
        <h2 class="flex items-center gap-2 border-b border-line-divider pb-3 text-sm font-bold text-ink">
          <Truck class="h-4 w-4 text-ink-muted" aria-hidden="true" />
          <span>배송비 정책 및 반품지 주소</span>
        </h2>

        <div class="grid grid-cols-1 gap-4 text-xs sm:grid-cols-2">
          <div>
            <label class="mb-1 block font-bold text-ink-muted">기본 배송비 (원)</label>
            <input v-model.number="profile.base_shipping_fee" type="number" step="500" class="h-10 w-full rounded-xl border border-line bg-surface px-3 text-xs text-ink" />
          </div>
          <div>
            <label class="mb-1 block font-bold text-ink-muted">스토어 무료배송 조건 (원)</label>
            <input v-model.number="profile.free_shipping_threshold" type="number" step="5000" class="h-10 w-full rounded-xl border border-line bg-surface px-3 text-xs text-ink" />
          </div>
          <div>
            <label class="mb-1 block font-bold text-ink-muted">반품 배송비 · 편도 (원)</label>
            <input v-model.number="profile.return_shipping_fee" type="number" min="0" step="500" class="h-10 w-full rounded-xl border border-line bg-surface px-3 text-xs text-ink" />
            <p class="mt-1 text-2xs text-ink-muted">단순변심·사이즈 반품 때 환불액에서 차감됩니다 (무료배송 주문 전체 반품은 기본 배송비를 더해 왕복). 주문 화면에 미리 표시됩니다.</p>
          </div>
          <div class="sm:col-span-2">
            <label class="mb-1 block font-bold text-ink-muted">고객 안심반품 수거지 주소</label>
            <input v-model="profile.return_shipping_address" placeholder="예: 인천광역시 중구 공항동 물류센터 B동 301호" class="h-10 w-full rounded-xl border border-line bg-surface px-3 text-xs text-ink" />
          </div>
        </div>
      </div>

      <div class="flex justify-end pt-2">
        <button type="submit" :disabled="isSaving" class="flex cursor-pointer items-center gap-2 rounded-xl bg-primary px-8 py-3 text-xs font-bold text-primary-on shadow-md transition hover:bg-primary-hover disabled:opacity-50">
          <Save class="h-4 w-4" aria-hidden="true" />
          <span>{{ isSaving ? '저장 중...' : '설정 저장하기' }}</span>
        </button>
      </div>
    </form>

    <div class="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-line bg-surface p-6">
      <div>
        <h2 class="text-sm font-bold text-ink">배송·반품 템플릿</h2>
        <p class="mt-1 text-xs text-ink-muted">상품별 배송비 템플릿은 별도 화면에서 관리합니다.</p>
      </div>
      <RouterLink to="/store/shipping-policies" class="rounded-xl bg-secondary px-4 py-2 text-xs font-bold text-secondary-on hover:bg-secondary-hover">템플릿 관리로 이동</RouterLink>
    </div>
  </div>
</template>
