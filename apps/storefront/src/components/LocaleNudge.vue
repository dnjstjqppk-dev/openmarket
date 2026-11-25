<script setup lang="ts">
// LocaleNudge (6-2): when a logged-in customer's saved locale differs from
// the URL locale, ask once per session whether to switch. Dismissal is
// remembered in sessionStorage; explicit language choices suppress it.
import { ref, computed, watch, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAuthStore } from '../stores/auth'
import { useLocaleStore, type SupportedLocale } from '../stores/locale'
import { barePathOf } from '@olmoa/ui'

const LABEL: Record<string, string> = { 'ko-KR': '한국어', 'en-US': '영어', 'ja-JP': '일본어' }
const PREFIX: Record<string, string> = { 'ko-KR': '', 'en-US': '/en', 'ja-JP': '/ja' }

const auth = useAuthStore()
const locale = useLocaleStore()
const route = useRoute()
const router = useRouter()
const visible = ref(false)
const saved = ref<SupportedLocale>('ko-KR')

function dismiss() {
  locale.dismissNudge()
  visible.value = false
}

async function check() {
  visible.value = false
  if (!auth.isAuthenticated || locale.nudgeDismissed()) return
  await auth.ensureProfile()
  const serverLocale = (auth.user?.locale || 'ko-KR') as SupportedLocale
  if (!LABEL[serverLocale]) return
  saved.value = serverLocale
  if (locale.locale !== serverLocale) visible.value = true
}

const question = computed(() => `${LABEL[saved.value] || '저장된 언어'}로 계속 볼까요?`)

async function switchToSaved() {
  const target = saved.value
  locale.setLocale(target)
  dismiss()
  const bare = barePathOf(route.path)
  const to = `${PREFIX[target]}${bare === '/' ? '' : bare}` || '/'
  if (to !== route.path) {
    await router.push({ path: to, query: route.query, hash: route.hash }).catch(() => {})
  }
}

watch(() => route.path, () => void check())
watch(() => auth.isAuthenticated, () => void check())
onMounted(() => void check())
</script>

<template>
  <div v-if="visible" role="dialog" aria-live="polite" aria-label="언어 확인"
    class="fixed inset-x-4 bottom-20 z-toast mx-auto max-w-md rounded-2xl border border-line bg-surface p-4 shadow-lg sm:bottom-8">
    <p class="text-sm font-bold text-ink">{{ question }}</p>
    <p class="mt-1 text-xs text-ink-muted">저장된 언어({{ LABEL[saved] }})와 지금 보고 있는 페이지 언어가 다릅니다.</p>
    <div class="mt-3 flex gap-2">
      <button type="button" class="h-9 flex-1 rounded-lg bg-primary text-xs font-bold text-primary-on hover:bg-primary-hover" @click="switchToSaved">
        {{ LABEL[saved] }}로 보기
      </button>
      <button type="button" class="h-9 flex-1 rounded-lg border border-line text-xs font-bold text-ink hover:bg-surface-2" @click="dismiss">
        지금 언어로 계속
      </button>
    </div>
  </div>
</template>
