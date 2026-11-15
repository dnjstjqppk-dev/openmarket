<script setup lang="ts">
// 3-9: address book with the shared postcode search (manual entry while the
// PO-13 external script is undecided) and design tokens throughout.
import { ref, onMounted } from 'vue'
import { RouterLink } from 'vue-router'
import { useAuthStore } from '../stores/auth'
import { API_BASE_URL, authHeader } from '../config'
import { validateKrPhone } from '../utils/phone'
import { userErrorMessage, OmAddressSearch, OmEmptyState, OmSkeleton, useConfirm } from '@olmoa/ui'

const { confirm } = useConfirm()
const formError = ref('')

const auth = useAuthStore()
const addresses = ref<any[]>([])
const loading = ref(true)
const showModal = ref(false)
const submitting = ref(false)
const msg = ref('')
const errorMsg = ref('')

const blankForm = () => ({
  recipient_name: auth.user?.name || '',
  phone: '',
  postal_code: '',
  address_line1: '',
  address_line2: '',
  delivery_note: '문 앞에 놓아주세요',
  is_default: false
})
// S-N03: no '010-' prefill (an untouched field used to store the prefix itself).
const form = ref(blankForm())

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
    const res = await fetch(`${API_BASE_URL}/api/v1/addresses`, {
      headers: { ...authHeader() }
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

// P2-S01: card actions fail loudly with a retry of the same action.
const actionError = ref('')
let lastAction: (() => Promise<void>) | null = null
const retryAction = async () => {
  if (!lastAction) return
  actionError.value = ''
  await lastAction()
}

const setDefault = async (addrId: string) => {
  lastAction = () => setDefault(addrId)
  try {
    const res = await fetch(`${API_BASE_URL}/api/v1/addresses/${addrId}/default`, {
      method: 'PUT',
      headers: { ...authHeader() }
    })
    const json = await res.json().catch(() => ({}))
    if (!res.ok || !json.success) throw new Error(json.error || `기본 배송지를 변경하지 못했습니다. 잠시 후 다시 시도해주세요.`)
    msg.value = '✓ 기본 배송지로 변경되었습니다.'
    lastAction = null
    await loadAddresses()
    setTimeout(() => (msg.value = ''), 2500)
  } catch (e: any) {
    actionError.value = userErrorMessage(e, '기본 배송지 변경에 실패했습니다.')
  }
}

const deleteAddress = async (addrId: string) => {
  if (!(await confirm({ title: '배송지 삭제', body: '해당 배송지를 삭제하시겠습니까?' }))) return
  lastAction = () => deleteAddress(addrId)
  try {
    const res = await fetch(`${API_BASE_URL}/api/v1/addresses/${addrId}`, {
      method: 'DELETE',
      headers: { ...authHeader() }
    })
    const json = await res.json().catch(() => ({}))
    if (!res.ok || !json.success) throw new Error(json.error || `배송지를 삭제하지 못했습니다. 잠시 후 다시 시도해주세요.`)
    msg.value = '✓ 배송지가 삭제되었습니다.'
    lastAction = null
    await loadAddresses()
    setTimeout(() => (msg.value = ''), 2500)
  } catch (e: any) {
    actionError.value = userErrorMessage(e, '배송지 삭제에 실패했습니다.')
  }
}

// Fills the form when a postcode provider is configured (PO-13); until then
// OmAddressSearch renders its manual entry block.
const onPostalPick = (p: { zonecode: string; address: string }) => {
  form.value.postal_code = p.zonecode
  form.value.address_line1 = p.address
}

const handleCreateAddress = async () => {
  formError.value = ''
  if (!form.value.recipient_name || !form.value.phone || !form.value.address_line1) {
    formError.value = '수령인, 연락처, 도로명 주소는 필수입니다.'
    return
  }
  const phoneErr = validateKrPhone(form.value.phone)
  if (phoneErr) {
    formError.value = phoneErr
    return
  }
  if (!/^\d{5}$/.test(form.value.postal_code.trim())) {
    formError.value = '우편번호 5자리를 입력해 주세요.'
    return
  }

  submitting.value = true
  try {
    const res = await fetch(`${API_BASE_URL}/api/v1/addresses`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...authHeader()
      },
      body: JSON.stringify({
        recipient_name: form.value.recipient_name.trim(),
        phone: form.value.phone.trim(),
        postal_code: form.value.postal_code.trim(),
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
      form.value = blankForm()
      await loadAddresses()
      setTimeout(() => (msg.value = ''), 2500)
    } else {
      formError.value = json.error || '배송지 등록에 실패했습니다.'
    }
  } catch (err: any) {
    formError.value = '네트워크 오류가 발생했습니다.'
  } finally {
    submitting.value = false
  }
}

onMounted(loadAddresses)
</script>

<template>
  <div class="mx-auto max-w-[1100px] px-4 py-8 sm:px-6">
    <div class="mb-6 flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 class="text-2xl font-bold text-ink">배송지 관리</h1>
        <p class="mt-0.5 text-xs text-ink-muted">자주 사용하는 배송지를 등록하고 기본 배송지를 설정하세요.</p>
      </div>
      <div class="flex items-center gap-2">
        <RouterLink to="/orders" class="rounded-xl border border-line bg-surface px-3 py-2 text-xs font-bold text-ink-muted hover:text-ink">
          ← 주문 내역 보기
        </RouterLink>
        <button
          type="button"
          class="flex cursor-pointer items-center gap-1.5 rounded-xl bg-primary px-4 py-2 text-xs font-bold text-primary-on hover:bg-primary-hover"
          @click="showModal = true"
        >
          <span>+</span> 신규 배송지 등록
        </button>
      </div>
    </div>

    <!-- Feedback Message -->
    <div v-if="msg" class="mb-4 rounded-xl border border-success bg-success-soft p-3.5 text-xs font-bold text-success">
      {{ msg }}
    </div>
    <div v-if="errorMsg" class="mb-4 rounded-xl border border-danger bg-danger-soft p-3.5 text-xs font-bold text-danger">
      {{ errorMsg }}
    </div>
    <div v-if="actionError" class="mb-4 flex items-center justify-between gap-3 rounded-xl border border-warning bg-warning-soft p-3.5 text-xs font-bold text-warning">
      <span>{{ actionError }}</span>
      <button type="button" class="cursor-pointer rounded-lg border border-line bg-surface px-3 py-1.5 hover:bg-surface-2" @click="retryAction">다시 시도</button>
    </div>

    <!-- Loading Skeleton -->
    <div v-if="loading" class="grid grid-cols-1 gap-4 md:grid-cols-2">
      <OmSkeleton variant="rect" height="h-40" :count="2" />
    </div>

    <!-- Empty State -->
    <OmEmptyState
      v-else-if="addresses.length === 0"
      title="등록된 배송지가 없습니다."
      description="자주 사용하는 배송지를 등록하여 빠른 주문 결제를 진행해보세요."
    >
      <button
        type="button"
        class="rounded-full bg-primary px-5 py-2.5 text-xs font-bold text-primary-on hover:bg-primary-hover"
        @click="showModal = true"
      >
        새 배송지 등록하기
      </button>
    </OmEmptyState>

    <!-- Address Card Grid -->
    <div v-else class="grid grid-cols-1 gap-4 md:grid-cols-2">
      <div
        v-for="addr in addresses"
        :key="addr.id"
        :class="[
          'relative flex flex-col justify-between rounded-2xl border bg-surface p-6 transition-colors',
          addr.is_default ? 'border-primary' : 'border-line hover:border-line-strong'
        ]"
      >
        <div>
          <div class="mb-2 flex items-center justify-between gap-2">
            <div class="flex items-center gap-2">
              <span class="text-sm font-bold text-ink">{{ addr.recipient_name }}</span>
              <span
                v-if="addr.is_default"
                class="rounded-full bg-primary-soft px-2 py-0.5 text-2xs font-bold text-primary-soft-ink"
              >
                기본 배송지
              </span>
            </div>
            <span class="om-num text-xs font-bold text-ink-muted">{{ addr.phone }}</span>
          </div>

          <div class="mb-3 space-y-1 text-xs text-ink-muted">
            <p class="om-num text-2xs text-ink-subtle">[우편번호 {{ addr.postal_code }}]</p>
            <p class="font-medium text-ink">{{ addr.address_line1 }}</p>
            <p v-if="addr.address_line2">{{ addr.address_line2 }}</p>
          </div>

          <div v-if="addr.delivery_note" class="mb-4 flex items-center gap-1.5 rounded-xl bg-surface-2 p-2.5 text-2xs text-ink-muted">
            <span class="text-ink-subtle">요청사항:</span>
            <span>{{ addr.delivery_note }}</span>
          </div>
        </div>

        <div class="flex items-center justify-between border-t border-line pt-3 text-xs">
          <button
            v-if="!addr.is_default"
            type="button"
            class="cursor-pointer font-bold text-primary hover:underline"
            @click="setDefault(addr.id)"
          >
            기본 배송지로 설정
          </button>
          <span v-else class="text-2xs text-ink-subtle">기본 설정됨</span>

          <button
            type="button"
            class="cursor-pointer font-semibold text-ink-muted hover:text-danger"
            @click="deleteAddress(addr.id)"
          >
            삭제
          </button>
        </div>
      </div>
    </div>

    <!-- Add Address Modal Form -->
    <div
      v-if="showModal"
      class="fixed inset-0 z-modal flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label="신규 배송지 등록"
    >
      <div class="absolute inset-0 bg-overlay/50" aria-hidden="true" @click="showModal = false" />
      <div class="relative max-h-[90vh] w-full max-w-lg space-y-4 overflow-y-auto rounded-2xl border border-line bg-surface p-6">
        <div class="flex items-center justify-between border-b border-line pb-3">
          <h3 class="text-base font-bold text-ink">신규 배송지 등록</h3>
          <button type="button" class="cursor-pointer text-lg text-ink-muted hover:text-ink" aria-label="닫기" @click="showModal = false">✕</button>
        </div>

        <form class="space-y-3.5 text-xs" @submit.prevent="handleCreateAddress">
          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="mb-1 block font-bold text-ink-muted">수령인 성명 *</label>
              <input
                v-model="form.recipient_name"
                required
                type="text"
                placeholder="홍길동"
                class="h-10 w-full rounded-xl border border-line bg-surface px-3 text-ink focus:outline-none focus:ring-2 focus-visible:ring-focus"
              />
            </div>
            <div>
              <label class="mb-1 block font-bold text-ink-muted">연락처 *</label>
              <input
                v-model="form.phone"
                required
                type="tel"
                placeholder="010-0000-0000"
                class="h-10 w-full rounded-xl border border-line bg-surface px-3 text-ink focus:outline-none focus:ring-2 focus-visible:ring-focus"
              />
            </div>
          </div>

          <div>
            <label class="mb-1 block font-bold text-ink-muted">우편번호·기본 주소 *</label>
            <OmAddressSearch
              v-model:zip="form.postal_code"
              v-model:address="form.address_line1"
              :required="true"
              @pick="onPostalPick"
            />
          </div>

          <div>
            <label class="mb-1 block font-bold text-ink-muted">상세 주소 (동/호수, 건물명)</label>
            <input
              v-model="form.address_line2"
              type="text"
              placeholder="강남파이낸스센터 12층 1201호"
              class="h-10 w-full rounded-xl border border-line bg-surface px-3 text-ink focus:outline-none focus:ring-2 focus-visible:ring-focus"
            />
          </div>

          <div>
            <label class="mb-1 block font-bold text-ink-muted">배송 요청사항</label>
            <select
              v-model="form.delivery_note"
              class="h-10 w-full rounded-xl border border-line bg-surface px-3 text-ink focus:outline-none focus:ring-2 focus-visible:ring-focus"
            >
              <option v-for="opt in deliveryNoteOptions" :key="opt" :value="opt">{{ opt }}</option>
            </select>
          </div>

          <label class="flex cursor-pointer items-center gap-2 pt-2 font-semibold text-ink-muted">
            <input
              v-model="form.is_default"
              type="checkbox"
              class="rounded"
            />
            <span>이 배송지를 기본 배송지로 설정합니다.</span>
          </label>

          <p v-if="formError" role="alert" class="rounded-xl border border-danger bg-danger-soft px-3 py-2 text-xs font-bold text-danger">{{ formError }}</p>
          <div class="flex items-center justify-end gap-2 border-t border-line pt-3">
            <button
              type="button"
              class="rounded-xl border border-line px-4 py-2.5 font-bold text-ink-muted hover:bg-surface-2"
              @click="showModal = false"
            >
              취소
            </button>
            <button
              type="submit"
              :disabled="submitting"
              class="rounded-xl bg-primary px-5 py-2.5 font-bold text-primary-on hover:bg-primary-hover disabled:opacity-50"
            >
              {{ submitting ? '저장 중...' : '배송지 저장' }}
            </button>
          </div>
        </form>
      </div>
    </div>
  </div>
</template>
