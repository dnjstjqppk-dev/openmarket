<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { API_BASE_URL, getAdminHeaders } from '../config';

interface Partner {
  id: string;
  business_name: string;
  business_reg_number: string;
  created_at: string;
  commission_rate: number;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'SUSPENDED';
}

const partners = ref<Partner[]>([]);
const loading = ref(true);
const isProcessing = ref<string | null>(null);

async function loadPartners() {
  loading.value = true;
  try {
    const res = await fetch(`${API_BASE_URL}/api/v1/admin/partners`, {
      headers: getAdminHeaders()
    });
    const json = await res.json();
    if (json.success && json.data) {
      partners.value = json.data;
    }
  } catch (_) {
  } finally {
    loading.value = false;
  }
}

async function verify(p: Partner, newStatus: 'APPROVED' | 'REJECTED') {
  isProcessing.value = p.id;
  try {
    const res = await fetch(`${API_BASE_URL}/api/v1/admin/partners/${p.id}/verify`, {
      method: 'PUT',
      headers: getAdminHeaders(),
      body: JSON.stringify({ status: newStatus })
    });
    if (res.ok) {
      p.status = newStatus;
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
    <div class="flex items-center justify-between border-b pb-3">
      <div>
        <h2 class="text-base font-bold text-slate-900">입점 파트너사 서류 심사 및 승인</h2>
        <p class="text-xs text-slate-500 mt-0.5">D1 데이터베이스에 등록된 글로벌 판매자 자격 및 사업자 인증 관리</p>
      </div>
      <button @click="loadPartners" class="text-xs text-indigo-600 font-bold hover:underline">
        <i class="fa-solid fa-rotate mr-1"></i>새로고침
      </button>
    </div>

    <div v-if="loading" class="p-12 text-center text-slate-400 text-xs">
      <i class="fa-solid fa-spinner fa-spin mr-2"></i>파트너사 목록을 불러오는 중...
    </div>

    <div v-else class="overflow-x-auto text-xs">
      <table class="w-full text-left">
        <thead class="bg-slate-50 text-slate-500 uppercase border-b text-[10px]">
          <tr>
            <th class="p-3">파트너 상호명</th>
            <th class="p-3">사업자등록번호</th>
            <th class="p-3">등록일시</th>
            <th class="p-3">플랫폼 수수료</th>
            <th class="p-3">상태</th>
            <th class="p-3 text-right">심사 조치</th>
          </tr>
        </thead>
        <tbody class="divide-y text-slate-700">
          <tr v-for="p in partners" :key="p.id" class="hover:bg-slate-50">
            <td class="p-3 font-bold text-slate-900">{{ p.business_name }}</td>
            <td class="p-3 font-mono">{{ p.business_reg_number }}</td>
            <td class="p-3 font-mono">{{ p.created_at }}</td>
            <td class="p-3 font-bold text-blue-600">{{ p.commission_rate }}%</td>
            <td class="p-3">
              <span 
                :class="p.status === 'APPROVED' ? 'bg-green-100 text-green-800' : 'bg-orange-100 text-orange-800'" 
                class="px-2 py-0.5 rounded-full text-[10px] font-bold"
              >
                {{ p.status }}
              </span>
            </td>
            <td class="p-3 text-right">
              <div v-if="p.status === 'PENDING'" class="flex gap-1 justify-end">
                <button 
                  @click="verify(p, 'APPROVED')" 
                  :disabled="isProcessing === p.id"
                  class="bg-blue-600 hover:bg-blue-700 text-white font-bold px-3 py-1 rounded text-xs transition disabled:opacity-50"
                >
                  승인
                </button>
                <button 
                  @click="verify(p, 'REJECTED')" 
                  :disabled="isProcessing === p.id"
                  class="bg-rose-600 hover:bg-rose-700 text-white font-bold px-2 py-1 rounded text-xs transition disabled:opacity-50"
                >
                  반려
                </button>
              </div>
              <span v-else class="text-slate-400 font-medium">심사 완료 ({{ p.status }})</span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
