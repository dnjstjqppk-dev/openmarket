<script setup lang="ts">
// Notification sender (4-18): audience targeting with live user search,
// message preview and a final confirmation.
import { ref, onMounted } from 'vue'
import { adminApi } from '../../config'
import { userErrorMessage, useConfirm, useToast, OmEmptyState, OmSkeleton } from '@olmoa/ui'

const { confirm: askConfirm } = useConfirm()
const toastApi = useToast()
const U = '문제가 발생했습니다. 잠시 후 다시 시도해주세요.'

const rows = ref<any[]>([])
const loading = ref(true)
const loadError = ref('')
const notifTarget = ref('ALL')
const targetMode = ref<'ALL' | 'SPECIFIC'>('ALL')
const userQuery = ref('')
const userHits = ref<{ id: string; email: string; full_name: string }[]>([])
const searchingUsers = ref(false)
const notifTitle = ref('')
const notifMessage = ref('')
const notifType = ref<'SYSTEM' | 'ORDER_STATUS' | 'DISCOUNT' | 'CREDIT_GRANTED'>('SYSTEM')
const notifActionUrl = ref('/')
const sendingNotif = ref(false)

async function searchUsers() {
  const q = userQuery.value.trim()
  userHits.value = []
  if (q.length < 2) return
  searchingUsers.value = true
  try {
    const r = await adminApi(`/api/v1/admin/users?q=${encodeURIComponent(q)}`)
    if (r.ok && Array.isArray(r.data.data)) userHits.value = r.data.data
  } finally {
    searchingUsers.value = false
  }
}

async function load() {
  loading.value = true
  loadError.value = ''
  try {
    const r = await adminApi('/api/v1/admin/notifications')
    if (!r.ok) throw new Error(r.data.error || '알림 내역을 불러오지 못했습니다.')
    rows.value = Array.isArray(r.data.data) ? r.data.data : []
  } catch (e: any) {
    loadError.value = userErrorMessage(e, U)
  } finally {
    loading.value = false
  }
}

async function handleBroadcastNotification() {
  if (!notifTitle.value.trim() || !notifMessage.value.trim()) return
  const target = targetMode.value === 'ALL' ? 'ALL' : notifTarget.value
  if (targetMode.value === 'SPECIFIC' && (target === 'ALL' || target === 'SPECIFIC' || !target)) {
    toastApi.error('특정 고객을 먼저 검색해 선택해 주세요.')
    return
  }
  const ok = await askConfirm({ title: '알림 발송', body: `[${target}] 대상으로 알림을 발송합니다. 계속할까요?` })
  if (!ok) return
  sendingNotif.value = true
  try {
    const r = await adminApi('/api/v1/admin/notifications', {
      method: 'POST',
      json: { target, title: notifTitle.value.trim(), message: notifMessage.value.trim(), type: notifType.value, action_url: notifActionUrl.value.trim() }
    })
    if (!r.ok) throw new Error(r.data.error || '다시 시도해 주세요.')
    toastApi.success(r.data.message || '알림이 성공적으로 발송되었습니다.')
    notifTitle.value = ''
    notifMessage.value = ''
  } catch (e: any) {
    toastApi.error(`발송에 실패했습니다 — ${userErrorMessage(e, '다시 시도해 주세요.')}`)
  } finally {
    sendingNotif.value = false
  }
  void load()
}

onMounted(() => void load())
</script>

