<script setup lang="ts">
// Seller-entered product translations (en / ja / zh-tw) for /{lang}/{currency}/p/{id}/{slug}
// (owner work order 2026-11-27, decision 22). Untranslated languages stay unindexed and
// canonicalize to ko — no machine translation is ever generated here.
import { ref, computed, watch } from 'vue'
import { API_BASE_URL, getPartnerHeaders } from '../../config'
import { userErrorMessage, useToast, slugify, DEFAULT_CURRENCY, type Lang } from '@olmoa/ui'

const props = defineProps<{ productId: string }>()
const toast = useToast()

type TrLang = 'en' | 'ja' | 'zh-tw'
const TABS: Array<{ lang: TrLang; label: string; placeholder: string }> = [
  { lang: 'en', label: 'English (en)', placeholder: 'e.g. Wireless Noise-Cancelling Earbuds' },
  { lang: 'ja', label: '日本語 (ja)', placeholder: '例: ワイヤレスノイズキャンセリングイヤホン' },
  { lang: 'zh-tw', label: '繁體中文 (zh-tw)', placeholder: '例: 無線降噪藍牙耳機' }
]

interface TrDraft { title: string; summary: string; saved: boolean; slug: string; updated_at: string | null }
const emptyDraft = (): TrDraft => ({ title: '', summary: '', saved: false, slug: '', updated_at: null })

const activeLang = ref<TrLang>('en')
const drafts = ref<Record<TrLang, TrDraft>>({ en: emptyDraft(), ja: emptyDraft(), 'zh-tw': emptyDraft() })
const loading = ref(false)
const saving = ref(false)
const errorMsg = ref('')

const cur = computed(() => drafts.value[activeLang.value])
const curMeta = computed(() => TABS.find((t) => t.lang === activeLang.value)!)
const previewSlug = computed(() => slugify(cur.value.title) || cur.value.slug || '')
const previewUrl = computed(() => {
  const l = activeLang.value as Lang
  const c = DEFAULT_CURRENCY[l]
  return `/${l}/${c}/p/${props.productId}${previewSlug.value ? `/${previewSlug.value}` : ''}`
})

async function load() {
  if (!props.productId) return
  loading.value = true
  errorMsg.value = ''
  try {
    const res = await fetch(`${API_BASE_URL}/api/v1/partner/products/${encodeURIComponent(props.productId)}/translations`, {
      headers: getPartnerHeaders()
    })
    const json = await res.json().catch(() => null)
    if (!res.ok || !json?.success) throw new Error(json?.error || '번역 정보를 불러오지 못했습니다.')
    const next: Record<TrLang, TrDraft> = { en: emptyDraft(), ja: emptyDraft(), 'zh-tw': emptyDraft() }
    for (const row of json.data?.translations || []) {
      const l = row.lang as TrLang
      if (l in next) {
        next[l] = { title: row.title || '', summary: row.summary || '', saved: true, slug: row.slug || '', updated_at: row.updated_at || null }
      }
    }
    drafts.value = next
  } catch (e: any) {
    errorMsg.value = userErrorMessage(e, '번역 정보를 불러오지 못했습니다.')
  } finally {
    loading.value = false
  }
}

async function saveCurrent() {
  const lang = activeLang.value
  const d = drafts.value[lang]
  const title = d.title.trim()
  if ([...title].length < 2) {
    errorMsg.value = '번역 상품명은 2자 이상 입력해 주세요.'
    return
  }
  saving.value = true
  errorMsg.value = ''
  try {
    const res = await fetch(`${API_BASE_URL}/api/v1/partner/products/${encodeURIComponent(props.productId)}/translations/${lang}`, {
      method: 'PUT',
      headers: getPartnerHeaders(),
      body: JSON.stringify({ title, summary: d.summary.trim() || null })
    })
    const json = await res.json().catch(() => null)
    if (!res.ok || !json?.success) throw new Error(json?.error || '번역을 저장하지 못했습니다.')
    drafts.value[lang] = {
      title: json.data.title,
      summary: json.data.summary || '',
      saved: true,
      slug: json.data.slug || slugify(title),
      updated_at: new Date().toISOString()
    }
    toast.success(`${curMeta.value.label} 번역을 저장했습니다.`)
  } catch (e: any) {
    errorMsg.value = userErrorMessage(e, '번역을 저장하지 못했습니다.')
  } finally {
    saving.value = false
  }
}

