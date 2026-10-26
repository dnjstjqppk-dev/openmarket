<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { RouterLink } from 'vue-router'
import { useAuthStore } from '../stores/auth'
import { API_BASE_URL } from '../config'

const auth = useAuthStore()
const addresses = ref<any[]>([])
const loading = ref(true)
const showModal = ref(false)
const submitting = ref(false)
const msg = ref('')
const errorMsg = ref('')

const form = ref({
  recipient_name: auth.user?.name || '',
  phone: '010-',
  postal_code: '',
  address_line1: '',
  address_line2: '',
  delivery_note: '문 앞에 놓아주세요',
  is_default: false
})

const deliveryNoteOptions = [
  '문 앞에 놓아주세요',
  '배송 전 미리 연락 바랍니다',
  '경비실에 맡겨주세요',
  '택배함에 넣어주세요',
  '직접 수령하겠습니다'
]

const loadAddresses = async () => {
  loading.value = true
  errorMsg.value = ''
  try {
    const cid = auth.user?.id || 'u_customer_001'
    const res = await fetch(`${API_BASE_URL}/api/v1/addresses`, {
      headers: { 'X-Customer-Id': cid }
    })
    const json = await res.json()
    if (json.success && Array.isArray(json.data)) {
      addresses.value = json.data
    }
  } catch (err: any) {
    errorMsg.value = '배송지 목록을 불러오지 못했습니다.'
  } finally {
    loading.value = false
  }
}

const setDefault = async (addrId: string) => {
  try {
    const cid = auth.user?.id || 'u_customer_001'
    const res = await fetch(`${API_BASE_URL}/api/v1/addresses/${addrId}/default`, {
      method: 'PUT',
      headers: { 'X-Customer-Id': cid }
    })
    const json = await res.json()
    if (json.success) {
      msg.value = '✓ 기본 배송지로 변경되었습니다.'
      await loadAddresses()
      setTimeout(() => (msg.value = ''), 2500)
    }
  } catch {}
}

const deleteAddress = async (addrId: string) => {
  if (!confirm('해당 배송지를 삭제하시겠습니까?')) return
  try {
    const cid = auth.user?.id || 'u_customer_001'
    const res = await fetch(`${API_BASE_URL}/api/v1/addresses/${addrId}`, {
      method: 'DELETE',
      headers: { 'X-Customer-Id': cid }
    })
    const json = await res.json()
    if (json.success) {
      msg.value = '✓ 배송지가 삭제되었습니다.'
      await loadAddresses()
      setTimeout(() => (msg.value = ''), 2500)
    }
  } catch {}
}

const handleCreateAddress = async () => {
  if (!form.value.recipient_name || !form.value.phone || !form.value.address_line1) {
    alert('수령인, 연락처, 도로명 주소는 필수입니다.')
    return
  }

  submitting.value = true
  try {
    const cid = auth.user?.id || 'u_customer_001'
    const res = await fetch(`${API_BASE_URL}/api/v1/addresses`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Customer-Id': cid
      },
      body: JSON.stringify({
        recipient_name: form.value.recipient_name.trim(),
        phone: form.value.phone.trim(),
        postal_code: form.value.postal_code.trim() || '00000',
        address_line1: form.value.address_line1.trim(),
        address_line2: form.value.address_line2.trim(),
        delivery_note: form.value.delivery_note,
        is_default: form.value.is_default ? 1 : 0
      })
    })

    const json = await res.json()
    if (json.success) {
      msg.value = '✓ 신규 배송지가 성공적으로 등록되었습니다.'
      showModal.value = false
      form.value = {
        recipient_name: auth.user?.name || '',
        phone: '010-',
        postal_code: '',
        address_line1: '',
        address_line2: '',
        delivery_note: '문 앞에 놓아주세요',
        is_default: false
      }
      await loadAddresses()
      setTimeout(() => (msg.value = ''), 2500)
    } else {
      alert(json.error || '배송지 등록에 실패했습니다.')
    }
  } catch (err: any) {
    alert('네트워크 오류가 발생했습니다.')
  } finally {
    submitting.value = false
  }
}

onMounted(loadAddresses)
</script>

