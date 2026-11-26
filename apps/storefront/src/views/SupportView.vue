<script setup lang="ts">
// Buyer support center (3-11): FAQ category tabs plus search, 1:1 inquiry
// write and history. Categories match the server allowlist. The FAQ is public
// (decision-21, like 11st's help center); the inquiry area needs a login.
import { ref, computed, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { useAuthStore } from '../stores/auth'
import { API_BASE_URL, authHeader } from '../config'
import { userErrorMessage, OmButton, OmEmptyState, OmStatusTabs, OmFaq } from '@olmoa/ui'

const auth = useAuthStore()
const route = useRoute()
const loginTo = computed(() => `/login?redirect=${encodeURIComponent(route.fullPath)}`)
const faqs = ref<any[]>([])
const faqCategories = ref<string[]>([])
const inquiries = ref<any[]>([])
const category = ref('DELIVERY')
const faqTab = ref('')
const faqQuery = ref('')
let faqTimer: ReturnType<typeof setTimeout> | null = null
const subject = ref('')
const message = ref('')
const submitMsg = ref('')
const loadError = ref<string | null>(null)
const submitting = ref(false)

// 5-5: PRICE_MATCH retired — legacy rows render as 기타 here; the admin
// console keeps reading them as a terminated scheme.
const CATEGORY_LABEL: Record<string, string> = {
  DELIVERY: '배송',
  REFUND_RETURN: '반품·환불',
  PAYMENT: '결제',
  PARTNER_JOIN: '입점',
  OTHER: '기타'
}
const statusLabel = (s: string) => (s === 'ANSWERED' ? '답변 완료' : s === 'CLOSED' ? '종료' : '답변 대기')

// 6-13: admin-managed FAQ — fixed category tabs from the server, server-side
// search, expandable OmFaq answers (server-sanitized HTML).
const faqTabs = computed(() => [
  { value: '', label: '전체' },
  ...faqCategories.value.map((c) => ({ value: c, label: c }))
])

const loadFaq = async () => {
  try {
    const params = new URLSearchParams()
    if (faqTab.value) params.set('category', faqTab.value)
    if (faqQuery.value.trim()) params.set('q', faqQuery.value.trim())
    const fRes = await fetch(`${API_BASE_URL}/api/v1/support/faq?${params.toString()}`)
    const fJson = await fRes.json().catch(() => null)
    if (!fRes.ok || !fJson?.success) throw new Error(fJson?.error || 'FAQ를 불러오지 못했습니다')
    faqs.value = fJson.data || []
    if (Array.isArray(fJson.categories) && fJson.categories.length) faqCategories.value = fJson.categories
  } catch (e: any) {
    loadError.value = userErrorMessage(e, '고객센터 정보를 불러오지 못했습니다')
  }
}

const onFaqQuery = () => {
  if (faqTimer) clearTimeout(faqTimer)
  faqTimer = setTimeout(() => void loadFaq(), 300)
}

const loadSupport = async () => {
  const cid = auth.user?.id || ''
  loadError.value = null
  await loadFaq()
  if (!(await auth.ensureSession())) return
  try {
    const iRes = await fetch(`${API_BASE_URL}/api/v1/support/inquiries?customer_id=${encodeURIComponent(cid)}`, { headers: { ...authHeader() } })
    const iJson = await iRes.json().catch(() => null)
    if (!iRes.ok || !iJson?.success) throw new Error(iJson?.error || '문의 내역을 불러오지 못했습니다')
    inquiries.value = iJson.data || []
  } catch (e: any) {
    loadError.value = userErrorMessage(e, '고객센터 정보를 불러오지 못했습니다')
  }
}

const submitInquiry = async () => {
  if (!subject.value.trim() || !message.value.trim() || submitting.value) return
  submitting.value = true
  try {
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
      submitMsg.value = `1:1 문의가 접수되었습니다(${json.data.id}). 답변이 달리면 이곳에 표시됩니다.`
      await loadSupport()
    } else {
      submitMsg.value = `${json?.error || '문의 등록에 실패했습니다. 잠시 후 다시 시도해 주세요.'}`
    }
  } finally {
    submitting.value = false
  }
}

onMounted(loadSupport)
</script>

