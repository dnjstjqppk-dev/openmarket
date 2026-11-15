<script setup lang="ts">
// 3-9: /my/settings — member info, password, privacy export and withdrawal.
// Same behaviors as before, inside the my-page frame with design tokens.
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '../stores/auth'
import { useLocaleStore } from '../stores/locale'
import { API_BASE_URL, authHeader } from '../config'
import { userErrorMessage, useConfirm, useToast } from '@olmoa/ui'
import MyLayout from './my/MyLayout.vue'

const { confirm } = useConfirm()
const toastApi = useToast()

const router = useRouter()
const auth = useAuthStore()
const locale = useLocaleStore()

const loading = ref(true)
const savingProfile = ref(false)
const changingPassword = ref(false)
const toast = ref('')
const errorMsg = ref('')

const userInfo = ref<any>({
  id: '',
  email: '',
  full_name: '',
  phone: '',
  role: 'ROLE_CUSTOMER',
  created_at: ''
})

// Profile Form
const formName = ref('')
const formPhone = ref('')

// Password Form
const currentPassword = ref('')
const newPassword = ref('')
const confirmPassword = ref('')
const pwError = ref('')

// Notification preferences
const notifySms = ref(true)
const notifyMarketing = ref(true)

const loadUserProfile = async () => {
  loading.value = true
  errorMsg.value = ''
  try {
    const res = await fetch(`${API_BASE_URL}/api/v1/auth/profile`, {
      headers: {
        ...authHeader()
      }
    })
    const json = await res.json()
    if (json.success && json.data) {
      userInfo.value = json.data.user || {}
      formName.value = userInfo.value.full_name || auth.user?.name || ''
      formPhone.value = userInfo.value.phone || ''
      const consents = Array.isArray(json.data.consents) ? json.data.consents : []
      const mkt = consents.find((c: any) => c.consent_type === 'MARKETING')
      if (mkt) notifyMarketing.value = Number(mkt.consented) === 1
    }
  } catch (e: any) {
    console.error('Failed to load profile:', e)
  } finally {
    loading.value = false
  }
}

const saveProfile = async () => {
  if (!formName.value.trim()) {
    toastApi.error('이름을 입력해 주세요.')
    return
  }
  savingProfile.value = true
  try {
    const cid = auth.user?.id || ''
    const res = await fetch(`${API_BASE_URL}/api/v1/auth/profile`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        ...authHeader()
      },
      body: JSON.stringify({
        full_name: formName.value.trim(),
        phone: formPhone.value.trim(),
        agree_marketing: notifyMarketing.value
      })
    })
    const json = await res.json()
    if (json.success) {
      auth.user = {
        id: cid,
        name: formName.value.trim(),
        email: userInfo.value.email
      }
      localStorage.setItem('olmoa_customer_name', formName.value.trim())
      toast.value = '✓ 회원 정보가 성공적으로 수정되었습니다.'
      setTimeout(() => { toast.value = '' }, 3000)
    } else {
      toastApi.error(json.error || '회원 정보 수정에 실패했습니다.')
    }
  } catch (e: any) {
    toastApi.error(userErrorMessage(e, '네트워크 오류'))
  } finally {
    savingProfile.value = false
  }
}

const handlePasswordChange = async () => {
  pwError.value = ''
  const pwClasses = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((r) => r.test(newPassword.value)).length
  if (!newPassword.value || newPassword.value.length < 10 || newPassword.value.length > 128 || pwClasses < 3) {
    pwError.value = '새 비밀번호는 10자 이상 128자 이하, 영문 대/소문자·숫자·특수문자 중 3종류 이상이어야 합니다.'
    return
  }
  if (newPassword.value !== confirmPassword.value) {
    pwError.value = '새 비밀번호가 일치하지 않습니다.'
    return
  }

  changingPassword.value = true
  try {
    const res = await fetch(`${API_BASE_URL}/api/v1/auth/profile`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        ...authHeader()
      },
      body: JSON.stringify({
        current_password: currentPassword.value,
        new_password: newPassword.value
      })
    })
    const json = await res.json()
    if (json.success) {
      toast.value = '✓ 비밀번호가 안전하게 변경되었습니다.'
      setTimeout(() => { toast.value = '' }, 3500)
      currentPassword.value = ''
      newPassword.value = ''
      confirmPassword.value = ''
    } else {
      pwError.value = json.error || '비밀번호 변경에 실패했습니다.'
    }
  } catch (e: any) {
    pwError.value = userErrorMessage(e, '네트워크 오류')
  } finally {
    changingPassword.value = false
  }
}

