<template>
  <div class="mx-auto max-w-4xl space-y-6 rounded-3xl border border-line bg-surface p-8 text-xs leading-relaxed text-ink-muted sm:p-12 sm:text-sm">
    <div role="note" class="rounded-xl border border-warning bg-warning-soft p-3 text-xs font-bold text-warning">본 문서는 법률 검토 전 초안이며 일부 내용은 실제 서비스 정책과 다를 수 있습니다. 정식 서비스 개시 전 확정됩니다.</div>
    <div class="border-b border-line pb-4">
      <span class="text-xs font-bold uppercase tracking-wider text-primary">OLMOA Privacy Policy</span>
      <h1 class="mt-1 text-2xl font-bold text-ink">개인정보처리방침</h1>
      <p v-if="shown" class="mt-1 text-xs text-ink-subtle">시행일자: {{ formatEffectiveDate(shown.effective_date) }} (개인정보보호법 및 정보통신망법 준수) · {{ isCurrent ? '현행' : '이전 버전' }} {{ shown.version }}</p>
    </div>

    <div v-if="loading" class="rounded-2xl border border-line bg-surface-2 p-6 text-xs text-ink-muted">방침을 불러오는 중입니다…</div>
    <div v-else-if="loadError || !shown" class="rounded-2xl border border-danger bg-danger-soft p-6 text-center text-xs text-danger" role="alert">
      <p class="font-bold">방침을 불러오지 못했습니다.</p>
      <p class="mt-1">{{ loadError }}</p>
      <button type="button" class="mx-auto mt-2 block rounded-full bg-secondary px-4 py-1.5 font-bold text-secondary-on hover:bg-secondary-hover" @click="load">다시 시도</button>
    </div>

    <template v-else>
      <div v-if="payload?.notice && isCurrent" class="rounded-xl border border-warning bg-warning-soft p-3 text-xs text-warning" role="note">
        <p class="font-bold">개정 예정 안내: {{ payload.notice.version }}이 {{ formatEffectiveDate(payload.notice.effective_date) }}부터 시행됩니다 (D-{{ payload.notice.days_until_effective }}).</p>
        <button type="button" class="mt-1 font-bold underline underline-offset-2" @click="selectVersion(payload.notice.version)">새 본문 미리보기</button>
      </div>
      <div v-if="!isCurrent" class="rounded-xl border border-line bg-surface-2 p-3 text-xs text-ink-muted" role="note">
        <p>이전 버전을 보고 있습니다. <button type="button" class="font-bold text-primary hover:underline" @click="selectVersion(payload?.current?.version || '')">현행 버전으로 돌아가기</button></p>
      </div>

      <nav class="rounded-2xl border border-line bg-surface-2 p-4" aria-label="목차">
        <p class="mb-2 text-xs font-bold text-ink">목차</p>
        <ol class="grid gap-1 text-xs sm:grid-cols-2">
          <li v-for="t in TOC" :key="t.id"><a :href="`#${t.id}`" class="text-ink-muted hover:text-primary hover:underline">{{ t.label }}</a></li>
        </ol>
      </nav>

      <section v-for="s in sections" :id="s.id" :key="s.id" class="scroll-mt-24 space-y-2">
        <h2 v-if="s.title" class="text-base font-bold text-ink">{{ s.title }}</h2>
        <template v-for="(b, i) in s.blocks" :key="i">
          <p v-if="b.type === 'p'"><template v-for="(part, j) in b.parts" :key="j"><strong v-if="part.bold">{{ part.text }}</strong><template v-else>{{ part.text }}</template></template></p>
          <ul v-else class="list-inside list-disc space-y-1 text-ink-muted">
            <li v-for="(item, k) in b.items" :key="k"><template v-for="(part, j) in item" :key="j"><strong v-if="part.bold">{{ part.text }}</strong><template v-else>{{ part.text }}</template></template></li>
          </ul>
        </template>
      </section>

      <section v-if="isCurrent" class="scroll-mt-24 space-y-2">
        <h2 class="text-base font-bold text-ink">개인정보보호 책임자</h2>
        <p v-if="business.info?.privacy_officer_name || business.info?.privacy_officer_email" data-testid="privacy-officer">
          개인정보 보호책임자: {{ business.info?.privacy_officer_name || '이름 미등록' }} / {{ business.info?.privacy_officer_email || '이메일 미등록' }}
        </p>
        <p v-else-if="business.loaded" data-testid="privacy-officer-missing">개인정보 보호책임자 정보가 아직 등록되지 않았습니다. 정식 서비스 개시 전 확정됩니다.</p>
        <p v-else>개인정보 보호책임자 정보를 불러오는 중입니다…</p>
      </section>

      <section id="versions" class="scroll-mt-24 space-y-2 rounded-2xl border border-line bg-surface-2 p-4">
        <h2 class="text-sm font-bold text-ink">이전 버전</h2>
        <ul class="space-y-1 text-xs">
          <li v-for="d in allDocs" :key="d.version">
            <button type="button" class="hover:text-primary hover:underline" :class="d.version === shown?.version ? 'font-bold text-ink' : 'text-ink-muted'" @click="selectVersion(d.version)">
              {{ d.version }} (시행 {{ formatEffectiveDate(d.effective_date) }}){{ d.version === payload?.current?.version ? ' · 현행' : '' }}
            </button>
          </li>
        </ul>
      </section>
    </template>

    <div class="flex items-center justify-between border-t border-line pt-6 text-xs text-ink-muted">
      <router-link to="/" class="font-bold text-primary hover:underline">&larr; 홈으로 돌아가기</router-link>
      <div class="space-x-3">
        <router-link to="/legal/terms" class="hover:text-ink">이용약관</router-link>
        <router-link to="/legal/refund" class="hover:text-ink">취소·반품·환불 안내</router-link>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
