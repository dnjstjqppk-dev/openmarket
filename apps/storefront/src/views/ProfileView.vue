<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRouter, RouterLink } from 'vue-router'
import { useAuthStore } from '../stores/auth'
import { useLocaleStore } from '../stores/locale'
import { API_BASE_URL } from '../config'

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

const stats = ref({
  credit_balance: 0,
  available_coupons: 0,
  wishlist_count: 0
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
    const cid = auth.user?.id || 'u_customer_001'
    const res = await fetch(`${API_BASE_URL}/api/v1/auth/profile`, {
      headers: {
        'X-Customer-Id': cid
      }
    })
    const json = await res.json()
    if (json.success && json.data) {
      userInfo.value = json.data.user || {}
      formName.value = userInfo.value.full_name || auth.user?.name || ''
      formPhone.value = userInfo.value.phone || '010-0000-0000'
      stats.value.credit_balance = json.data.credit_balance || 0
      stats.value.available_coupons = json.data.available_coupons || 0
      stats.value.wishlist_count = json.data.wishlist_count || 0
    }
  } catch (e: any) {
    console.error('Failed to load profile:', e)
  } finally {
    loading.value = false
  }
}

const saveProfile = async () => {
  if (!formName.value.trim()) {
    alert('이름을 입력해 주세요.')
    return
  }
  savingProfile.value = true
  try {
    const cid = auth.user?.id || 'u_customer_001'
    const res = await fetch(`${API_BASE_URL}/api/v1/auth/profile`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'X-Customer-Id': cid
      },
      body: JSON.stringify({
        full_name: formName.value.trim(),
        phone: formPhone.value.trim()
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
      alert(json.error || '회원 정보 수정에 실패했습니다.')
    }
  } catch (e: any) {
    alert(e.message || '네트워크 오류')
  } finally {
    savingProfile.value = false
  }
}

const handlePasswordChange = async () => {
  pwError.value = ''
  if (!newPassword.value || newPassword.value.length < 6) {
    pwError.value = '새 비밀번호는 최소 6자 이상이어야 합니다.'
    return
  }
  if (newPassword.value !== confirmPassword.value) {
    pwError.value = '새 비밀번호가 일치하지 않습니다.'
    return
  }

  changingPassword.value = true
  try {
    const cid = auth.user?.id || 'u_customer_001'
    const res = await fetch(`${API_BASE_URL}/api/v1/auth/profile`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'X-Customer-Id': cid
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
    pwError.value = e.message || '네트워크 오류'
  } finally {
    changingPassword.value = false
  }
}

const handleLogout = () => {
  if (confirm('로그아웃 하시겠습니까?')) {
    auth.logout()
    router.push('/')
  }
}

const formatDate = (dStr?: string) => {
  if (!dStr) return '2026.01.01'
  const d = new Date(dStr)
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`
}

onMounted(() => {
  loadUserProfile()
})
</script>

<template>
  <div class="max-w-[1000px] mx-auto px-4 sm:px-6 py-6 sm:py-10 space-y-8">
    <!-- Breadcrumb -->
    <div class="flex items-center gap-2 text-xs text-gray-500">
      <RouterLink to="/" class="hover:text-gray-900">홈</RouterLink>
      <span>/</span>
      <span class="text-gray-900 font-bold">마이페이지 (회원 정보 설정)</span>
    </div>

    <!-- Alert Toast -->
    <div v-if="toast" class="p-4 rounded-2xl bg-emerald-600 text-white font-bold text-xs flex items-center justify-between shadow-lg animate-fade-in">
      <span>{{ toast }}</span>
      <button @click="toast = ''" class="text-white/80 hover:text-white">✕</button>
    </div>

    <!-- Profile Header Card -->
    <div class="bg-gradient-to-r from-[#111111] via-[#222222] to-[#FF5000] rounded-3xl p-6 sm:p-8 text-white shadow-xl relative overflow-hidden">
      <div class="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div class="flex items-center gap-4">
          <div class="w-16 h-16 sm:w-20 sm:h-20 rounded-2xl bg-white/10 backdrop-blur-md border border-white/20 flex items-center justify-center text-2xl sm:text-3xl font-black text-amber-400">
            {{ (userInfo.full_name || auth.user?.name || 'U').charAt(0) }}
          </div>
          <div>
            <div class="flex items-center gap-2 mb-1">
              <h1 class="text-xl sm:text-2xl font-black tracking-tight">{{ userInfo.full_name || auth.user?.name || '구매 고객' }}</h1>
              <span class="px-2.5 py-0.5 rounded-full bg-amber-400 text-black text-[10px] font-black uppercase">
                VIP 등급
              </span>
            </div>
            <p class="text-xs text-gray-300 font-mono">{{ userInfo.email || 'customer@olmoa.com' }}</p>
            <p class="text-[11px] text-gray-400 mt-1">가입일: {{ formatDate(userInfo.created_at) }}</p>
          </div>
        </div>

        <button
          @click="handleLogout"
          class="self-start md:self-center px-4 py-2 rounded-xl bg-white/10 hover:bg-white/20 text-xs font-bold transition border border-white/20 cursor-pointer"
        >
          로그아웃
        </button>
      </div>

      <!-- Quick Benefit Indicators -->
      <div class="grid grid-cols-3 gap-3 mt-6 pt-6 border-t border-white/10 text-center">
        <RouterLink to="/coupons" class="bg-black/20 hover:bg-black/30 p-3 rounded-2xl transition backdrop-blur-xs">
          <span class="text-[11px] text-gray-300 block">보유 크레딧(적립금)</span>
          <span class="text-base sm:text-lg font-black text-amber-400">
            {{ stats.credit_balance.toLocaleString('ko-KR') }}원
          </span>
        </RouterLink>
        <RouterLink to="/coupons" class="bg-black/20 hover:bg-black/30 p-3 rounded-2xl transition backdrop-blur-xs">
          <span class="text-[11px] text-gray-300 block">사용 가능 쿠폰</span>
          <span class="text-base sm:text-lg font-black text-white">
            {{ stats.available_coupons }}장
          </span>
        </RouterLink>
        <RouterLink to="/wishlist" class="bg-black/20 hover:bg-black/30 p-3 rounded-2xl transition backdrop-blur-xs">
          <span class="text-[11px] text-gray-300 block">찜한 상품</span>
          <span class="text-base sm:text-lg font-black text-white">
            {{ stats.wishlist_count }}개
          </span>
        </RouterLink>
      </div>
    </div>

    <!-- Quick Navigation Shortcuts -->
    <div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
      <RouterLink
        to="/orders"
        class="bg-white p-4 rounded-2xl border border-gray-200/80 shadow-xs hover:border-[#FF5000] hover:shadow-md transition flex items-center gap-3"
      >
        <div class="w-10 h-10 rounded-xl bg-orange-50 text-[#FF5000] flex items-center justify-center text-lg">📦</div>
        <div>
          <span class="font-bold text-xs text-gray-900 block">주문·배송 내역</span>
          <span class="text-[10px] text-gray-400">배송추적 및 취소</span>
        </div>
      </RouterLink>

      <RouterLink
        to="/addresses"
        class="bg-white p-4 rounded-2xl border border-gray-200/80 shadow-xs hover:border-[#FF5000] hover:shadow-md transition flex items-center gap-3"
      >
        <div class="w-10 h-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center text-lg">📍</div>
        <div>
          <span class="font-bold text-xs text-gray-900 block">배송지 관리</span>
          <span class="text-[10px] text-gray-400">기본 배송지 설정</span>
        </div>
      </RouterLink>

      <RouterLink
        to="/coupons"
        class="bg-white p-4 rounded-2xl border border-gray-200/80 shadow-xs hover:border-[#FF5000] hover:shadow-md transition flex items-center gap-3"
      >
        <div class="w-10 h-10 rounded-xl bg-purple-50 text-purple-600 flex items-center justify-center text-lg">🎟️</div>
        <div>
          <span class="font-bold text-xs text-gray-900 block">쿠폰 & 적립금</span>
          <span class="text-[10px] text-gray-400">할인 혜택 확인</span>
        </div>
      </RouterLink>

      <RouterLink
        to="/support"
        class="bg-white p-4 rounded-2xl border border-gray-200/80 shadow-xs hover:border-[#FF5000] hover:shadow-md transition flex items-center gap-3"
      >
        <div class="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center text-lg">💬</div>
        <div>
          <span class="font-bold text-xs text-gray-900 block">고객센터 / 1:1</span>
          <span class="text-[10px] text-gray-400">자주 묻는 질문</span>
        </div>
      </RouterLink>
    </div>

    <!-- Edit Forms Layout -->
    <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
      <!-- Profile Information Card -->
      <div class="bg-white p-6 rounded-3xl border border-gray-200/80 shadow-xs space-y-4">
        <div class="flex items-center justify-between border-b pb-3">
          <h2 class="font-black text-gray-900 text-sm flex items-center gap-2">
            <span>👤 기본 회원정보 수정</span>
          </h2>
          <span class="text-[11px] text-gray-400">D1 실시간 동기화</span>
        </div>

        <form @submit.prevent="saveProfile" class="space-y-4 text-xs">
          <div>
            <label class="block font-bold text-gray-700 mb-1">이메일 계정 (아이디)</label>
            <input
              :value="userInfo.email"
              disabled
              type="text"
              class="w-full h-11 px-3.5 rounded-xl border border-gray-200 bg-gray-50 text-gray-500 font-mono cursor-not-allowed"
            />
            <span class="text-[10px] text-gray-400 mt-1 block">이메일은 변경할 수 없습니다.</span>
          </div>

          <div>
            <label class="block font-bold text-gray-700 mb-1">성명 / 닉네임</label>
            <input
              v-model="formName"
              type="text"
              required
              class="w-full h-11 px-3.5 rounded-xl border border-gray-300 focus:outline-none focus:border-[#FF5000]"
            />
          </div>

          <div>
            <label class="block font-bold text-gray-700 mb-1">휴대전화번호</label>
            <input
              v-model="formPhone"
              type="text"
              required
              placeholder="010-0000-0000"
              class="w-full h-11 px-3.5 rounded-xl border border-gray-300 focus:outline-none focus:border-[#FF5000]"
            />
          </div>

          <!-- Notification Checkboxes -->
          <div class="pt-2 border-t border-gray-100 space-y-2">
            <label class="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" v-model="notifySms" class="rounded text-[#FF5000] focus:ring-0" />
              <span class="text-gray-700 font-medium">주문 및 배송 현황 SMS 알림 수신 동의 (필수)</span>
            </label>
            <label class="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" v-model="notifyMarketing" class="rounded text-[#FF5000] focus:ring-0" />
              <span class="text-gray-700 font-medium">올모아 번개특가 & 할인 쿠폰 안내 수신 (선택)</span>
            </label>
          </div>

          <button
            type="submit"
            :disabled="savingProfile"
            class="w-full h-11 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs transition cursor-pointer shadow-sm disabled:opacity-50"
          >
            {{ savingProfile ? '저장 중...' : '회원정보 변경사항 저장' }}
          </button>
        </form>
      </div>

      <!-- Password Change Card -->
      <div class="bg-white p-6 rounded-3xl border border-gray-200/80 shadow-xs space-y-4">
        <div class="flex items-center justify-between border-b pb-3">
          <h2 class="font-black text-gray-900 text-sm flex items-center gap-2">
            <span>🔒 비밀번호 보안 변경</span>
          </h2>
          <span class="text-[11px] text-gray-400">보안 암호화</span>
        </div>

        <form @submit.prevent="handlePasswordChange" class="space-y-4 text-xs">
          <div>
            <label class="block font-bold text-gray-700 mb-1">현재 비밀번호</label>
            <input
              v-model="currentPassword"
              type="password"
              placeholder="현재 사용 중인 비밀번호"
              class="w-full h-11 px-3.5 rounded-xl border border-gray-300 focus:outline-none focus:border-[#FF5000]"
            />
          </div>

          <div>
            <label class="block font-bold text-gray-700 mb-1">새 비밀번호 (6자 이상)</label>
            <input
              v-model="newPassword"
              type="password"
              placeholder="새로운 비밀번호 입력"
              class="w-full h-11 px-3.5 rounded-xl border border-gray-300 focus:outline-none focus:border-[#FF5000]"
            />
          </div>

          <div>
            <label class="block font-bold text-gray-700 mb-1">새 비밀번호 확인</label>
            <input
              v-model="confirmPassword"
              type="password"
              placeholder="새로운 비밀번호 재입력"
              class="w-full h-11 px-3.5 rounded-xl border border-gray-300 focus:outline-none focus:border-[#FF5000]"
            />
          </div>

          <p v-if="pwError" class="text-rose-600 font-bold text-[11px]">{{ pwError }}</p>

          <button
            type="submit"
            :disabled="changingPassword"
            class="w-full h-11 rounded-xl bg-[#FF5000] hover:bg-[#e04700] text-white font-black text-xs transition cursor-pointer shadow-md disabled:opacity-50"
          >
            {{ changingPassword ? '변경 중...' : '새 비밀번호로 변경' }}
          </button>
        </form>
      </div>
    </div>
  </div>
</template>

