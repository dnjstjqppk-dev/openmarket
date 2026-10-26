<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { API_BASE_URL, getAdminHeaders } from '../config'

const activeTab = ref<'BANNERS' | 'NOTIFICATIONS'>('BANNERS')
const loading = ref(true)
const statusMsg = ref('')

// --- Banner State ---
interface Banner {
  id: string
  title: string
  subtitle: string
  badge_text: string
  image_url: string
  link_url: string
  bg_gradient: string
  display_order: number
  is_active: number | boolean
  created_at: string
}

const banners = ref<Banner[]>([])
const showAddBannerModal = ref(false)
const newBanner = ref({
  title: '',
  subtitle: '',
  badge_text: 'HOT DEAL',
  image_url: 'https://images.unsplash.com/photo-1607082348824-0a96f2a4b9da?w=1200',
  link_url: '/deals',
  bg_gradient: 'from-orange-500 to-red-600',
  display_order: 10,
  is_active: true
})

// --- Notification State ---
interface NotificationItem {
  id: string
  user_id: string
  title: string
  message: string
  type: string
  is_read: number
  action_url?: string
  user_email?: string
  created_at: string
}

const notifications = ref<NotificationItem[]>([])
const notifTarget = ref('ALL')
const notifTitle = ref('')
const notifMessage = ref('')
const notifType = ref<'SYSTEM' | 'ORDER_STATUS' | 'DISCOUNT' | 'CREDIT_GRANTED'>('SYSTEM')
const notifActionUrl = ref('/')
const sendingNotif = ref(false)

async function loadBanners() {
  try {
    const res = await fetch(`${API_BASE_URL}/api/v1/admin/banners`, {
      headers: getAdminHeaders()
    })
    const json = await res.json()
    if (json.success && Array.isArray(json.data)) {
      banners.value = json.data
    }
  } catch (e) {
    console.error('Failed to load banners', e)
  }
}

async function loadNotifications() {
  try {
    const res = await fetch(`${API_BASE_URL}/api/v1/admin/notifications`, {
      headers: getAdminHeaders()
    })
    const json = await res.json()
    if (json.success && Array.isArray(json.data)) {
      notifications.value = json.data
    }
  } catch (e) {
    console.error('Failed to load notifications', e)
  }
}

async function loadAll() {
  loading.value = true
  await Promise.all([loadBanners(), loadNotifications()])
  loading.value = false
}

async function handleCreateBanner() {
  if (!newBanner.value.title.trim()) return
  try {
    const res = await fetch(`${API_BASE_URL}/api/v1/admin/banners`, {
      method: 'POST',
      headers: getAdminHeaders(),
      body: JSON.stringify(newBanner.value)
    })
    const json = await res.json()
    if (json.success) {
      statusMsg.value = '✓ 신규 프로모션 배너가 등록되었습니다.'
      showAddBannerModal.value = false
      newBanner.value = {
        title: '',
        subtitle: '',
        badge_text: 'HOT DEAL',
        image_url: 'https://images.unsplash.com/photo-1607082348824-0a96f2a4b9da?w=1200',
        link_url: '/deals',
        bg_gradient: 'from-orange-500 to-red-600',
        display_order: 10,
        is_active: true
      }
      await loadBanners()
    }
  } catch (e) {
    console.error(e)
  }
}

async function toggleBannerActive(b: Banner) {
  try {
    const nextState = !b.is_active
    const res = await fetch(`${API_BASE_URL}/api/v1/admin/banners/${b.id}`, {
      method: 'PUT',
      headers: getAdminHeaders(),
      body: JSON.stringify({ is_active: nextState })
    })
    if (res.ok) {
      b.is_active = nextState ? 1 : 0
      statusMsg.value = `✓ 배너 [${b.title}] 상태가 ${nextState ? '활성' : '비활성'}(으)로 변경되었습니다.`
    }
  } catch (e) {
    console.error(e)
  }
}

async function deleteBanner(id: string) {
  if (!confirm('해당 배너를 삭제하시겠습니까?')) return
  try {
    const res = await fetch(`${API_BASE_URL}/api/v1/admin/banners/${id}`, {
      method: 'DELETE',
      headers: getAdminHeaders()
    })
    if (res.ok) {
      statusMsg.value = '✓ 배너가 성공적으로 삭제되었습니다.'
      await loadBanners()
    }
  } catch (e) {
    console.error(e)
  }
}

