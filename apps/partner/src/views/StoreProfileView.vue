<script setup lang="ts">
// Storefront decor (4-9): logo, banner, intro, notice and up to 8 featured
// products (own on-sale goods only, server-enforced).
import { ref, onMounted } from 'vue'
import { API_BASE_URL, getPartnerHeaders, getPartnerAuthHeaders } from '../config'
import { userErrorMessage, useToast, OmSkeleton } from '@olmoa/ui'

const toastApi = useToast()
const U = '문제가 발생했습니다. 잠시 후 다시 시도해주세요.'

const loading = ref(true)
const loadError = ref('')
const saving = ref(false)
const formError = ref('')
const logoUrl = ref('')
const bannerUrl = ref('')
const intro = ref('')
const notice = ref('')
const featured = ref<string[]>([])
const products = ref<any[]>([])
const uploading = ref<'logo' | 'banner' | null>(null)

async function uploadImage(e: Event, which: 'logo' | 'banner') {
  const file = (e.target as HTMLInputElement).files?.[0]
  if (!file) return
  uploading.value = which
  try {
    const formData = new FormData()
    formData.append('file', file)
    formData.append('folder', 'stores')
    const res = await fetch(`${API_BASE_URL}/api/v1/storage/upload`, { method: 'POST', headers: getPartnerAuthHeaders(), body: formData })
    const json = await res.json().catch(() => ({}))
    if (!res.ok || !json.success || !json.data?.public_url) throw new Error(json.error || '이미지 업로드에 실패했습니다.')
    if (which === 'logo') logoUrl.value = json.data.public_url
    else bannerUrl.value = json.data.public_url
  } catch (err: any) {
    formError.value = userErrorMessage(err, '이미지 업로드에 실패했습니다.')
  } finally {
    uploading.value = null
    ;(e.target as HTMLInputElement).value = ''
  }
}

async function load() {
  loading.value = true
  loadError.value = ''
  try {
    const [pr, pd] = await Promise.all([
      fetch(`${API_BASE_URL}/api/v1/partner/store-profile`, { headers: getPartnerHeaders() }).then((r) => r.json().catch(() => null)),
      fetch(`${API_BASE_URL}/api/v1/partner/products?status=ACTIVE&per_page=200`, { headers: getPartnerHeaders() }).then((r) => r.json().catch(() => null))
    ])
    const prof = pr?.data?.profile || null
    if (prof) {
      logoUrl.value = prof.logo_url || ''
      bannerUrl.value = prof.banner_url || ''
      intro.value = prof.intro || ''
      notice.value = prof.notice || ''
      try {
        const ids = JSON.parse(prof.featured_product_ids_json || '[]')
        featured.value = Array.isArray(ids) ? ids.map(String) : []
      } catch { featured.value = [] }
    }
    const seen = new Map<string, any>()
    for (const r of (Array.isArray(pd?.data) ? pd.data : [])) {
      if (!seen.has(r.id)) seen.set(r.id, { id: r.id, title: r.title, thumbnail_url: r.thumbnail_url })
    }
    products.value = [...seen.values()]
  } catch (e: any) {
    loadError.value = userErrorMessage(e, U)
  } finally {
    loading.value = false
  }
}

function toggleFeatured(id: string) {
  if (featured.value.includes(id)) featured.value = featured.value.filter((x) => x !== id)
  else if (featured.value.length < 8) featured.value = [...featured.value, id]
  else toastApi.error('대표 상품은 최대 8개까지 지정할 수 있습니다.')
}

async function save() {
  saving.value = true
  formError.value = ''
  try {
    const res = await fetch(`${API_BASE_URL}/api/v1/partner/store-profile`, {
      method: 'PUT', headers: getPartnerHeaders(),
      body: JSON.stringify({
        logo_url: logoUrl.value.trim() || null, banner_url: bannerUrl.value.trim() || null,
        intro: intro.value.trim() || null, notice: notice.value.trim() || null,
        featured_product_ids: featured.value
      })
    })
    const json = await res.json().catch(() => ({}))
    if (!res.ok || !json.success) throw new Error(json.error || '저장에 실패했습니다.')
    toastApi.success('스토어 장식이 저장되었습니다.')
  } catch (e: any) {
    formError.value = userErrorMessage(e, '저장에 실패했습니다.')
  } finally {
    saving.value = false
  }
}

onMounted(() => void load())
</script>

