<script setup lang="ts">
import { LoaderCircle } from 'lucide-vue-next'
import { ref, onMounted } from 'vue';
import { API_BASE_URL, getAdminHeaders } from '../config';
import { OmButton, OmEmptyState, useConfirm } from '@olmoa/ui'

const { confirm } = useConfirm()

interface Coupon {
  id: string;
  code: string;
  title: string;
  discount_type: 'PERCENT' | 'FIXED_AMOUNT';
  discount_value: number;
  min_order_amount: number;
  max_discount_amount?: number;
  expires_at: string;
  is_active: number;
}

// A-N02: every PERCENT coupon must carry a cap — an uncapped percent coupon
// discounts up to 90% of any order. 50000 is the house default.
const PERCENT_DEFAULT_CAP = 50000;

const coupons = ref<Coupon[]>([]);
const loading = ref(true);
const formError = ref('');
const form = ref({
  code: '',
  title: '',
  discount_type: 'FIXED_AMOUNT' as 'PERCENT' | 'FIXED_AMOUNT',
  discount_value: 0,
  min_order_amount: 0,
  max_discount_amount: null as number | null,
  expires_at: ''
});

function onDiscountTypeChange() {
  formError.value = '';
  if (form.value.discount_type === 'PERCENT' && form.value.max_discount_amount === null) {
    form.value.max_discount_amount = PERCENT_DEFAULT_CAP;
  }
}

async function loadCoupons() {
  loading.value = true;
  try {
    const res = await fetch(`${API_BASE_URL}/api/v1/admin/coupons`, {
      headers: getAdminHeaders()
    });
    const json = await res.json();
    if (json.success && json.data) {
      coupons.value = json.data;
    }
  } catch (_) {
  } finally {
    loading.value = false;
  }
}

async function createCoupon() {
  formError.value = '';
  if (!form.value.code || !form.value.title) return;
  if (form.value.discount_type === 'PERCENT') {
    if (form.value.max_discount_amount === null || Number(form.value.max_discount_amount) <= 0) {
      form.value.max_discount_amount = PERCENT_DEFAULT_CAP;
    }
    if (!(Number(form.value.max_discount_amount) > 0)) {
      formError.value = '정률(%) 쿠폰은 최대 할인금액(상한) 입력이 필수입니다.';
      return;
    }
  }
  try {
    const res = await fetch(`${API_BASE_URL}/api/v1/admin/coupons`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getAdminHeaders() },
      body: JSON.stringify(form.value)
    });
    if (res.ok) {
      form.value = { code: '', title: '', discount_type: 'FIXED_AMOUNT', discount_value: 0, min_order_amount: 0, max_discount_amount: null, expires_at: '' };
      await loadCoupons();
    } else {
      const errJson = await res.json().catch(() => ({}));
      formError.value = errJson.error || '쿠폰 생성에 실패했습니다.';
    }
  } catch (_) {
    formError.value = '쿠폰 생성 중 네트워크 오류가 발생했습니다.';
  }
}

async function deleteCoupon(id: string) {
  if (!(await confirm({ title: '쿠폰 삭제', body: '쿠폰을 삭제하시겠습니까?', danger: true }))) return;
  try {
    const res = await fetch(`${API_BASE_URL}/api/v1/admin/coupons/${id}`, {
      method: 'DELETE',
      headers: getAdminHeaders()
    });
    if (res.ok) {
      coupons.value = coupons.value.filter(c => c.id !== id);
    }
  } catch (_) {
  }
}

onMounted(loadCoupons);
</script>

<template>
  <div class="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-6">
    <div class="border-b pb-3">
      <h2 class="text-base font-bold text-slate-900">쿠폰 관리</h2>
      <p class="text-xs text-slate-500 mt-0.5">프로모션 쿠폰을 생성하고 관리합니다.</p>
    </div>

    <!-- Create Form -->
    <div class="grid grid-cols-1 sm:grid-cols-4 gap-3 text-xs">
      <input v-model="form.code" placeholder="쿠폰 코드" class="border border-slate-300 rounded-lg px-2 py-1.5" />
      <input v-model="form.title" placeholder="쿠폰 제목" class="border border-slate-300 rounded-lg px-2 py-1.5" />
      <select v-model="form.discount_type" @change="onDiscountTypeChange" class="border border-slate-300 rounded-lg px-2 py-1.5 bg-white">
        <option value="FIXED_AMOUNT">정액 (원)</option>
        <option value="PERCENT">정률 (%)</option>
      </select>
      <input v-model.number="form.discount_value" type="number" placeholder="할인값" class="border border-slate-300 rounded-lg px-2 py-1.5" />
      <input v-model.number="form.min_order_amount" type="number" placeholder="최소 주문금액" class="border border-slate-300 rounded-lg px-2 py-1.5" />
      <label class="flex flex-col gap-1">
        <span class="font-bold text-slate-600">최대 할인금액(상한){{ form.discount_type === 'PERCENT' ? ' — 정률 필수' : ' (선택)' }}</span>
        <input v-model.number="form.max_discount_amount" type="number" min="0" step="1000" :placeholder="form.discount_type === 'PERCENT' ? '50000' : '상한 없음'" class="border border-slate-300 rounded-lg px-2 py-1.5" />
      </label>
      <input v-model="form.expires_at" type="date" class="border border-slate-300 rounded-lg px-2 py-1.5" />
      <button @click="createCoupon" class="bg-indigo-600 text-white rounded-lg px-3 py-1.5 font-bold hover:bg-indigo-700">
        쿠폰 생성
      </button>
    </div>
    <p v-if="formError" role="alert" class="text-xs font-bold text-rose-600">{{ formError }}</p>

    <div v-if="loading" class="p-12 text-center text-slate-400 text-xs">
      <LoaderCircle class="h-4 w-4 animate-spin mr-2" aria-hidden="true" />쿠폰 목록을 불러오는 중...
    </div>

    <div v-else class="overflow-x-auto text-xs">
      <table class="w-full text-left">
        <thead class="bg-slate-50 text-slate-500 uppercase border-b text-[10px]">
          <tr>
            <th class="p-3">코드</th>
            <th class="p-3">제목</th>
            <th class="p-3">할인</th>
            <th class="p-3">최소주문</th>
            <th class="p-3">만료일</th>
            <th class="p-3">관리</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-slate-100">
          <tr v-for="c in coupons" :key="c.id" class="hover:bg-slate-50">
            <td class="p-3 font-mono font-bold text-slate-700">{{ c.code }}</td>
            <td class="p-3 text-slate-900">{{ c.title }}</td>
            <td class="p-3 text-slate-600">{{ c.discount_type === 'PERCENT' ? c.discount_value + '%' : '₩' + Number(c.discount_value).toLocaleString() }}</td>
            <td class="p-3 text-slate-500">₩{{ Number(c.min_order_amount).toLocaleString() }}</td>
            <td class="p-3 text-slate-400">{{ c.expires_at }}</td>
            <td class="p-3">
              <button @click="deleteCoupon(c.id)" class="text-rose-600 font-bold hover:underline">삭제</button>
            </td>
          </tr>
        </tbody>
      </table>
      <OmEmptyState
        v-if="coupons.length === 0"
        compact
        title="등록된 쿠폰이 없습니다."
        description="상단 양식으로 첫 쿠폰을 만들어 보세요."
      >
        <OmButton size="sm" @click="loadCoupons">다시 불러오기</OmButton>
      </OmEmptyState>
    </div>
  </div>
</template>