async function handleBroadcastNotification() {
  if (!notifTitle.value.trim() || !notifMessage.value.trim()) return
  sendingNotif.value = true
  try {
    const res = await fetch(`${API_BASE_URL}/api/v1/admin/notifications`, {
      method: 'POST',
      headers: getAdminHeaders(),
      body: JSON.stringify({
        target: notifTarget.value,
        title: notifTitle.value.trim(),
        message: notifMessage.value.trim(),
        type: notifType.value,
        action_url: notifActionUrl.value.trim()
      })
    })
    const json = await res.json()
    if (json.success) {
      statusMsg.value = `✓ ${json.message || '알림이 성공적으로 발송되었습니다.'}`
      notifTitle.value = ''
      notifMessage.value = ''
      await loadNotifications()
    }
  } catch (e) {
    console.error(e)
  } finally {
    sendingNotif.value = false
  }
}

onMounted(() => {
  loadAll()
})
</script>

<template>
  <div class="space-y-6">
    <!-- Header -->
    <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-200 pb-4">
      <div>
        <h1 class="text-xl font-black text-slate-900">마케팅 & 고객 알림 센터</h1>
        <p class="text-xs text-slate-500 mt-0.5">스토어프론트 메인 롤링 프로모션 배너 관리 및 전 고객 실시간 푸시 공지 발송</p>
      </div>
      <div class="flex items-center gap-2">
        <button
          @click="activeTab = 'BANNERS'"
          :class="[
            'px-3.5 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer',
            activeTab === 'BANNERS' ? 'bg-orange-500 text-white shadow-xs' : 'bg-white border border-slate-300 text-slate-700 hover:bg-slate-50'
          ]"
        >
          <i class="fa-solid fa-images mr-1.5"></i>프로모션 배너 ({{ banners.length }})
        </button>
        <button
          @click="activeTab = 'NOTIFICATIONS'"
          :class="[
            'px-3.5 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer',
            activeTab === 'NOTIFICATIONS' ? 'bg-orange-500 text-white shadow-xs' : 'bg-white border border-slate-300 text-slate-700 hover:bg-slate-50'
          ]"
        >
          <i class="fa-solid fa-bell mr-1.5"></i>공지 & 알림 발송 ({{ notifications.length }})
        </button>
      </div>
    </div>

    <!-- Alert Banner -->
    <div v-if="statusMsg" class="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-emerald-800 text-xs font-bold flex items-center justify-between">
      <span>{{ statusMsg }}</span>
      <button @click="statusMsg = ''" class="text-emerald-500 hover:text-emerald-700">✕</button>
    </div>

    <div v-if="loading" class="p-16 text-center text-slate-400 text-xs">
      <i class="fa-solid fa-spinner fa-spin text-2xl text-orange-500 mb-2"></i>
      <p>데이터를 불러오는 중입니다...</p>
    </div>

    <!-- TAB 1: BANNERS -->
    <div v-else-if="activeTab === 'BANNERS'" class="space-y-6">
      <div class="flex items-center justify-between">
        <div class="text-xs text-slate-600">
          고객 스토어프론트 홈 히어로 영역에 실시간 노출되는 롤링 배너입니다.
        </div>
        <button
          @click="showAddBannerModal = true"
          class="px-3.5 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-bold shadow-xs transition cursor-pointer flex items-center gap-1.5"
        >
          <i class="fa-solid fa-plus"></i>새 배너 등록
        </button>
      </div>

      <!-- Add Banner Modal -->
      <div v-if="showAddBannerModal" class="bg-white p-6 rounded-2xl border-2 border-indigo-500 shadow-md space-y-4">
        <div class="flex items-center justify-between border-b pb-3">
          <h3 class="text-sm font-black text-slate-900">신규 메인 히어로 배너 생성</h3>
          <button @click="showAddBannerModal = false" class="text-slate-400 hover:text-slate-600">✕</button>
        </div>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
          <div>
            <label class="block font-bold text-slate-700 mb-1">배너 메인 타이틀 *</label>
            <input v-model="newBanner.title" placeholder="예: 봄맞이 글로벌 특가 대전" class="w-full h-9 px-3 rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-indigo-500" />
          </div>
          <div>
            <label class="block font-bold text-slate-700 mb-1">서브 타이틀</label>
            <input v-model="newBanner.subtitle" placeholder="예: 최대 70% 할인 + 전 품목 무료배송" class="w-full h-9 px-3 rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-indigo-500" />
          </div>
          <div>
            <label class="block font-bold text-slate-700 mb-1">뱃지 문구</label>
            <input v-model="newBanner.badge_text" placeholder="예: MEGA SALE" class="w-full h-9 px-3 rounded-lg border border-slate-300" />
          </div>
          <div>
            <label class="block font-bold text-slate-700 mb-1">랜딩 URL</label>
            <input v-model="newBanner.link_url" placeholder="예: /deals 또는 /category/fashion" class="w-full h-9 px-3 rounded-lg border border-slate-300" />
          </div>
          <div>
            <label class="block font-bold text-slate-700 mb-1">배경 그라디언트 CSS</label>
            <select v-model="newBanner.bg_gradient" class="w-full h-9 px-3 rounded-lg border border-slate-300 font-mono">
              <option value="from-orange-500 to-red-600">Orange to Red (from-orange-500 to-red-600)</option>
              <option value="from-indigo-600 to-blue-700">Indigo to Blue (from-indigo-600 to-blue-700)</option>
              <option value="from-emerald-600 to-teal-700">Emerald to Teal (from-emerald-600 to-teal-700)</option>
              <option value="from-purple-600 to-pink-600">Purple to Pink (from-purple-600 to-pink-600)</option>
              <option value="from-slate-800 to-slate-900">Dark Slate (from-slate-800 to-slate-900)</option>
            </select>
          </div>
          <div>
            <label class="block font-bold text-slate-700 mb-1">우선순위 (낮을수록 먼저 노출)</label>
            <input v-model.number="newBanner.display_order" type="number" class="w-full h-9 px-3 rounded-lg border border-slate-300" />
          </div>
        </div>

        <!-- Live Preview -->
        <div>
          <label class="block text-xs font-bold text-slate-500 mb-1.5">실시간 미리보기 (Live Preview)</label>
          <div :class="['rounded-xl p-6 text-white bg-gradient-to-r flex items-center justify-between', newBanner.bg_gradient]">
            <div>
              <span class="inline-block px-2.5 py-0.5 rounded-full bg-white/20 text-[10px] font-black uppercase mb-1.5">
                {{ newBanner.badge_text || 'BADGE' }}
              </span>
              <h4 class="text-xl font-black">{{ newBanner.title || '배너 제목을 입력하세요' }}</h4>
              <p class="text-xs text-white/90 mt-1">{{ newBanner.subtitle || '서브 타이틀 문구' }}</p>
            </div>
            <div class="px-3.5 py-1.5 rounded-full bg-white text-slate-900 text-xs font-bold">
              바로가기 →
            </div>
          </div>
        </div>

        <div class="flex justify-end gap-2 pt-2">
          <button @click="showAddBannerModal = false" class="px-4 py-2 border border-slate-300 rounded-lg text-xs font-bold">취소</button>
          <button @click="handleCreateBanner" class="px-5 py-2 bg-indigo-600 text-white rounded-lg text-xs font-black shadow-xs cursor-pointer">
            배너 저장 및 즉시 배포
          </button>
        </div>
      </div>

      <!-- Banners Card Grid -->
      <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div
          v-for="b in banners"
          :key="b.id"
          class="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-xs hover:border-slate-300 transition"
        >
          <div :class="['p-5 text-white bg-gradient-to-r relative', b.bg_gradient]">
            <div class="flex items-center justify-between mb-2">
              <span class="px-2 py-0.5 rounded-full bg-black/25 text-[10px] font-black uppercase">
                {{ b.badge_text }}
              </span>
              <span
                :class="[
                  'px-2 py-0.5 rounded-full text-[10px] font-black',
                  b.is_active ? 'bg-emerald-500 text-white' : 'bg-slate-800 text-slate-300'
                ]"
              >
                {{ b.is_active ? '● 노출 중 (ACTIVE)' : '○ 비활성 (PAUSED)' }}
              </span>
            </div>
            <h3 class="text-lg font-black">{{ b.title }}</h3>
            <p class="text-xs text-white/90 mt-1">{{ b.subtitle }}</p>
            <div class="mt-3 text-[10px] text-white/70 font-mono">
              Link: {{ b.link_url }} • Order: {{ b.display_order }}
            </div>
          </div>

          <div class="p-4 bg-slate-50 flex items-center justify-between text-xs">
            <span class="text-slate-400 font-mono text-[11px]">ID: {{ b.id }}</span>
            <div class="flex items-center gap-2">
              <button
                @click="toggleBannerActive(b)"
                :class="[
                  'px-3 py-1.5 rounded-lg font-bold transition cursor-pointer',
                  b.is_active ? 'bg-amber-100 text-amber-800 hover:bg-amber-200' : 'bg-emerald-100 text-emerald-800 hover:bg-emerald-200'
                ]"
              >
                {{ b.is_active ? '일시중지' : '노출 재개' }}
              </button>
              <button
                @click="deleteBanner(b.id)"
                class="px-3 py-1.5 bg-rose-50 text-rose-700 hover:bg-rose-100 rounded-lg font-bold transition cursor-pointer"
              >
                삭제
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- TAB 2: NOTIFICATIONS -->
    <div v-else class="space-y-6">
      <!-- Broadcast Sender Card -->
      <div class="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs space-y-4">
        <div class="border-b pb-3">
          <h2 class="text-base font-black text-slate-900">실시간 고객 알림 발송 (Push Notification)</h2>
          <p class="text-xs text-slate-500 mt-0.5">전체 고객 또는 특정 고객에게 상단 종(Bell) 알림 센터로 실시간 공지를 전달합니다.</p>
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs">
          <div>
            <label class="block font-bold text-slate-700 mb-1">발송 대상</label>
            <select v-model="notifTarget" class="w-full h-10 px-3 rounded-lg border border-slate-300 font-bold">
              <option value="ALL">전체 활성 고객 (BROADCAST ALL)</option>
              <option value="u_customer_001">고객 u_customer_001 (Alex Kim)</option>
            </select>
          </div>
          <div>
            <label class="block font-bold text-slate-700 mb-1">알림 유형</label>
            <select v-model="notifType" class="w-full h-10 px-3 rounded-lg border border-slate-300 font-bold">
              <option value="SYSTEM">시스템 공지 (SYSTEM)</option>
              <option value="DISCOUNT">특가 & 쿠폰 (DISCOUNT)</option>
              <option value="CREDIT_GRANTED">적립금 지급 (CREDIT_GRANTED)</option>
              <option value="ORDER_STATUS">주문·배송 안내 (ORDER_STATUS)</option>
            </select>
          </div>
          <div>
            <label class="block font-bold text-slate-700 mb-1">클릭 시 이동할 링크 URL</label>
            <input v-model="notifActionUrl" placeholder="예: /deals 또는 /orders" class="w-full h-10 px-3 rounded-lg border border-slate-300" />
          </div>
          <div class="sm:col-span-3">
            <label class="block font-bold text-slate-700 mb-1">알림 제목 *</label>
            <input v-model="notifTitle" placeholder="예: [올모아 특가] 주말 깜짝 20% 할인 쿠폰이 도착했습니다." class="w-full h-10 px-3 rounded-lg border border-slate-300 font-bold" />
          </div>
          <div class="sm:col-span-3">
            <label class="block font-bold text-slate-700 mb-1">상세 알림 메시지 내용 *</label>
            <textarea v-model="notifMessage" rows="2" placeholder="고객에게 전달할 상세 내용을 입력하세요." class="w-full p-3 rounded-lg border border-slate-300 text-xs focus:ring-2 focus:ring-orange-500 focus:outline-none"></textarea>
          </div>
        </div>

        <div class="flex justify-end pt-2">
          <button
            @click="handleBroadcastNotification"
            :disabled="sendingNotif || !notifTitle.trim() || !notifMessage.trim()"
            class="px-6 py-2.5 bg-orange-500 hover:bg-orange-600 text-white rounded-lg text-xs font-black shadow-xs transition disabled:opacity-50 cursor-pointer"
          >
            <i class="fa-solid fa-paper-plane mr-1.5"></i>
            {{ sendingNotif ? '발송 처리 중...' : '알림 즉시 발송' }}
          </button>
        </div>
      </div>

      <!-- Recent Notifications Log -->
      <div class="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-xs">
        <div class="p-4 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
          <h3 class="text-xs font-black text-slate-900 uppercase tracking-wider">최근 발송된 시스템 알림 내역</h3>
          <span class="text-xs text-slate-500">총 {{ notifications.length }}건</span>
        </div>
        <div class="divide-y divide-slate-100">
          <div
            v-for="n in notifications"
            :key="n.id"
            class="p-4 hover:bg-slate-50 transition flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs"
          >
            <div>
              <div class="flex items-center gap-2 mb-1">
                <span
                  :class="[
                    'px-2 py-0.5 rounded text-[10px] font-black',
                    n.type === 'DISCOUNT' ? 'bg-orange-100 text-orange-700' :
                    n.type === 'ORDER_STATUS' ? 'bg-blue-100 text-blue-700' :
                    n.type === 'CREDIT_GRANTED' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-700'
                  ]"
                >
                  {{ n.type }}
                </span>
                <span class="font-bold text-slate-900">{{ n.title }}</span>
                <span :class="['text-[10px] font-bold', n.is_read ? 'text-slate-400' : 'text-emerald-600']">
                  {{ n.is_read ? '✓ 읽음' : '● 미확인' }}
                </span>
              </div>
              <p class="text-slate-600">{{ n.message }}</p>
              <div class="mt-1 text-[11px] text-slate-400">
                수신자: {{ n.user_id }} {{ n.user_email ? `(${n.user_email})` : '' }} • {{ new Date(n.created_at).toLocaleString() }}
              </div>
            </div>
            <div v-if="n.action_url" class="text-indigo-600 font-mono text-[11px] shrink-0">
              Link: {{ n.action_url }}
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