<template>
  <div class="space-y-4">
    <div>
      <h1 class="text-xl font-bold text-ink">알림 발송</h1>
      <p class="mt-1 text-xs text-ink-muted">전체 고객 또는 특정 고객에게 알림 센터 공지를 전달합니다.</p>
    </div>

    <section class="space-y-4 rounded-2xl border border-line bg-surface p-5">
      <div class="grid grid-cols-1 gap-4 text-xs sm:grid-cols-3">
        <div>
          <label class="mb-1 block font-bold text-ink-muted">발송 대상</label>
          <select v-model="targetMode" class="h-10 w-full rounded-lg border border-line bg-surface px-3 font-bold text-ink">
            <option value="ALL">전체 활성 고객</option>
            <option value="SPECIFIC">특정 고객 (아래에서 검색)</option>
          </select>
          <div v-if="targetMode === 'SPECIFIC'" class="mt-2 space-y-2">
            <div class="flex gap-2">
              <input v-model="userQuery" placeholder="고객 id 또는 이메일 앞부분 (2자 이상)" aria-label="고객 검색" class="h-9 flex-1 rounded-lg border border-line bg-surface px-3 text-ink" @keyup.enter="searchUsers" />
              <button type="button" :disabled="searchingUsers" class="h-9 rounded-lg bg-secondary px-3 font-bold text-secondary-on hover:bg-secondary-hover disabled:opacity-60" @click="searchUsers">검색</button>
            </div>
            <select v-if="userHits.length" v-model="notifTarget" aria-label="발송 대상 고객" class="h-10 w-full rounded-lg border border-line bg-surface px-3 font-bold text-ink">
              <option v-for="u in userHits" :key="u.id" :value="u.id">{{ u.email }} ({{ u.full_name || u.id }})</option>
            </select>
            <p v-else class="text-2xs text-ink-subtle">검색 결과가 여기 표시됩니다.</p>
          </div>
        </div>
        <div>
          <label class="mb-1 block font-bold text-ink-muted">알림 유형</label>
          <select v-model="notifType" class="h-10 w-full rounded-lg border border-line bg-surface px-3 font-bold text-ink">
            <option value="SYSTEM">시스템 공지</option>
            <option value="DISCOUNT">특가 & 쿠폰</option>
            <option value="CREDIT_GRANTED">적립금 지급</option>
            <option value="ORDER_STATUS">주문·배송 안내</option>
          </select>
        </div>
        <div>
          <label class="mb-1 block font-bold text-ink-muted">클릭 시 이동 링크</label>
          <input v-model="notifActionUrl" placeholder="예: /deals 또는 /orders" class="h-10 w-full rounded-lg border border-line bg-surface px-3 text-ink" />
        </div>
        <div class="sm:col-span-3">
          <label class="mb-1 block font-bold text-ink-muted">알림 제목 *</label>
          <input v-model="notifTitle" placeholder="예: 주말 깜짝 할인 쿠폰이 도착했습니다." class="h-10 w-full rounded-lg border border-line bg-surface px-3 font-bold text-ink" />
        </div>
        <div class="sm:col-span-3">
          <label class="mb-1 block font-bold text-ink-muted">상세 메시지 *</label>
          <textarea v-model="notifMessage" rows="2" placeholder="고객에게 전달할 상세 내용을 입력하세요." class="w-full rounded-lg border border-line bg-surface p-3 text-ink"></textarea>
        </div>
      </div>

      <div class="rounded-xl bg-surface-2 p-3">
        <p class="mb-1 text-2xs font-bold text-ink-subtle">미리보기</p>
        <p class="text-xs font-bold text-ink">{{ notifTitle || '알림 제목' }}</p>
        <p class="mt-0.5 whitespace-pre-wrap text-xs text-ink-muted">{{ notifMessage || '상세 메시지' }}</p>
      </div>

      <div class="flex justify-end pt-1">
        <button type="button" :disabled="sendingNotif || !notifTitle.trim() || !notifMessage.trim()" class="rounded-xl bg-primary px-6 py-2.5 text-xs font-bold text-primary-on hover:bg-primary-hover disabled:opacity-50" @click="handleBroadcastNotification">
          {{ sendingNotif ? '발송 처리 중...' : '알림 즉시 발송' }}
        </button>
      </div>
    </section>

    <section class="space-y-2 rounded-2xl border border-line bg-surface p-5">
      <div class="flex items-center justify-between">
        <h2 class="text-sm font-bold text-ink">최근 발송 내역</h2>
        <span class="text-xs text-ink-muted">총 {{ rows.length }}건</span>
      </div>
      <div v-if="loading" class="rounded-xl border border-line bg-surface p-4">
        <OmSkeleton variant="row" :count="4" />
      </div>
      <div v-else-if="loadError" role="alert" class="rounded-xl border border-danger bg-danger-soft p-4 text-center text-xs text-danger">
        <p class="font-bold">{{ U }}</p>
        <button type="button" class="mx-auto mt-2 block rounded-full bg-secondary px-4 py-1.5 font-bold text-secondary-on hover:bg-secondary-hover" @click="load">다시 시도</button>
      </div>
      <OmEmptyState v-else-if="!rows.length" compact title="발송된 알림이 없습니다." description="알림을 발송하면 이곳에 표시됩니다." />
      <ul v-else class="divide-y divide-line-divider">
        <li v-for="n in rows" :key="n.id" class="flex flex-col justify-between gap-2 py-3 text-xs sm:flex-row sm:items-center">
          <div>
            <div class="mb-1 flex items-center gap-2">
              <span class="rounded px-2 py-0.5 text-[10px] font-bold" :class="n.type === 'DISCOUNT' ? 'bg-warning-soft text-warning' : n.type === 'ORDER_STATUS' ? 'bg-info-soft text-info' : n.type === 'CREDIT_GRANTED' ? 'bg-success-soft text-success' : 'bg-surface-3 text-ink-muted'">{{ n.type }}</span>
              <span class="font-bold text-ink">{{ n.title }}</span>
              <span class="text-[10px] font-bold" :class="Number(n.is_read) === 1 ? 'text-ink-subtle' : 'text-success'">{{ Number(n.is_read) === 1 ? '읽음' : '미확인' }}</span>
            </div>
            <p class="text-ink-muted">{{ n.message }}</p>
            <p class="mt-1 text-2xs text-ink-subtle">수신자: {{ n.user_id }} {{ n.user_email ? `(${n.user_email})` : '' }} · {{ String(n.created_at || '').slice(0, 16).replace('T', ' ') }}</p>
          </div>
          <div v-if="n.action_url" class="shrink-0 font-mono text-2xs text-primary">{{ n.action_url }}</div>
        </li>
      </ul>
    </section>
  </div>
</template>
