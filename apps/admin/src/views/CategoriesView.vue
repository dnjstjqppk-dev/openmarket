<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { API_BASE_URL, getAdminHeaders } from '../config';

interface Category {
  id: string;
  parent_id: string | null;
  name: string;
  slug: string;
  depth: number;
  sort_order: number;
  is_active: number;
  product_count: number;
}

const categories = ref<Category[]>([]);
const loading = ref(true);
const form = ref({ name: '', slug: '', parent_id: '', sort_order: 0 });

async function loadCategories() {
  loading.value = true;
  try {
    const res = await fetch(`${API_BASE_URL}/api/v1/admin/categories`, {
      headers: getAdminHeaders()
    });
    const json = await res.json();
    if (json.success && json.data) {
      categories.value = json.data;
    }
  } catch (_) {
  } finally {
    loading.value = false;
  }
}

async function createCategory() {
  if (!form.value.name.trim()) return;
  try {
    const res = await fetch(`${API_BASE_URL}/api/v1/admin/categories`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getAdminHeaders() },
      body: JSON.stringify(form.value)
    });
    if (res.ok) {
      form.value = { name: '', slug: '', parent_id: '', sort_order: 0 };
      await loadCategories();
    }
  } catch (_) {
  }
}

async function deleteCategory(id: string) {
  if (!confirm('카테고리를 삭제하시겠습니까?')) return;
  try {
    const res = await fetch(`${API_BASE_URL}/api/v1/admin/categories/${id}`, {
      method: 'DELETE',
      headers: getAdminHeaders()
    });
    if (res.ok) {
      categories.value = categories.value.filter(c => c.id !== id);
    }
  } catch (_) {
  }
}

onMounted(loadCategories);
</script>

<template>
  <div class="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-6">
    <div class="border-b pb-3">
      <h2 class="text-base font-bold text-slate-900">카테고리 관리</h2>
      <p class="text-xs text-slate-500 mt-0.5">상품 카테고리를 생성하고 관리합니다.</p>
    </div>

    <div class="grid grid-cols-1 sm:grid-cols-4 gap-3 text-xs">
      <input v-model="form.name" placeholder="카테고리명" class="border border-slate-300 rounded-lg px-2 py-1.5" />
      <input v-model="form.slug" placeholder="슬러그 (자동)" class="border border-slate-300 rounded-lg px-2 py-1.5" />
      <input v-model="form.parent_id" placeholder="부모 ID (선택)" class="border border-slate-300 rounded-lg px-2 py-1.5" />
      <input v-model.number="form.sort_order" type="number" placeholder="정렬순서" class="border border-slate-300 rounded-lg px-2 py-1.5" />
      <button @click="createCategory" class="bg-indigo-600 text-white rounded-lg px-3 py-1.5 font-bold hover:bg-indigo-700">
        카테고리 생성
      </button>
    </div>

    <div v-if="loading" class="p-12 text-center text-slate-400 text-xs">
      <i class="fa-solid fa-spinner fa-spin mr-2"></i>카테고리 목록을 불러오는 중...
    </div>

    <div v-else class="overflow-x-auto text-xs">
      <table class="w-full text-left">
        <thead class="bg-slate-50 text-slate-500 uppercase border-b text-[10px]">
          <tr>
            <th class="p-3">ID</th>
            <th class="p-3">이름</th>
            <th class="p-3">슬러그</th>
            <th class="p-3">depth</th>
            <th class="p-3">상품 수</th>
            <th class="p-3">관리</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-slate-100">
          <tr v-for="c in categories" :key="c.id" class="hover:bg-slate-50">
            <td class="p-3 font-mono text-slate-700">{{ c.id }}</td>
            <td class="p-3 font-bold text-slate-900">{{ c.name }}</td>
            <td class="p-3 text-slate-600">{{ c.slug }}</td>
            <td class="p-3 text-slate-500">{{ c.depth }}</td>
            <td class="p-3 text-slate-900">{{ c.product_count || 0 }}</td>
            <td class="p-3">
              <button @click="deleteCategory(c.id)" class="text-rose-600 font-bold hover:underline">삭제</button>
            </td>
          </tr>
        </tbody>
      </table>
      <div v-if="categories.length === 0" class="p-8 text-center text-slate-400">
        등록된 카테고리가 없습니다.
      </div>
    </div>
  </div>
</template>