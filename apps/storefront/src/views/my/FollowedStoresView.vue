<script setup lang="ts">
// 3-9: /my/stores — followed stores with unfollow. Unfollow deletes loudly
// with a retry of the same action.
import { ref, onMounted } from 'vue'
import { RouterLink } from 'vue-router'
import { API_BASE_URL, authHeader } from '../../config'
import { userErrorMessage, OmEmptyState, OmErrorState, OmSkeleton } from '@olmoa/ui'
import MyLayout from './MyLayout.vue'

const loading = ref(true)
const loadError = ref('')
const stores = ref<any[]>([])
const actionError = ref('')
let lastAction: (() => Promise<void>) | null = null

const formatDate = (dStr?: string) => {
  if (!dStr) return '-'
  const d = new Date(dStr)
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`
}

const load = async () => {
  loading.value = true
  loadError.value = ''
  try {
    const res = await fetch(`${API_BASE_URL}/api/v1/me/followed-stores`, { headers: { ...authHeader() } })
    const json = await res.json()
    if (!json.success) throw new Error(json.error || '팔로우 스토어를 불러오지 못했습니다.')
    stores.value = json.data
  } catch (e: any) {
    loadError.value = userErrorMessage(e, '팔로우 스토어를 불러오지 못했습니다.')
  } finally {
    loading.value = false
  }
}

const retryAction = async () => {
  if (!lastAction) return
  actionError.value = ''
  await lastAction()
}

const unfollow = async (partnerId: string) => {
  lastAction = () => unfollow(partnerId)
  try {
    const res = await fetch(`${API_BASE_URL}/api/v1/stores/${partnerId}/follow`, {
      method: 'DELETE',
      headers: { ...authHeader() }
    })
    const json = await res.json().catch(() => ({}))
    if (!res.ok || !json.success) throw new Error(json.error || '팔로우를 취소하지 못했습니다. 잠시 후 다시 시도해주세요.')
    stores.value = stores.value.filter((s) => s.partner_id !== partnerId)
    lastAction = null
  } catch (e: any) {
    actionError.value = userErrorMessage(e, '팔로우 취소에 실패했습니다.')
  }
}

onMounted(load)
</script>

<template>
  <MyLayout title="팔로우 스토어">
    <div v-if="loading" class="space-y-3">
      <OmSkeleton variant="row" :count="4" />
    </div>
    <OmErrorState v-else-if="loadError" :message="loadError" @retry="load" />
    <div v-else class="space-y-4">
      <div v-if="actionError" class="flex items-center justify-between gap-3 rounded-xl border border-warning bg-warning-soft p-3.5 text-xs font-bold text-warning">
        <span>{{ actionError }}</span>
        <button type="button" class="shrink-0 rounded-lg border border-line bg-surface px-3 py-1.5 hover:bg-surface-2" @click="retryAction">다시 시도</button>
      </div>
      <ul v-if="stores.length" class="space-y-3">
        <li
          v-for="s in stores"
          :key="s.partner_id"
          class="flex items-center gap-3 rounded-2xl border border-line bg-surface p-4"
        >
          <span class="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary-soft text-base font-bold text-primary-soft-ink" aria-hidden="true">
            {{ (s.business_name || '스').charAt(0) }}
          </span>
          <div class="min-w-0 flex-1">
            <p class="truncate text-sm font-bold text-ink">{{ s.business_name }}</p>
            <p class="om-num mt-0.5 text-2xs text-ink-subtle">판매중 {{ s.product_count }}개 · {{ formatDate(s.followed_at) }}부터 팔로우</p>
          </div>
          <RouterLink
            :to="`/store/${s.partner_id}`"
            class="shrink-0 rounded-xl border border-line px-3 py-2 text-xs font-bold text-ink hover:bg-surface-2"
          >
            스토어 보기
          </RouterLink>
          <button
            type="button"
            class="shrink-0 rounded-xl border border-line px-3 py-2 text-xs font-bold text-ink-muted hover:border-line-strong hover:text-ink"
            @click="unfollow(s.partner_id)"
          >
            팔로우 취소
          </button>
        </li>
      </ul>
      <OmEmptyState
        v-else
        title="팔로우한 스토어가 없습니다"
        description="마음에 드는 스토어를 팔로우하면 여기에 표시됩니다."
      >
        <RouterLink to="/" class="rounded-full bg-primary px-5 py-2.5 text-xs font-bold text-primary-on hover:bg-primary-hover">쇼핑하러 가기</RouterLink>
      </OmEmptyState>
    </div>
  </MyLayout>
</template>
