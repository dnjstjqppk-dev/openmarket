<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { API_BASE_URL, getAdminHeaders } from '../config';
import { useConfirm } from '@olmoa/ui'

const { confirm } = useConfirm()

interface RemoteZone {
  postal_prefix: string;
  zone_name: string;
  surcharge_amount: number;
  updated_at: string;
}

const zones = ref<RemoteZone[]>([]);
const loading = ref(true);
const loadError = ref('');
const form = ref({ postal_prefix: '', zone_name: '', surcharge_amount: 3000 });
const formError = ref('');
const toast = ref('');

async function loadZones() {
  loading.value = true;
  loadError.value = '';
  try {
    const res = await fetch(`${API_BASE_URL}/api/v1/admin/shipping/remote-zones`, {
      headers: getAdminHeaders()
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || json.success === false) throw new Error(json.error || `조회 실패 (${res.status})`);
    zones.value = Array.isArray(json.data) ? json.data : [];
  } catch (e: any) {
    loadError.value = e?.message || '지역 목록을 불러오지 못했습니다.';
  } finally {
    loading.value = false;
  }
}

async function saveZone() {
  formError.value = '';
  if (!/^\d{2,5}$/.test(form.value.postal_prefix.trim())) {
    formError.value = '우편번호 앞자리는 숫자 2-5자리여야 합니다.';
    return;
  }
  if (!form.value.zone_name.trim()) {
    formError.value = '지역명을 입력해 주세요.';
    return;
  }
  const amount = Number(form.value.surcharge_amount);
  if (!Number.isSafeInteger(amount) || amount < 0 || amount > 100000) {
    formError.value = '추가배송비는 0-100,000원으로 입력해 주세요.';
    return;
  }
  try {
    const res = await fetch(`${API_BASE_URL}/api/v1/admin/shipping/remote-zones`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...getAdminHeaders() },
      body: JSON.stringify({ postal_prefix: form.value.postal_prefix.trim(), zone_name: form.value.zone_name.trim(), surcharge_amount: amount })
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || json.success === false) throw new Error(json.error || `저장 실패 (${res.status})`);
    form.value = { postal_prefix: '', zone_name: '', surcharge_amount: 3000 };
    toast.value = '도서산간 지역을 저장했습니다. 다음 주문부터 즉시 적용됩니다.';
    setTimeout(() => { toast.value = ''; }, 3500);
    await loadZones();
  } catch (e: any) {
    formError.value = e?.message || '저장에 실패했습니다.';
  }
}

async function deleteZone(prefix: string) {
  if (!(await confirm({ title: '지역 삭제', body: `우편번호 앞자리 '${prefix}' 지역을 삭제할까요? 해당 지역 주문에는 추가배송비가 붙지 않습니다.`, danger: true }))) return;
  try {
    const res = await fetch(`${API_BASE_URL}/api/v1/admin/shipping/remote-zones/${encodeURIComponent(prefix)}`, {
      method: 'DELETE',
      headers: getAdminHeaders()
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || json.success === false) throw new Error(json.error || `삭제 실패 (${res.status})`);
    toast.value = '지역을 삭제했습니다.';
    setTimeout(() => { toast.value = ''; }, 3500);
    await loadZones();
  } catch (e: any) {
    toast.value = e?.message || '삭제에 실패했습니다.';
    setTimeout(() => { toast.value = ''; }, 4000);
  }
}

onMounted(loadZones);
</script>

<template>
  <div class="max-w-4xl mx-auto px-4 py-6 space-y-5 text-xs">
    <div>
      <h1 class="text-xl font-black text-gray-900">도서산간 추가배송비</h1>
      <p class="text-gray-500 mt-1">우편번호 앞자리(2-5자리) 최장일치로 지역을 판정합니다. 무료배송 주문에도 판매자별로 가산됩니다.</p>
    </div>
    <p v-if="toast" role="status" class="p-3 rounded-lg bg-indigo-50 text-indigo-900 font-bold">{{ toast }}</p>

    <section class="bg-white rounded-xl border p-4 space-y-3">
      <h2 class="font-black text-sm">지역 등록/수정</h2>
      <div class="grid sm:grid-cols-4 gap-2">
        <label class="block"><span class="font-bold">우편번호 앞자리 *</span><input v-model="form.postal_prefix" placeholder="예: 63" class="w-full h-9 px-2 rounded border" /></label>
        <label class="block"><span class="font-bold">지역명 *</span><input v-model="form.zone_name" placeholder="예: 제주" class="w-full h-9 px-2 rounded border" /></label>
        <label class="block"><span class="font-bold">추가배송비(원) *</span><input v-model.number="form.surcharge_amount" type="number" min="0" max="100000" class="w-full h-9 px-2 rounded border" /></label>
        <div class="flex items-end"><button @click="saveZone" class="h-9 w-full rounded-lg bg-slate-900 text-white font-bold">저장</button></div>
      </div>
      <p v-if="formError" role="alert" class="text-red-600 font-bold">{{ formError }}</p>
    </section>

    <section class="bg-white rounded-xl border p-4">
      <h2 class="font-black text-sm mb-2">등록된 지역 ({{ zones.length }})</h2>
      <p v-if="loading" class="text-gray-500">불러오는 중...</p>
      <div v-else-if="loadError" class="space-y-2">
        <p role="alert" class="text-red-600 font-bold">{{ loadError }}</p>
        <button @click="loadZones" class="px-3 py-1.5 rounded border font-bold">다시 시도</button>
      </div>
      <p v-else-if="!zones.length" class="text-gray-500">등록된 도서산간 지역이 없습니다.</p>
      <table v-else class="w-full text-left">
        <thead class="text-slate-500"><tr><th class="p-1">앞자리</th><th class="p-1">지역명</th><th class="p-1">추가배송비</th><th></th></tr></thead>
        <tbody>
          <tr v-for="z in zones" :key="z.postal_prefix" class="border-t">
            <td class="p-1 font-mono font-bold">{{ z.postal_prefix }}</td>
            <td class="p-1">{{ z.zone_name }}</td>
            <td class="p-1 tabular-nums">{{ Number(z.surcharge_amount).toLocaleString() }}원</td>
            <td class="p-1 text-right"><button @click="deleteZone(z.postal_prefix)" class="px-2 py-1 rounded border text-red-600 font-bold">삭제</button></td>
          </tr>
        </tbody>
      </table>
    </section>
  </div>
</template>
