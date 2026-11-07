<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useAuthStore } from '../stores/auth'
import { API_BASE_URL, authHeader } from '../config'

const auth = useAuthStore()
const faqs = ref<any[]>([])
const inquiries = ref<any[]>([])
const category = ref('DELIVERY')
const subject = ref('')
const message = ref('')
const submitMsg = ref('')
const loadError = ref<string | null>(null)

const loadSupport = async () => {
  const cid = auth.user?.id || ''
  loadError.value = null
  try {
    const [fRes, iRes] = await Promise.all([
      fetch(`${API_BASE_URL}/api/v1/support/faq`),
      fetch(`${API_BASE_URL}/api/v1/support/inquiries?customer_id=${encodeURIComponent(cid)}`, { headers: { ...authHeader() } })
    ])
    const fJson = await fRes.json().catch(() => null)
    const iJson = await iRes.json().catch(() => null)
    if (!fRes.ok || !fJson?.success) throw new Error(fJson?.error || 'FAQ를 불러오지 못했습니다')
    if (!iRes.ok || !iJson?.success) throw new Error(iJson?.error || '문의 내역을 불러오지 못했습니다')
    faqs.value = fJson.data || []
    inquiries.value = iJson.data || []
  } catch (e: any) {
    loadError.value = e?.message || '고객센터 정보를 불러오지 못했습니다'
  }
}

const submitInquiry = async () => {
  if (!subject.value.trim() || !message.value.trim()) return
  const cid = auth.user?.id || ''
  const res = await fetch(`${API_BASE_URL}/api/v1/support/inquiries`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeader() },
    body: JSON.stringify({
      customer_id: cid,
      category: category.value,
      subject: subject.value.trim(),
      message: message.value.trim()
    })
  })
  const json: any = await res.json().catch(() => null)
  if (res.ok && json?.success) {
    subject.value = ''
    message.value = ''
    submitMsg.value = `✓ 1:1 Inquiry (${json.data.id}) registered! Our support team will review it and reply here.`
    await loadSupport()
  } else {
    submitMsg.value = `⚠️ ${json?.error || '문의 등록에 실패했습니다. 잠시 후 다시 시도해 주세요.'}`
  }
}

onMounted(loadSupport)
</script>

<template>
  <div class="max-w-[1100px] mx-auto px-4 sm:px-6 py-8 space-y-8">
    <div>
      <span class="text-xs font-extrabold text-[#FF5000] uppercase">Buyer Protection & 1:1 Support</span>
      <h1 class="text-2xl sm:text-3xl font-black text-gray-900 mt-1">Customer Support & 1:1 Inquiry Center</h1>
    </div>

    <!-- FAQ Accordion Cards -->
    <section class="bg-white rounded-2xl p-6 border border-gray-200/80">
      <h2 class="text-base font-black text-gray-900 mb-4">Frequently Asked Questions</h2>
      <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div v-for="(f, idx) in faqs" :key="idx" class="p-4 rounded-xl bg-gray-50 border border-gray-200/60">
          <span class="text-[10px] font-black text-[#FF5000] uppercase">{{ f.category }}</span>
          <h3 class="text-xs sm:text-sm font-bold text-gray-900 mt-0.5 mb-1.5">Q. {{ f.q }}</h3>
          <p class="text-xs text-gray-600 leading-relaxed">{{ f.a }}</p>
        </div>
      </div>
    </section>

    <!-- 1:1 Inquiry Submission & History -->
    <div class="grid grid-cols-1 lg:grid-cols-12 gap-8">
      <form @submit.prevent="submitInquiry" class="lg:col-span-6 bg-white rounded-2xl p-6 border border-gray-200/80 space-y-4">
        <h2 class="text-base font-black text-gray-900">Submit a 1:1 Support Ticket</h2>
        <div class="text-xs">
          <label class="block font-bold text-gray-700 mb-1">Inquiry Topic</label>
          <select v-model="category" class="w-full h-10 px-3 rounded-lg border border-gray-300 font-bold">
            <option value="DELIVERY">Shipping & On-Time Guarantee</option>
            <option value="PRICE_MATCH">30-Day Price-Drop Credit</option>
            <option value="RETURN">Return / Refund (within 7 days of delivery)</option>
            <option value="PARTNER">Partner Store / Bulk Purchase</option>
          </select>
        </div>
        <div class="text-xs">
          <label class="block font-bold text-gray-700 mb-1">Subject</label>
          <input v-model="subject" required placeholder="Brief summary of your request" class="w-full h-10 px-3 rounded-lg border border-gray-300" />
        </div>
        <div class="text-xs">
          <label class="block font-bold text-gray-700 mb-1">Message</label>
          <textarea v-model="message" required rows="4" placeholder="Include your Order ID if applicable..." class="w-full p-3 rounded-lg border border-gray-300"></textarea>
        </div>
        <p v-if="submitMsg" class="text-xs font-bold text-[#00A862]">{{ submitMsg }}</p>
        <button type="submit" class="w-full h-11 rounded-full bg-[#FF5000] text-white text-xs font-black cursor-pointer">
          Send 1:1 Inquiry
        </button>
      </form>

      <div class="lg:col-span-6 bg-white rounded-2xl p-6 border border-gray-200/80">
        <h2 class="text-base font-black text-gray-900 mb-4">My 1:1 Tickets ({{ inquiries.length }})</h2>
        <div v-if="loadError" class="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-xl p-4 text-center">
          {{ loadError }}
          <button @click="loadSupport" class="block mx-auto mt-2 px-4 py-1.5 rounded-full bg-gray-900 text-white font-bold">다시 시도</button>
        </div>
        <div v-else-if="inquiries.length === 0" class="text-xs text-gray-400 py-8 text-center">No support tickets submitted yet.</div>
        <div v-else class="space-y-3">
          <div v-for="inq in inquiries" :key="inq.id" class="p-4 rounded-xl border border-gray-200 text-xs">
            <div class="flex items-center justify-between mb-1">
              <span class="font-black text-[#FF5000]">[{{ inq.category }}] {{ inq.subject }}</span>
              <span :class="['px-2 py-0.5 rounded text-[10px] font-bold', inq.status === 'ANSWERED' ? 'bg-green-50 text-[#00A862]' : 'bg-amber-50 text-amber-700']">
                {{ inq.status }}
              </span>
            </div>
            <p class="text-gray-600 mb-2">{{ inq.message }}</p>
            <div v-if="inq.answer" class="p-2.5 rounded bg-gray-50 border-l-2 border-[#00A862] text-gray-700">
              <strong class="text-[#00A862] block mb-0.5">Concierge Response:</strong>
              {{ inq.answer }}
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