async function deleteCurrent() {
  const lang = activeLang.value
  saving.value = true
  errorMsg.value = ''
  try {
    const res = await fetch(`${API_BASE_URL}/api/v1/partner/products/${encodeURIComponent(props.productId)}/translations/${lang}`, {
      method: 'DELETE',
      headers: getPartnerHeaders()
    })
    const json = await res.json().catch(() => null)
    if (!res.ok || !json?.success) throw new Error(json?.error || '번역을 삭제하지 못했습니다.')
    drafts.value[lang] = emptyDraft()
    toast.success(`${curMeta.value.label} 번역을 삭제했습니다.`)
  } catch (e: any) {
    errorMsg.value = userErrorMessage(e, '번역을 삭제하지 못했습니다.')
  } finally {
    saving.value = false
  }
}

watch(() => props.productId, load, { immediate: true })
</script>

<template>
  <section class="space-y-3 rounded-2xl border border-line bg-surface p-5" aria-label="다국어 번역">
    <div class="flex flex-wrap items-baseline justify-between gap-2">
      <h2 class="text-sm font-bold text-ink">다국어 번역 (글로벌 검색 노출)</h2>
      <p class="text-2xs text-ink-subtle">번역을 입력한 언어만 해외 검색(hreflang·사이트맵)에 색인됩니다.</p>
    </div>

    <div class="flex flex-wrap gap-2" role="tablist" aria-label="번역 언어 선택">
      <button
        v-for="tab in TABS"
        :key="tab.lang"
        type="button"
        role="tab"
        :aria-selected="activeLang === tab.lang"
        class="flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-bold transition"
        :class="activeLang === tab.lang ? 'border-primary bg-primary text-primary-on' : 'border-line bg-surface text-ink hover:bg-surface-2'"
        @click="activeLang = tab.lang; errorMsg = ''"
      >
        <span>{{ tab.label }}</span>
        <span class="rounded-full px-1.5 py-0.5 text-2xs" :class="drafts[tab.lang].saved ? 'bg-success-soft text-success' : 'bg-surface-2 text-ink-subtle'">
          {{ drafts[tab.lang].saved ? '등록됨' : '미등록' }}
        </span>
      </button>
    </div>

    <p v-if="loading" class="text-xs text-ink-muted">번역 정보를 불러오는 중…</p>
    <div v-else class="space-y-3 text-xs">
      <label class="block space-y-1">
        <span>번역 상품명 (2~200자)</span>
        <input
          v-model="cur.title"
          maxlength="200"
          :placeholder="curMeta.placeholder"
          class="h-10 w-full rounded-lg border border-line bg-surface px-3 text-ink focus:outline-none focus:ring-2 focus-visible:ring-focus"
        />
      </label>

      <label class="block space-y-1">
        <span>번역 요약 (선택, 최대 2,000자)</span>
        <textarea
          v-model="cur.summary"
          rows="3"
          maxlength="2000"
          placeholder="해외 구매자 및 검색 결과에 표시될 상품 요약을 입력해 주세요."
          class="w-full rounded-lg border border-line bg-surface p-3 text-ink focus:outline-none focus:ring-2 focus-visible:ring-focus"
        />
      </label>

      <p class="truncate rounded-lg bg-surface-2 px-3 py-2 font-mono text-2xs text-ink-muted">
        URL 미리보기: {{ previewUrl }}
      </p>

      <p v-if="errorMsg" role="alert" class="rounded-lg border border-danger bg-danger-soft px-3 py-2 font-bold text-danger">{{ errorMsg }}</p>

      <div class="flex items-center gap-2">
        <button
          type="button"
          :disabled="saving"
          class="h-9 rounded-lg bg-primary px-4 text-xs font-bold text-primary-on hover:bg-primary-hover disabled:opacity-50"
          @click="saveCurrent"
        >
          {{ saving ? '저장 중…' : `${curMeta.label} 저장` }}
        </button>
        <button
          v-if="cur.saved"
          type="button"
          :disabled="saving"
          class="h-9 rounded-lg border border-line px-3 text-xs font-bold text-danger hover:bg-danger-soft disabled:opacity-50"
          @click="deleteCurrent"
        >
          번역 삭제
        </button>
      </div>
    </div>
  </section>
</template>