<template>
  <div class="max-w-[1100px] mx-auto px-4 sm:px-6 py-8">
    <div class="flex flex-wrap items-center justify-between gap-3 mb-6">
      <div>
        <h1 class="text-2xl font-black text-gray-900">배송지 관리 (Address Book)</h1>
        <p class="text-xs text-gray-500 mt-0.5">자주 사용하는 배송지를 등록하고 기본 배송지를 설정하세요.</p>
      </div>
      <div class="flex items-center gap-2">
        <RouterLink to="/orders" class="text-xs font-bold text-gray-600 hover:text-gray-900 px-3 py-2 rounded-xl border border-gray-200 bg-white">
          ← 주문 내역 보기
        </RouterLink>
        <button
          @click="showModal = true"
          class="px-4 py-2 rounded-xl bg-[#FF5000] text-white text-xs font-black hover:bg-orange-600 shadow-sm shadow-orange-500/20 flex items-center gap-1.5 cursor-pointer"
        >
          <span>+</span> 신규 배송지 등록
        </button>
      </div>
    </div>

    <!-- Feedback Message -->
    <div v-if="msg" class="mb-4 p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-xs font-bold text-emerald-800">
      {{ msg }}
    </div>
    <div v-if="errorMsg" class="mb-4 p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-xs font-bold text-rose-800">
      {{ errorMsg }}
    </div>

    <!-- Loading Skeleton -->
    <div v-if="loading" class="grid grid-cols-1 md:grid-cols-2 gap-4">
      <div v-for="n in 2" :key="n" class="h-40 bg-white rounded-2xl animate-pulse border border-gray-200"></div>
    </div>

    <!-- Empty State -->
    <div v-else-if="addresses.length === 0" class="bg-white rounded-2xl p-12 text-center border border-gray-200">
      <div class="text-4xl mb-3">📍</div>
      <h3 class="text-base font-bold text-gray-800 mb-1">등록된 배송지가 없습니다.</h3>
      <p class="text-xs text-gray-500 mb-5">자주 사용하는 배송지를 등록하여 빠른 주문 결제를 진행해보세요.</p>
      <button
        @click="showModal = true"
        class="px-5 py-2.5 rounded-full bg-[#FF5000] text-white text-xs font-black hover:bg-orange-600"
      >
        새 배송지 등록하기
      </button>
    </div>

    <!-- Address Card Grid -->
    <div v-else class="grid grid-cols-1 md:grid-cols-2 gap-4">
      <div
        v-for="addr in addresses"
        :key="addr.id"
        :class="[
          'bg-white rounded-2xl p-6 border transition-all relative flex flex-col justify-between',
          addr.is_default ? 'border-[#FF5000] shadow-sm ring-1 ring-[#FF5000]/30' : 'border-gray-200/80 hover:border-gray-300'
        ]"
      >
        <div>
          <div class="flex items-center justify-between gap-2 mb-2">
            <div class="flex items-center gap-2">
              <span class="font-black text-gray-900 text-sm">{{ addr.recipient_name }}</span>
              <span
                v-if="addr.is_default"
                class="px-2 py-0.5 rounded-full bg-orange-100 text-[#FF5000] text-[10px] font-black"
              >
                기본 배송지
              </span>
            </div>
            <span class="text-xs font-bold text-gray-500">{{ addr.phone }}</span>
          </div>

          <div class="space-y-1 text-xs text-gray-700 mb-3">
            <p class="font-mono text-gray-500 text-[11px]">[우편번호 {{ addr.postal_code }}]</p>
            <p class="font-medium text-gray-900">{{ addr.address_line1 }}</p>
            <p v-if="addr.address_line2" class="text-gray-600">{{ addr.address_line2 }}</p>
          </div>

          <div v-if="addr.delivery_note" class="p-2.5 rounded-xl bg-gray-50 text-[11px] text-gray-600 flex items-center gap-1.5 mb-4">
            <span class="text-gray-400">📦 요청사항:</span>
            <span>{{ addr.delivery_note }}</span>
          </div>
        </div>

        <div class="pt-3 border-t border-gray-100 flex items-center justify-between text-xs">
          <button
            v-if="!addr.is_default"
            @click="setDefault(addr.id)"
            class="text-[#FF5000] font-bold hover:underline cursor-pointer"
          >
            기본 배송지로 설정
          </button>
          <span v-else class="text-gray-400 text-[11px]">기본 설정됨</span>

          <button
            @click="deleteAddress(addr.id)"
            class="text-gray-400 hover:text-red-600 font-semibold cursor-pointer"
          >
            삭제
          </button>
        </div>
      </div>
    </div>

    <!-- Add Address Modal Form -->
    <div
      v-if="showModal"
      class="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4"
      @click.self="showModal = false"
    >
      <div class="bg-white rounded-3xl max-w-lg w-full p-6 shadow-2xl border border-gray-200 space-y-4">
        <div class="flex items-center justify-between border-b border-gray-100 pb-3">
          <h3 class="text-base font-black text-gray-900">신규 배송지 등록</h3>
          <button @click="showModal = false" class="text-gray-400 hover:text-gray-600 text-lg cursor-pointer">✕</button>
        </div>

        <form @submit.prevent="handleCreateAddress" class="space-y-3.5 text-xs">
          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="block font-bold text-gray-700 mb-1">수령인 성명 *</label>
              <input
                v-model="form.recipient_name"
                required
                type="text"
                placeholder="홍길동"
                class="w-full h-10 px-3 rounded-xl border border-gray-300 focus:outline-none focus:ring-2 focus:ring-[#FF5000]"
              />
            </div>
            <div>
              <label class="block font-bold text-gray-700 mb-1">연락처 *</label>
              <input
                v-model="form.phone"
                required
                type="tel"
                placeholder="010-1234-5678"
                class="w-full h-10 px-3 rounded-xl border border-gray-300 focus:outline-none focus:ring-2 focus:ring-[#FF5000]"
              />
            </div>
          </div>

          <div>
            <label class="block font-bold text-gray-700 mb-1">우편번호</label>
            <input
              v-model="form.postal_code"
              type="text"
              placeholder="06236"
              class="w-full h-10 px-3 rounded-xl border border-gray-300 focus:outline-none focus:ring-2 focus:ring-[#FF5000]"
            />
          </div>

          <div>
            <label class="block font-bold text-gray-700 mb-1">기본 도로명 주소 *</label>
            <input
              v-model="form.address_line1"
              required
              type="text"
              placeholder="서울특별시 강남구 테헤란로 152"
              class="w-full h-10 px-3 rounded-xl border border-gray-300 focus:outline-none focus:ring-2 focus:ring-[#FF5000]"
            />
          </div>

          <div>
            <label class="block font-bold text-gray-700 mb-1">상세 주소 (동/호수, 건물명)</label>
            <input
              v-model="form.address_line2"
              type="text"
              placeholder="강남파이낸스센터 12층 1201호"
              class="w-full h-10 px-3 rounded-xl border border-gray-300 focus:outline-none focus:ring-2 focus:ring-[#FF5000]"
            />
          </div>

          <div>
            <label class="block font-bold text-gray-700 mb-1">배송 요청사항</label>
            <select
              v-model="form.delivery_note"
              class="w-full h-10 px-3 rounded-xl border border-gray-300 focus:outline-none focus:ring-2 focus:ring-[#FF5000] bg-white"
            >
              <option v-for="opt in deliveryNoteOptions" :key="opt" :value="opt">{{ opt }}</option>
            </select>
          </div>

          <label class="flex items-center gap-2 pt-2 cursor-pointer text-gray-700 font-semibold">
            <input
              v-model="form.is_default"
              type="checkbox"
              class="rounded text-[#FF5000] focus:ring-[#FF5000]"
            />
            <span>이 배송지를 기본 배송지로 설정합니다.</span>
          </label>

          <div class="pt-3 border-t border-gray-100 flex items-center justify-end gap-2">
            <button
              type="button"
              @click="showModal = false"
              class="px-4 py-2.5 rounded-xl border border-gray-300 text-gray-700 font-bold hover:bg-gray-50"
            >
              취소
            </button>
            <button
              type="submit"
              :disabled="submitting"
              class="px-5 py-2.5 rounded-xl bg-[#FF5000] hover:bg-orange-600 disabled:opacity-50 text-white font-extrabold shadow-sm shadow-orange-500/20"
            >
              {{ submitting ? '저장 중...' : '배송지 저장' }}
            </button>
          </div>
        </form>
      </div>
    </div>
  </div>
</template>

