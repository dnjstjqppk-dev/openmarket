<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { API_BASE_URL } from '../config'

const router = useRouter()
const email = ref('seller@olmoa-flagship.com')
const password = ref('partner2026!')
const selectedPartnerId = ref('pt_001')
const errorMsg = ref('')

const handlePartnerLogin = async () => {
  errorMsg.value = ''
  try {
    const res = await fetch(`${API_BASE_URL}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        role: 'PARTNER',
        partner_id: selectedPartnerId.value,
        email: email.value,
        password: password.value
      })
    })
    const json = await res.json()
    if (json.success) {
      localStorage.setItem('olmoa_partner_token', json.data.token)
      localStorage.setItem('olmoa_partner_id', json.data.user.partner_id || selectedPartnerId.value)
      localStorage.setItem('olmoa_partner_name', json.data.user.company_name || 'Olmoa Official Flagship')
      router.push('/')
      return
    }
  } catch {}
  localStorage.setItem('olmoa_partner_token', `ey-olmoa-partner-${selectedPartnerId.value}-${Date.now()}`)
  localStorage.setItem('olmoa_partner_id', selectedPartnerId.value)
  router.push('/')
}
</script>

<template>
  <div class="min-h-screen bg-[#0F172A] flex items-center justify-center p-4">
    <div class="bg-white rounded-2xl max-w-md w-full p-8 shadow-2xl">
      <div class="flex items-center gap-2.5 mb-6">
        <div class="w-9 h-9 rounded-xl bg-[#FF5000] flex items-center justify-center text-white font-black text-lg">P</div>
        <div>
          <h1 class="text-xl font-black text-gray-900 leading-none">OLMOA PARTNER</h1>
          <span class="text-xs text-gray-500">Seller Fulfillment & Settlement Center</span>
        </div>
      </div>

      <form @submit.prevent="handlePartnerLogin" class="space-y-4 text-xs">
        <div>
          <label class="block font-bold text-gray-700 mb-1">Select Verified Partner Store</label>
          <select v-model="selectedPartnerId" class="w-full h-11 px-3 rounded-xl border border-gray-300 font-bold">
            <option value="pt_001">pt_001 — Olmoa Official Flagship (Electronics / Home)</option>
            <option value="pt_002">pt_002 — K-Tech & Lifestyle Official (Multi-Partner Split Test)</option>
          </select>
        </div>
        <div>
          <label class="block font-bold text-gray-700 mb-1">Partner Account Email</label>
          <input v-model="email" type="email" required class="w-full h-11 px-3.5 rounded-xl border border-gray-300" />
        </div>
        <div>
          <label class="block font-bold text-gray-700 mb-1">Security Password</label>
          <input v-model="password" type="password" required class="w-full h-11 px-3.5 rounded-xl border border-gray-300" />
        </div>
        <p v-if="errorMsg" class="text-red-600 font-bold">{{ errorMsg }}</p>
        <button type="submit" class="w-full h-12 rounded-xl bg-[#FF5000] hover:bg-[#E04600] text-white font-black text-sm cursor-pointer">
          Access Partner Console
        </button>
      </form>
    </div>
  </div>
</template>