// P2-S16: the officer contact comes from /business-info via the shared store (never hardcoded).
// 5-6: versioned bodies come from GET /api/v1/legal/privacy (current + history + revision notice).
import { ref, computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useBusinessStore } from '../stores/business'
import { API_BASE_URL } from '../config'
import { parseLegalBody, formatEffectiveDate } from '../lib/legal'
import type { LegalPayload } from '../lib/legal'

const VERSION_QUERY_KEY = 'version'

const payload = ref<LegalPayload | null>(null)
const loading = ref(true)
const loadError = ref('')
const selectedVersion = ref('')

const route = useRoute()
const router = useRouter()
const business = useBusinessStore()

async function load() {
  loading.value = true
  loadError.value = ''
  try {
    const res = await fetch(`${API_BASE_URL}/api/v1/legal/privacy`)
    const data = await res.json().catch(() => ({}))
    if (!res.ok || !data.success || !data.data?.current) throw new Error(data.error || '방침을 불러오지 못했습니다.')
    payload.value = data.data as LegalPayload
  } catch (e) {
    loadError.value = e instanceof Error ? e.message : '방침을 불러오지 못했습니다.'
  } finally {
    loading.value = false
  }
}

const allDocs = computed(() => {
  const p = payload.value
  if (!p) return []
  return [...(p.current ? [p.current] : []), ...p.upcoming, ...p.history]
})

const shown = computed(() => {
  const docs = allDocs.value
  return docs.find((d) => d.version === selectedVersion.value) || payload.value?.current || null
})

const isCurrent = computed(() => !!shown.value && !!payload.value?.current && shown.value.version === payload.value.current.version)

const sections = computed(() => (shown.value ? parseLegalBody(shown.value.body) : []))

const TOC = computed(() => [
  ...sections.value.filter((s) => s.title).map((s) => ({ id: s.id, label: s.title })),
  { id: 'versions', label: '이전 버전' }
])

function selectVersion(v: string) {
  selectedVersion.value = v
  const q = { ...route.query }
  if (!v || v === payload.value?.current?.version) delete q[VERSION_QUERY_KEY]
  else q[VERSION_QUERY_KEY] = v
  void router.replace({ query: q })
}

onMounted(() => {
  const q = route.query[VERSION_QUERY_KEY]
  if (typeof q === 'string' && q) selectedVersion.value = q
  void business.load()
  void load()
})
</script>
