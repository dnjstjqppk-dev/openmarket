<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { API_BASE_URL, getAdminHeaders } from '../config';

interface AdminUser {
  id: string;
  email: string;
  full_name: string;
  phone: string;
  role: string;
  is_active: number;
  created_at: string;
  order_count: number;
}

const users = ref<AdminUser[]>([]);
const loading = ref(true);
const searchQuery = ref('');

async function loadUsers() {
  loading.value = true;
  try {
    const res = await fetch(`${API_BASE_URL}/api/v1/admin/users`, {
      headers: getAdminHeaders()
    });
    const json = await res.json();
    if (json.success && json.data) {
      users.value = json.data;
    }
  } catch (_) {
  } finally {
    loading.value = false;
  }
}

const filteredUsers = computed(() => {
  const q = searchQuery.value.trim().toLowerCase();
  if (!q) return users.value;
  return users.value.filter(u =>
    (u.email || '').toLowerCase().includes(q) ||
    (u.full_name || '').toLowerCase().includes(q) ||
    (u.id || '').toLowerCase().includes(q)
  );
});

onMounted(loadUsers);
</script>

<template>
  <div class="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-4">
    <div class="flex items-center justify-between border-b pb-3">
      <div>
        <h2 class="text-base font-bold text-slate-900">회원 관리</h2>
        <p class="text-xs text-slate-500 mt-0.5">가입 고객 계정과 주문 수를 모니터링합니다.</p>
      </div>
      <div class="flex items-center gap-2">
        <input v-model="searchQuery" placeholder="이메일/이름 검색" class="text-xs border border-slate-300 rounded-lg px-2 py-1.5" />
        <button @click="loadUsers" class="text-xs text-indigo-600 font-bold hover:underline">
          <i class="fa-solid fa-rotate mr-1"></i>새로고침
        </button>
      </div>
    </div>

    <div v-if="loading" class="p-12 text-center text-slate-400 text-xs">
      <i class="fa-solid fa-spinner fa-spin mr-2"></i>회원 목록을 불러오는 중...
    </div>

    <div v-else class="overflow-x-auto text-xs">
      <table class="w-full text-left">
        <thead class="bg-slate-50 text-slate-500 uppercase border-b text-[10px]">
          <tr>
            <th class="p-3">회원 ID</th>
            <th class="p-3">이름</th>
            <th class="p-3">이메일</th>
            <th class="p-3">연락처</th>
            <th class="p-3">권한</th>
            <th class="p-3">주문 수</th>
            <th class="p-3">가입일</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-slate-100">
          <tr v-for="u in filteredUsers" :key="u.id" class="hover:bg-slate-50">
            <td class="p-3 font-mono text-slate-700">{{ u.id }}</td>
            <td class="p-3 font-bold text-slate-900">{{ u.full_name }}</td>
            <td class="p-3 text-slate-600">{{ u.email }}</td>
            <td class="p-3 text-slate-500">{{ u.phone }}</td>
            <td class="p-3">
              <span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-indigo-100 text-indigo-700">{{ u.role }}</span>
            </td>
            <td class="p-3 font-bold text-slate-900">{{ u.order_count || 0 }}</td>
            <td class="p-3 text-slate-400">{{ new Date(u.created_at).toLocaleString() }}</td>
          </tr>
        </tbody>
      </table>
      <div v-if="filteredUsers.length === 0" class="p-8 text-center text-slate-400">
        조건에 맞는 회원이 없습니다.
      </div>
    </div>
  </div>
</template>