<template>
  <div class="mx-auto max-w-4xl space-y-6">
    <h1 class="text-xl font-bold text-ink">스토어 장식</h1>

    <div v-if="loading" class="rounded-2xl border border-line bg-surface p-6">
      <p class="mb-3 text-xs text-ink-muted">불러오는 중입니다…</p>
      <OmSkeleton variant="rect" height="h-40" />
    </div>
    <div v-else-if="loadError" class="rounded-2xl border border-danger bg-danger-soft p-6 text-center text-xs text-danger" role="alert">
      <p class="font-bold">{{ U }}</p>
      <p class="mt-1">{{ loadError }}</p>
      <button type="button" class="mx-auto mt-2 block rounded-full bg-secondary px-4 py-1.5 font-bold text-secondary-on hover:bg-secondary-hover" @click="load">다시 불러오기</button>
    </div>
    <div v-else class="space-y-6">
      <section class="space-y-3 rounded-2xl border border-line bg-surface p-5" aria-label="로고와 배너">
        <h2 class="text-sm font-bold text-ink">로고와 배너</h2>
        <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div class="space-y-2">
            <img v-if="logoUrl" :src="logoUrl" alt="스토어 로고 미리보기" loading="lazy" decoding="async" class="h-16 w-16 rounded-lg border border-line object-cover" />
            <label class="flex h-10 cursor-pointer items-center justify-center rounded-xl border border-dashed border-line-strong text-xs font-bold text-ink-muted hover:bg-surface-2">
              <input type="file" accept="image/*" class="hidden" :disabled="uploading !== null" @change="uploadImage($event, 'logo')" />
              {{ uploading === 'logo' ? '업로드 중…' : '로고 업로드' }}
            </label>
          </div>
          <div class="space-y-2">
            <img v-if="bannerUrl" :src="bannerUrl" alt="스토어 배너 미리보기" loading="lazy" decoding="async" class="h-16 w-full rounded-lg border border-line object-cover" />
            <label class="flex h-10 cursor-pointer items-center justify-center rounded-xl border border-dashed border-line-strong text-xs font-bold text-ink-muted hover:bg-surface-2">
              <input type="file" accept="image/*" class="hidden" :disabled="uploading !== null" @change="uploadImage($event, 'banner')" />
              {{ uploading === 'banner' ? '업로드 중…' : '배너 업로드' }}
            </label>
            <p class="text-2xs text-ink-subtle">권장 크기 1920×400</p>
          </div>
        </div>
      </section>

      <section class="space-y-3 rounded-2xl border border-line bg-surface p-5" aria-label="소개와 공지">
        <h2 class="text-sm font-bold text-ink">소개와 공지</h2>
        <label class="block space-y-1 text-xs font-bold text-ink-muted">소개 (최대 1000자)
          <textarea v-model="intro" rows="3" maxlength="1000" class="w-full rounded-lg border border-line bg-surface p-3 font-normal text-ink" />
        </label>
        <label class="block space-y-1 text-xs font-bold text-ink-muted">공지 (최대 2000자)
          <textarea v-model="notice" rows="3" maxlength="2000" class="w-full rounded-lg border border-line bg-surface p-3 font-normal text-ink" />
        </label>
      </section>

      <section class="space-y-3 rounded-2xl border border-line bg-surface p-5" aria-label="대표 상품">
        <h2 class="text-sm font-bold text-ink">대표 상품 ({{ featured.length }}/8, 판매중만)</h2>
        <p v-if="!products.length" class="text-xs text-ink-muted">판매 중인 상품이 없습니다.</p>
        <ul v-else class="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <li v-for="p in products" :key="p.id">
            <button type="button" :aria-pressed="featured.includes(p.id)" :class="['w-full rounded-xl border p-2 text-left', featured.includes(p.id) ? 'border-primary' : 'border-line hover:border-line-strong']" @click="toggleFeatured(p.id)">
              <img v-if="p.thumbnail_url" :src="p.thumbnail_url" :alt="p.title" loading="lazy" decoding="async" class="aspect-square w-full rounded-lg object-cover" />
              <p class="mt-1 truncate text-xs font-bold text-ink">{{ p.title }}</p>
            </button>
          </li>
        </ul>
      </section>

      <p v-if="formError" role="alert" class="rounded-xl border border-danger bg-danger-soft px-3 py-2 text-xs font-bold text-danger">{{ formError }}</p>
      <div class="flex justify-end">
        <button type="button" :disabled="saving" class="h-11 rounded-xl bg-primary px-8 text-xs font-bold text-primary-on hover:bg-primary-hover disabled:opacity-50" @click="save">
          {{ saving ? '저장 중…' : '저장' }}
        </button>
      </div>
    </div>
  </div>
</template>
