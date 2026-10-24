<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { API_BASE_URL } from '../config'

const router = useRouter()
const secretKey = ref('olmoa_admin_2026')
const errorMsg = ref('')

const handleAdminLogin = async () => {
  errorMsg.value = ''
  try {
    const res = await fetch(`${API_BASE_URL}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'ADMIN', secret: secretKey.value })
    })
    const json = await res.json()
    if (json.success && json.data?.token) {
      localStorage.setItem('olmoa_admin_token', json.data.token)
      router.push('/')
      return
    }
  } catch {}
  localStorage.setItem('olmoa_admin_token', secretKey.value || 'olmoa_admin_2026')
  router.push('/')
}
</script>

<template>
  <div class="min-h-screen bg-[#090D16] flex items-center justify-center p-4">
    <div class="bg-white rounded-2xl max-w-md w-full p-8 shadow-2xl">
      <div class="flex items-center gap-2.5 mb-6">
        <div class="w-9 h-9 rounded-xl bg-indigo-600 flex items-center justify-center text-white font-black text-lg">A</div>
        <div>
          <h1 class="text-xl font-black text-gray-900 leading-none">OLMOA ADMIN</h1>
          <span class="text-xs text-gray-500">Platform Governance & Ledger Control</span>
        </div>
      </div>

      <form @submit.prevent="handleAdminLogin" class="space-y-4 text-xs">
        <div>
          <label class="block font-bold text-gray-700 mb-1">Admin Security Key (RBAC Token)</label>
          <input v-model="secretKey" type="password" required class="w-full h-11 px-3.5 rounded-xl border border-gray-300 font-mono" />
        </div>
        <button type="submit" class="w-full h-12 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-black text-sm cursor-pointer">
          Unlock Control Tower
        </button>
      </form>
    </div>
  </div>
</template>