<template>
  <div class="mx-auto max-w-[1100px] space-y-8 px-4 py-8 sm:px-6">
    <div>
      <h1 class="text-2xl font-bold text-ink sm:text-3xl">고객센터</h1>
      <p class="mt-1 text-xs text-ink-muted">자주 묻는 질문과 1:1 문의를 이용하세요.</p>
    </div>

    <section class="rounded-2xl border border-line bg-surface p-6">
      <h2 class="mb-4 text-base font-bold text-ink">자주 묻는 질문</h2>
      <div class="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center">
        <OmStatusTabs v-model="faqTab" :tabs="faqTabs" class="min-w-0 flex-1" @update:model-value="loadFaq" />
        <input
          v-model="faqQuery"
          type="search"
          aria-label="FAQ 검색"
          placeholder="궁금한 내용을 검색하세요"
          class="h-9 w-full rounded-lg border border-line bg-surface px-3 text-sm text-ink focus:outline-none focus:ring-2 focus-visible:ring-focus sm:w-56"
          @input="onFaqQuery"
        />
      </div>
      <OmFaq v-if="faqs.length" :items="faqs" :html="true" heading="자주 묻는 질문" />
      <OmEmptyState v-else title="조건에 맞는 질문이 없습니다" description="분류나 검색어를 바꿔 보세요." compact />
    </section>

    <section v-if="!auth.isAuthenticated" class="rounded-2xl border border-line bg-surface p-6 text-center">
      <h2 class="text-base font-bold text-ink">1:1 문의</h2>
      <p class="mt-1 text-xs text-ink-muted">문의 작성과 답변 확인은 로그인 후 이용할 수 있습니다.</p>
      <OmButton class="mt-4" :to="loginTo" variant="primary" size="md">로그인하고 문의하기</OmButton>
    </section>

    <div v-else class="grid grid-cols-1 gap-8 lg:grid-cols-12">
      <form class="space-y-4 rounded-2xl border border-line bg-surface p-6 lg:col-span-6" @submit.prevent="submitInquiry">
        <h2 class="text-base font-bold text-ink">1:1 문의 쓰기</h2>
        <div class="text-xs">
          <label class="mb-1 block font-bold text-ink-muted">문의 분류</label>
          <select v-model="category" class="h-10 w-full rounded-lg border border-line bg-surface px-3 font-bold text-ink focus:outline-none focus:ring-2 focus-visible:ring-focus">
            <option value="DELIVERY">배송</option>
            <option value="REFUND_RETURN">반품·환불</option>
            <option value="PAYMENT">결제</option>
            <option value="PARTNER_JOIN">입점</option>
            <option value="OTHER">기타</option>
          </select>
        </div>
        <div class="text-xs">
          <label class="mb-1 block font-bold text-ink-muted">제목</label>
          <input v-model="subject" required placeholder="문의 제목을 입력하세요" class="h-10 w-full rounded-lg border border-line bg-surface px-3 text-ink focus:outline-none focus:ring-2 focus-visible:ring-focus" />
        </div>
        <div class="text-xs">
          <label class="mb-1 block font-bold text-ink-muted">내용</label>
          <textarea v-model="message" required rows="4" placeholder="주문번호가 있으면 함께 적어주세요" class="w-full rounded-lg border border-line bg-surface p-3 text-ink focus:outline-none focus:ring-2 focus-visible:ring-focus"></textarea>
        </div>
        <p v-if="submitMsg" role="status" class="text-xs font-bold text-success">{{ submitMsg }}</p>
        <button type="submit" :disabled="submitting" class="h-11 w-full cursor-pointer rounded-full bg-primary text-xs font-bold text-primary-on hover:bg-primary-hover disabled:opacity-60">
          {{ submitting ? '접수 중…' : '1:1 문의 보내기' }}
        </button>
      </form>

      <div class="rounded-2xl border border-line bg-surface p-6 lg:col-span-6">
        <h2 class="mb-4 text-base font-bold text-ink">내 문의 내역 ({{ inquiries.length }})</h2>
        <div v-if="loadError" class="rounded-xl border border-danger bg-danger-soft p-4 text-center text-xs text-danger">
          <p class="font-bold">문제가 발생했습니다. 잠시 후 다시 시도해주세요.</p>
          <p class="mt-1">{{ loadError }}</p>
          <button type="button" class="mx-auto mt-2 block rounded-full bg-secondary px-4 py-1.5 font-bold text-secondary-on hover:bg-secondary-hover" @click="loadSupport">다시 시도</button>
        </div>
        <OmEmptyState
          v-else-if="inquiries.length === 0"
          compact
          title="아직 문의 내역이 없습니다."
          description="왼쪽 양식으로 첫 문의를 보내보세요."
        >
          <OmButton size="sm" @click="loadSupport">다시 불러오기</OmButton>
        </OmEmptyState>
        <div v-else class="space-y-3">
          <div v-for="inq in inquiries" :key="inq.id" class="rounded-xl border border-line p-4 text-xs">
            <div class="mb-1 flex items-center justify-between gap-2">
              <span class="min-w-0 truncate font-bold text-ink">[{{ CATEGORY_LABEL[inq.category] || '기타' }}] {{ inq.subject }}</span>
              <span :class="['shrink-0 rounded px-2 py-0.5 text-2xs font-bold', inq.status === 'ANSWERED' ? 'bg-success-soft text-success' : 'bg-surface-3 text-ink-muted']">
                {{ statusLabel(inq.status) }}
              </span>
            </div>
            <p class="mb-2 whitespace-pre-wrap text-ink-muted">{{ inq.message || inq.content }}</p>
            <div v-if="inq.answer" class="rounded bg-surface-2 p-2.5 text-ink-muted">
              <strong class="mb-0.5 block text-success">고객센터 답변:</strong>
              {{ inq.answer }}
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