const handleLogout = async () => {
  if (await confirm({ title: '로그아웃', body: '로그아웃 하시겠습니까?' })) {
    auth.logout()
    router.push('/')
  }
}

// 개인정보 열람 · 회원 탈퇴
const exporting = ref(false)
const withdrawOpen = ref(false)
const precheck = ref<any>(null)
const forfeitCredit = ref(false)
const withdrawConfirm = ref(false)
const withdrawPassword = ref('')
const withdrawError = ref('')
const withdrawing = ref(false)
const retentionYears = 5

const downloadMyData = async () => {
  exporting.value = true
  try {
    const res = await fetch(`${API_BASE_URL}/api/v1/auth/privacy/export`, { headers: { ...authHeader() } })
    const json = await res.json()
    if (!json.success) throw new Error(json.error || '내려받기에 실패했습니다.')
    const blob = new Blob([JSON.stringify(json.data, null, 2)], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `olmoa-my-data-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(a.href)
  } catch (e: any) {
    errorMsg.value = userErrorMessage(e, '네트워크 오류')
  } finally {
    exporting.value = false
  }
}

const openWithdraw = async () => {
  withdrawOpen.value = true
  withdrawError.value = ''
  const res = await fetch(`${API_BASE_URL}/api/v1/auth/withdraw/precheck`, { headers: { ...authHeader() } })
  const json = await res.json().catch(() => ({}))
  precheck.value = json.success ? json.data : { can_withdraw: false, blockers: [{ code: 'ERROR', count: 0, message: json.error || '탈퇴 가능 여부를 확인하지 못했습니다.' }] }
}

const submitWithdraw = async () => {
  withdrawing.value = true
  withdrawError.value = ''
  try {
    const res = await fetch(`${API_BASE_URL}/api/v1/auth/withdraw`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeader() },
      body: JSON.stringify({ password: withdrawPassword.value, confirm: withdrawConfirm.value, acknowledge_credit_forfeit: forfeitCredit.value })
    })
    const json = await res.json()
    if (!json.success) {
      withdrawError.value = json.error || '탈퇴 처리에 실패했습니다.'
      return
    }
    toastApi.success(json.message || '회원 탈퇴가 완료되었습니다.')
    auth.logout()
    router.push('/')
  } catch (e: any) {
    withdrawError.value = userErrorMessage(e, '네트워크 오류')
  } finally {
    withdrawing.value = false
  }
}

const formatDate = (dStr?: string) => {
  if (!dStr) return '-'
  const d = new Date(dStr)
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`
}

onMounted(() => {
  loadUserProfile()
})
</script>

<template>
  <MyLayout title="회원정보">
    <div v-if="loading" class="rounded-2xl border border-line bg-surface p-6 text-sm text-ink-muted">회원 정보를 불러오는 중입니다...</div>
    <div v-else class="space-y-6">
      <div v-if="toast" class="flex items-center justify-between rounded-2xl border border-success bg-success-soft p-4 text-xs font-bold text-success">
        <span>{{ toast }}</span>
        <button type="button" class="hover:underline" @click="toast = ''">닫기</button>
      </div>
      <p v-if="errorMsg" role="alert" class="rounded-2xl border border-danger bg-danger-soft p-4 text-xs font-bold text-danger">{{ errorMsg }}</p>

      <!-- Member card -->
      <section class="rounded-2xl border border-line bg-surface p-5" aria-label="회원 요약">
        <div class="flex flex-wrap items-center justify-between gap-4">
          <div class="flex items-center gap-4">
            <span class="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary-soft text-xl font-bold text-primary-soft-ink" aria-hidden="true">
              {{ (userInfo.full_name || auth.user?.name || '회').charAt(0) }}
            </span>
            <div>
              <p class="text-base font-bold text-ink">{{ userInfo.full_name || auth.user?.name || '회원' }}</p>
              <p class="mt-0.5 text-xs text-ink-muted">{{ userInfo.email || '-' }}</p>
              <p class="om-num mt-0.5 text-2xs text-ink-subtle">가입일 {{ formatDate(userInfo.created_at) }}</p>
            </div>
          </div>
          <button
            type="button"
            class="rounded-xl border border-line px-4 py-2 text-xs font-bold text-ink-muted hover:border-line-strong hover:text-ink"
            @click="handleLogout"
          >
            로그아웃
          </button>
        </div>
      </section>

      <!-- Edit forms -->
      <div class="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <section class="space-y-4 rounded-2xl border border-line bg-surface p-6" aria-label="기본 회원정보 수정">
          <h2 class="border-b border-line pb-3 text-sm font-bold text-ink">기본 회원정보 수정</h2>
          <form class="space-y-4 text-xs" @submit.prevent="saveProfile">
            <div>
              <label class="mb-1 block font-bold text-ink-muted">이메일 계정 (아이디)</label>
              <input
                :value="userInfo.email"
                disabled
                type="text"
                class="h-11 w-full cursor-not-allowed rounded-xl border border-line bg-surface-2 px-3.5 text-ink-subtle"
              />
              <span class="mt-1 block text-2xs text-ink-subtle">이메일은 변경할 수 없습니다.</span>
            </div>
            <div>
              <label class="mb-1 block font-bold text-ink-muted">성명 / 닉네임</label>
              <input
                v-model="formName"
                type="text"
                required
                class="h-11 w-full rounded-xl border border-line bg-surface px-3.5 text-ink focus:outline-none focus:ring-2 focus-visible:ring-focus"
              />
            </div>
            <div>
              <label class="mb-1 block font-bold text-ink-muted">휴대전화번호</label>
              <span v-if="!formPhone" class="mb-1 block text-2xs text-ink-subtle">주문·배송 안내를 위해 휴대폰 번호를 등록해 주세요.</span>
              <input
                v-model="formPhone"
                type="text"
                required
                placeholder="010-1234-5678"
                class="h-11 w-full rounded-xl border border-line bg-surface px-3.5 text-ink focus:outline-none focus:ring-2 focus-visible:ring-focus"
              />
            </div>
            <div class="space-y-2 border-t border-line pt-2">
              <label class="flex cursor-pointer items-center gap-2">
                <input v-model="notifySms" type="checkbox" disabled checked class="rounded disabled:opacity-70" />
                <span class="font-medium text-ink-muted">주문 및 배송 현황 SMS 안내 (주문 처리에 필수이며 항상 발송됩니다)</span>
              </label>
              <label class="flex cursor-pointer items-center gap-2">
                <input v-model="notifyMarketing" type="checkbox" class="rounded" />
                <span class="font-medium text-ink-muted">올모아 번개특가 & 할인 쿠폰 안내 수신 (선택)</span>
              </label>
            </div>
            <button
              type="submit"
              :disabled="savingProfile"
              class="h-11 w-full rounded-xl bg-secondary text-xs font-bold text-secondary-on transition-colors hover:bg-secondary-hover disabled:opacity-50"
            >
              {{ savingProfile ? '저장 중...' : '회원정보 변경사항 저장' }}
            </button>
          </form>
        </section>

        <section class="space-y-4 rounded-2xl border border-line bg-surface p-6" aria-label="비밀번호 보안 변경">
          <h2 class="border-b border-line pb-3 text-sm font-bold text-ink">비밀번호 보안 변경</h2>
          <form class="space-y-4 text-xs" @submit.prevent="handlePasswordChange">
            <div>
              <label class="mb-1 block font-bold text-ink-muted">현재 비밀번호</label>
              <input
                v-model="currentPassword"
                type="password"
                placeholder="현재 사용 중인 비밀번호"
                class="h-11 w-full rounded-xl border border-line bg-surface px-3.5 text-ink focus:outline-none focus:ring-2 focus-visible:ring-focus"
              />
            </div>
            <div>
              <label class="mb-1 block font-bold text-ink-muted">새 비밀번호 (10자 이상, 영문 대/소문자·숫자·특수문자 중 3종류)</label>
              <input
                v-model="newPassword"
                type="password"
                placeholder="새로운 비밀번호 입력"
                class="h-11 w-full rounded-xl border border-line bg-surface px-3.5 text-ink focus:outline-none focus:ring-2 focus-visible:ring-focus"
              />
            </div>
            <div>
              <label class="mb-1 block font-bold text-ink-muted">새 비밀번호 확인</label>
              <input
                v-model="confirmPassword"
                type="password"
                placeholder="새로운 비밀번호 재입력"
                class="h-11 w-full rounded-xl border border-line bg-surface px-3.5 text-ink focus:outline-none focus:ring-2 focus-visible:ring-focus"
              />
            </div>
            <p v-if="pwError" class="text-2xs font-bold text-danger">{{ pwError }}</p>
            <button
              type="submit"
              :disabled="changingPassword"
              class="h-11 w-full rounded-xl bg-primary text-xs font-bold text-primary-on transition-colors hover:bg-primary-hover disabled:opacity-50"
            >
              {{ changingPassword ? '변경 중...' : '새 비밀번호로 변경' }}
            </button>
          </form>
        </section>
      </div>

      <!-- 개인정보 열람 · 회원 탈퇴 -->
      <section class="space-y-4 rounded-2xl border border-line bg-surface p-6 text-xs" data-testid="privacy-section" aria-label="개인정보 열람 · 회원 탈퇴">
        <h2 class="border-b border-line pb-3 text-sm font-bold text-ink">개인정보 열람 · 회원 탈퇴</h2>
        <div class="flex flex-wrap items-center justify-between gap-3">
          <p class="text-ink-muted">올모아가 보관 중인 내 개인정보(회원정보·배송지·주문·적립금·문의)를 파일로 내려받습니다.</p>
          <button type="button" :disabled="exporting" class="h-10 rounded-xl border border-line px-4 font-bold text-ink hover:bg-surface-2 disabled:opacity-50" @click="downloadMyData">
            {{ exporting ? '준비 중...' : '내 정보 내려받기 (JSON)' }}
          </button>
        </div>
        <div class="space-y-3 border-t border-line pt-4">
          <button v-if="!withdrawOpen" type="button" class="text-ink-muted underline hover:text-ink" @click="openWithdraw">회원 탈퇴</button>
          <div v-else class="space-y-3" data-testid="withdraw-panel">
            <ul class="list-disc space-y-1 pl-5 text-ink-muted">
              <li>회원정보(이름·이메일·휴대폰), 배송지, 찜, 알림은 즉시 삭제되며 복구할 수 없습니다.</li>
              <li>주문·결제·환불 기록은 전자상거래법에 따라 {{ retentionYears }}년간 보관한 뒤 수령인 정보를 파기합니다.</li>
              <li>작성한 상품 후기와 문의는 남지만 작성자는 '탈퇴회원'으로 표시됩니다.</li>
              <li>같은 이메일로 다시 가입할 수 있지만, 이전 주문 내역·적립금은 이어지지 않습니다.</li>
            </ul>
            <div v-if="precheck && !precheck.can_withdraw" role="alert" class="rounded-xl border border-warning bg-warning-soft p-3 font-bold text-warning">
              <p v-for="b in precheck.blockers" :key="b.code">{{ b.message }} ({{ b.count }}건)</p>
            </div>
            <template v-else-if="precheck">
              <label v-if="precheck.credit_balance > 0" class="flex items-start gap-2 text-ink">
                <input v-model="forfeitCredit" type="checkbox" class="mt-0.5" />
                <span>남은 적립금 <b class="om-num">{{ precheck.credit_balance.toLocaleString('ko-KR') }}원</b>이 탈퇴와 함께 소멸되는 것에 동의합니다.</span>
              </label>
              <label class="flex items-start gap-2 text-ink"><input v-model="withdrawConfirm" type="checkbox" class="mt-0.5" /><span>위 내용을 확인했으며 탈퇴합니다.</span></label>
              <input
                v-model="withdrawPassword"
                type="password"
                autocomplete="current-password"
                placeholder="본인 확인을 위해 비밀번호 입력"
                class="h-11 w-full rounded-xl border border-line bg-surface px-3.5 text-ink focus:outline-none focus:ring-2 focus-visible:ring-focus sm:w-80"
              />
              <p v-if="withdrawError" role="alert" class="font-bold text-danger">{{ withdrawError }}</p>
              <div class="flex gap-2">
                <button type="button" class="h-10 rounded-xl border border-line px-4 font-bold text-ink hover:bg-surface-2" @click="withdrawOpen = false">취소</button>
                <button
                  type="button"
                  :disabled="withdrawing || !withdrawConfirm || !withdrawPassword || (precheck.credit_balance > 0 && !forfeitCredit)"
                  class="h-10 rounded-xl border border-danger bg-danger-soft px-4 font-bold text-danger disabled:opacity-40"
                  @click="submitWithdraw"
                >
                  {{ withdrawing ? '처리 중...' : '회원 탈퇴' }}
                </button>
              </div>
            </template>
          </div>
        </div>
      </section>
    </div>
  </MyLayout>
</template>
