<script setup lang="ts">
// Seller product registration + edit (4-3): one form for POST (new) and PUT
// (edit). New products land in DRAFT + PENDING review; content edits on a
// live product send it back for re-review (server rule, shown on save).
import { ref, computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { API_BASE_URL, getPartnerHeaders, getPartnerAuthHeaders } from '../../config'
import { userErrorMessage, useToast, OmSkeleton } from '@olmoa/ui'
import ProductImageUploader, { type GalleryImage } from '../../components/product-form/ProductImageUploader.vue'
import OptionMatrixEditor, { type OptionKind } from '../../components/product-form/OptionMatrixEditor.vue'
import SkuTableEditor, { type SkuRow } from '../../components/product-form/SkuTableEditor.vue'
import CategoryPicker from '../../components/product-form/CategoryPicker.vue'
import { NOBRAND_VALUE, isValidGtin } from '../../utils/gtin'

const route = useRoute()
const router = useRouter()
const toastApi = useToast()
const isNew = computed(() => route.path.endsWith('/new'))
const productId = computed(() => String(route.params.id || ''))

const loading = ref(true)
const saving = ref(false)
const loadError = ref('')
const formError = ref('')
const categories = ref<any[]>([])

const form = ref({
  title: '', brand: '', manufacturer: '', model_name: '', category_id: '', country_origin: 'KR', hs_code: '',
  custody_type: 'SEMI_MANAGED', supply_price: null as number | null, warehouse_location: '',
  package_length_cm: null as number | null, package_width_cm: null as number | null,
  package_height_cm: null as number | null, package_weight_kg: null as number | null,
  description_html: '', kc_certified: false, kc_cert_number: '',
  shipping_policy_id: '', bundle_group_key: ''
})
const policies = ref<any[]>([])
const checklist = computed(() => [
  { label: '상품명 8자 이상', done: form.value.title.trim().length >= 8 },
  { label: '카테고리 선택', done: !!form.value.category_id },
  { label: '이미지 1장 이상', done: images.value.length > 0 },
  { label: '상세 40자 이상', done: form.value.description_html.trim().length >= 40 },
  { label: 'SKU 완성', done: skuRows.value.length > 0 && skuRows.value.every((r) => (r.sale_price || 0) >= 100 && (r.stock_quantity ?? -1) >= 0) },
  { label: 'HS·원산지', done: !!form.value.hs_code.trim() && !!form.value.country_origin.trim() }
])
const images = ref<GalleryImage[]>([])
const notice_rows = ref<{ key: string; value: string }[]>([{ key: '', value: '' }])
const kinds = ref<OptionKind[]>([])
const skuRows = ref<SkuRow[]>([])

const parseCombo = (raw: any): Record<string, string> => {
  try {
    const obj = typeof raw === 'string' ? JSON.parse(raw) : raw
    if (obj && typeof obj === 'object') return Object.fromEntries(Object.entries(obj).map(([k, v]) => [String(k), String(v ?? '')]))
  } catch { /* fall through */ }
  return {}
}
const comboKey = (m: Record<string, string>) => JSON.stringify(Object.keys(m).sort().map((k) => [k, m[k]]))

function rebuildRows() {
  const names = kinds.value.map((k) => k.name.trim()).filter(Boolean)
  const lists = kinds.value.filter((k) => k.name.trim()).map((k) => k.values)
  const combos: Record<string, string>[] = [{}]
  names.forEach((name, i) => {
    const vals = lists[i].length ? lists[i] : ['']
    const next: Record<string, string>[] = []
    for (const base of combos) for (const v of vals) next.push({ ...base, ...(v ? { [name]: v } : {}) })
    combos.splice(0, combos.length, ...next)
  })
  const prev = new Map(skuRows.value.map((r) => [r.key, r]))
  skuRows.value = combos.slice(0, 200).map((m) => {
    const key = comboKey(m)
    const old = prev.get(key)
    const label = names.map((n) => m[n]).filter(Boolean).join(' / ') || '기본'
    return old ? { ...old, key, label, combination: m } : { key, label, combination: m, sku_code: '', original_price: null, sale_price: null, stock_quantity: null, safety_stock: null, gtin: '', gtin_exempt: false, gtin_exempt_reason: '', gtin_exempt_other: '' }
  })
}
function onKindsChange(v: OptionKind[]) { kinds.value = v; rebuildRows() }

const quality = computed(() => {
  let s = 0
  if (form.value.title.trim().length >= 8) s += 20
  if (images.value.length > 0) s += 20
  if (form.value.description_html.trim().length >= 40) s += 25
  if (skuRows.value.some((r) => (r.sale_price || 0) > 0 && (r.stock_quantity || 0) > 0)) s += 15
  if (form.value.hs_code.trim()) s += 10
  if (form.value.country_origin.trim()) s += 10
  return Math.min(100, s)
})

const noticeJson = () => {
  const obj: Record<string, string> = {}
  for (const r of notice_rows.value) {
    const k = (r.key || '').trim()
    const v = (r.value || '').trim()
    if (k && v) obj[k] = v
  }
  return Object.keys(obj).length ? obj : null
}

async function uploadDetailImage(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0]
  if (!file) return
  const formData = new FormData()
  formData.append('file', file)
  formData.append('folder', 'details')
  try {
    const res = await fetch(`${API_BASE_URL}/api/v1/storage/upload`, { method: 'POST', headers: getPartnerAuthHeaders(), body: formData })
    const json = await res.json().catch(() => ({}))
    if (!res.ok || !json.success || !json.data?.public_url) throw new Error(json.error || '상세 이미지 업로드에 실패했습니다.')
    form.value.description_html += `\n<img src="${json.data.public_url}" alt="상품 상세 이미지" />\n`
  } catch (err: any) {
    formError.value = userErrorMessage(err, '상세 이미지 업로드에 실패했습니다.')
  } finally {
    (e.target as HTMLInputElement).value = ''
  }
}

async function loadCategories() {
  try {
    const res = await fetch(`${API_BASE_URL}/api/v1/categories`)
    const json = await res.json().catch(() => null)
    if (res.ok && json?.success && Array.isArray(json.data)) categories.value = json.data
  } catch { /* category stays unlisted; submit validates */ }
  try {
    const res = await fetch(`${API_BASE_URL}/api/v1/partner/shipping-policies`, { headers: getPartnerHeaders() })
    const json = await res.json().catch(() => null)
    if (res.ok && json?.success && Array.isArray(json.data)) policies.value = json.data
  } catch { /* policy select stays empty */ }
}

async function loadProduct() {
  loading.value = true
  loadError.value = ''
  try {
    const res = await fetch(`${API_BASE_URL}/api/v1/partner/products/${productId.value}`, { headers: getPartnerHeaders() })
    const json = await res.json().catch(() => null)
    if (!res.ok || !json?.success) throw new Error(json?.error || '상품을 불러오지 못했습니다.')
    const p = json.data
    form.value = {
      title: (p.title || '').slice(0, 200), brand: p.brand || '', manufacturer: p.manufacturer || '', model_name: p.model_name || '', category_id: p.category_id || '', country_origin: p.country_origin || 'KR',
      hs_code: p.hs_code || '', custody_type: p.custody_type || 'SEMI_MANAGED', supply_price: p.supply_price ?? null,
      warehouse_location: p.warehouse_location || '', package_length_cm: p.package_length_cm ?? null,
      package_width_cm: p.package_width_cm ?? null, package_height_cm: p.package_height_cm ?? null,
      package_weight_kg: p.package_weight_kg ?? null, description_html: p.description_html || '',
      kc_certified: Number(p.kc_certified) === 1, kc_cert_number: p.kc_cert_number || '',
      shipping_policy_id: p.shipping_policy_id || '', bundle_group_key: p.bundle_group_key || ''
    }
    images.value = (p.images || []).map((im: any) => ({ image_url: im.image_url, alt_text: im.alt_text || '' }))
    try {
      const obj = typeof p.notice_info_json === 'string' ? JSON.parse(p.notice_info_json) : p.notice_info_json
      const rows = Object.entries(obj || {}).map(([key, value]) => ({ key: String(key), value: String(value ?? '') }))
      notice_rows.value = rows.length ? rows : [{ key: '', value: '' }]
    } catch { notice_rows.value = [{ key: '', value: '' }] }
    // Rebuild kinds from stored combos (the default single-combo stays option-less).
    const skus = p.skus || []
    const names: string[] = []
    for (const s of skus) for (const k of Object.keys(parseCombo(s.option_combination_json))) if (!names.includes(k)) names.push(k)
    const isDefault = skus.length <= 1 && names.length === 1 && names[0] === '옵션'
    kinds.value = isDefault ? [] : names.map((n) => ({ name: n, values: [...new Set(skus.map((s: any) => parseCombo(s.option_combination_json)[n]).filter(Boolean))] as string[] }))
    rebuildRows()
    for (const s of skus) {
      const m = parseCombo(s.option_combination_json)
      const row = skuRows.value.find((r) => r.key === comboKey(isDefault ? {} : m))
      if (row) {
        row.sku_id = s.id
        row.sku_code = s.sku_code || ''
        row.original_price = s.original_price ?? null
        row.sale_price = s.sale_price ?? null
        row.stock_quantity = s.stock_quantity ?? null
        row.safety_stock = s.safety_stock ?? null
        row.gtin = s.gtin || ''
        if (s.gtin_exempt_reason) {
          const [code, ...rest] = String(s.gtin_exempt_reason).split(':')
          row.gtin_exempt = true
          row.gtin_exempt_reason = code
          row.gtin_exempt_other = rest.join(':')
        }
      }
    }
  } catch (e: any) {
    loadError.value = userErrorMessage(e, '상품을 불러오지 못했습니다.')
  } finally {
    loading.value = false
  }
}

async function submit() {
  formError.value = ''
  if (!form.value.title.trim()) { formError.value = '상품명을 입력해 주세요.'; return }
  if (form.value.description_html.includes('[판매자 작성]')) { formError.value = '상세설명의 안내 문구([판매자 작성]…)를 지우고 실제 내용을 입력해 주세요.'; return }
  if (!form.value.category_id) { formError.value = '카테고리를 선택해 주세요.'; return }
  if (!images.value.length) { formError.value = '상품 이미지를 1장 이상 등록해 주세요.'; return }
  if (form.value.kc_certified && !form.value.kc_cert_number.trim()) { formError.value = 'KC 인증 대상 상품은 인증번호를 입력해야 합니다.'; return }
  if (!form.value.shipping_policy_id) { formError.value = '배송정책을 선택해 주세요. 배송정책이 없으면 먼저 등록해 주세요.'; return }
  if (!form.value.brand.trim()) { formError.value = '브랜드를 입력해 주세요. 브랜드가 없으면 "노브랜드/자체제작"을 선택해 주세요.'; return }
  if (!skuRows.value.length || skuRows.value.length > 200) { formError.value = 'SKU는 1~200개여야 합니다.'; return }
  for (const r of skuRows.value) {
    if (r.sale_price === null || r.sale_price < 100 || r.sale_price > 100000000) { formError.value = `판매가를 확인해 주세요 (${r.label}).`; return }
    if (r.stock_quantity === null || r.stock_quantity < 0 || r.stock_quantity > 1000000) { formError.value = `재고를 확인해 주세요 (${r.label}).`; return }
  }
  // 6-12: new products need every barcode-or-reason; edits only validate rows the seller touched.
  const needsIds = (r: SkuRow) => isNew.value || r.gtin.trim() !== '' || r.gtin_exempt
  for (const r of skuRows.value) {
    if (!needsIds(r)) continue
    if (r.gtin_exempt) {
      if (!r.gtin_exempt_reason) { formError.value = `바코드 없음 사유를 선택해 주세요 (${r.label}).`; return }
      if (r.gtin_exempt_reason === 'OTHER' && !r.gtin_exempt_other.trim()) { formError.value = `기타 사유를 직접 입력해 주세요 (${r.label}).`; return }
    } else if (!isValidGtin(r.gtin)) { formError.value = `바코드 형식을 확인해 주세요 (${r.label}). 8·12·13·14자리 숫자와 체크디지트가 맞아야 합니다.`; return }
  }
  const skuIds = (r: SkuRow) => {
    if (!needsIds(r)) return {}
    if (r.gtin_exempt) {
      return { gtin_exempt_reason: r.gtin_exempt_reason === 'OTHER' ? `OTHER:${r.gtin_exempt_other.trim()}` : r.gtin_exempt_reason }
    }
    return { gtin: r.gtin.replace(/[\s-]/g, '') }
  }
  saving.value = true
  try {
    const simple = !kinds.value.length
    const first = skuRows.value[0]
    const body: any = {
      title: form.value.title.trim(), brand: form.value.brand.trim(), category_id: form.value.category_id,
      manufacturer: form.value.manufacturer.trim() || undefined, model_name: form.value.model_name.trim() || undefined,
      thumbnail_url: images.value[0].image_url, images: images.value.map((im) => ({ image_url: im.image_url, alt_text: im.alt_text || '' })),
      description_html: form.value.description_html, notice_info_json: noticeJson(),
      kc_certified: form.value.kc_certified, kc_cert_number: form.value.kc_cert_number.trim() || null,
      hs_code: form.value.hs_code.trim() || undefined, country_origin: form.value.country_origin.trim() || undefined,
      custody_type: form.value.custody_type, supply_price: form.value.supply_price ?? undefined,
      warehouse_location: form.value.warehouse_location.trim() || undefined,
      package_length_cm: form.value.package_length_cm ?? undefined, package_width_cm: form.value.package_width_cm ?? undefined,
      package_height_cm: form.value.package_height_cm ?? undefined, package_weight_kg: form.value.package_weight_kg ?? undefined,
      shipping_policy_id: form.value.shipping_policy_id || undefined, bundle_group_key: form.value.bundle_group_key.trim() || undefined
    }
    if (simple) {
      body.sale_price = first.sale_price
      body.original_price = first.original_price ?? first.sale_price
      body.stock_quantity = first.stock_quantity
      Object.assign(body, skuIds(first))
    } else {
      body.options = kinds.value.map((k) => ({ name: k.name.trim(), values: k.values }))
      body.skus = skuRows.value.map((r) => ({
        ...(r.sku_id ? { id: r.sku_id } : {}),
        option_combination: r.combination, sku_code: r.sku_code.trim() || undefined,
        original_price: r.original_price ?? r.sale_price, sale_price: r.sale_price, stock_quantity: r.stock_quantity,
        safety_stock: r.safety_stock ?? undefined, ...skuIds(r)
      }))
    }
    const res = await fetch(
      isNew.value ? `${API_BASE_URL}/api/v1/partner/products` : `${API_BASE_URL}/api/v1/partner/products/${productId.value}`,
      { method: isNew.value ? 'POST' : 'PUT', headers: getPartnerHeaders(), body: JSON.stringify(body) }
    )
    const json = await res.json().catch(() => ({}))
    if (!res.ok || !json.success) throw new Error(json.error || '저장에 실패했습니다.')
    toastApi.success(isNew.value ? '심사 대기 상태로 등록되었습니다. (DRAFT + PENDING)' : '저장되었습니다. 내용 변경 시 재심사로 전환됩니다.')
    for (const w of (Array.isArray(json.warnings) ? json.warnings : [])) {
      toastApi.warning(w.message || '바코드 중복이 의심됩니다.', { title: '식별정보 확인 필요', timeout: 8000 })
    }
    router.push('/products')
  } catch (e: any) {
    formError.value = userErrorMessage(e, '저장에 실패했습니다.')
  } finally {
    saving.value = false
  }
}

onMounted(async () => {
  await loadCategories()
  if (isNew.value) {
    // 6-11: the seller default only pre-fills the choice (never auto-links).
    const def = policies.value.find((p: any) => Number(p.is_default) === 1) || policies.value[0]
    if (def) form.value.shipping_policy_id = def.id
    loading.value = false
    rebuildRows()
  }
  else await loadProduct()
})
</script>

<template>
  <div class="mx-auto max-w-4xl space-y-6">
    <div>
      <h1 class="text-xl font-bold text-ink">{{ isNew ? '상품 등록' : '상품 수정' }}</h1>
      <p class="mt-1 text-xs text-ink-muted">{{ isNew ? '등록된 상품은 심사 대기(DRAFT + PENDING) 상태로 저장됩니다.' : '내용 변경 시 재심사(DRAFT + PENDING)로 전환됩니다.' }}</p>
    </div>

    <div v-if="loading"><OmSkeleton variant="rect" height="h-64" /></div>
    <div v-else-if="loadError" class="rounded-2xl border border-danger bg-danger-soft p-6 text-center text-xs text-danger" role="alert">
      <p class="font-bold">문제가 발생했습니다. 잠시 후 다시 시도해주세요.</p>
      <p class="mt-1">{{ loadError }}</p>
      <button type="button" class="mx-auto mt-2 block rounded-full bg-secondary px-4 py-1.5 font-bold text-secondary-on hover:bg-secondary-hover" @click="loadProduct">다시 불러오기</button>
    </div>
    <form v-else class="gap-6 lg:flex lg:items-start" @submit.prevent="submit">
      <aside class="mb-4 w-full shrink-0 space-y-2 rounded-2xl border border-line bg-surface p-4 text-xs lg:sticky lg:top-4 lg:mb-0 lg:w-52" aria-label="작성 진행 상황">
        <p class="font-bold text-ink">작성 완성도 <span class="om-num text-primary">{{ quality }}점</span></p>
        <ul class="space-y-1.5">
          <li v-for="c in checklist" :key="c.label" class="flex items-center gap-1.5" :class="c.done ? 'font-bold text-success' : 'text-ink-subtle'">
            <span aria-hidden="true">{{ c.done ? '●' : '○' }}</span> {{ c.label }}
          </li>
        </ul>
      </aside>
      <div class="min-w-0 flex-1 space-y-6">

      <section class="space-y-3 rounded-2xl border border-line bg-surface p-5" aria-label="카테고리">
        <h2 class="text-sm font-bold text-ink">카테고리 *</h2>
        <CategoryPicker v-model="form.category_id" :categories="categories" />
      </section>

      <section class="space-y-3 rounded-2xl border border-line bg-surface p-5" aria-label="기본 정보">
        <h2 class="text-sm font-bold text-ink">기본 정보</h2>
        <div class="grid grid-cols-1 gap-3 text-xs sm:grid-cols-2">
          <label class="space-y-1 sm:col-span-2">상품명(최대 200자) *<input v-model="form.title" maxlength="200" class="h-10 w-full rounded-lg border border-line bg-surface px-3 text-ink focus:outline-none focus:ring-2 focus-visible:ring-focus" /></label>
          <label class="space-y-1">원산지(2자리 국가코드)<input v-model="form.country_origin" maxlength="2" placeholder="KR" class="h-10 w-full rounded-lg border border-line bg-surface px-3 text-ink" /></label>
          <label class="space-y-1">HS 코드<input v-model="form.hs_code" maxlength="12" placeholder="예: 6109.10" class="h-10 w-full rounded-lg border border-line bg-surface px-3 font-mono text-ink" /></label>
          <label class="space-y-1">운영 모델<select v-model="form.custody_type" class="h-10 w-full rounded-lg border border-line bg-surface px-2 text-ink">
            <option value="FULL_MANAGED">전탁 모델</option>
            <option value="SEMI_MANAGED">반탁 모델</option>
          </select></label>
          <label class="space-y-1">공급가<input v-model.number="form.supply_price" type="number" min="0" class="h-10 w-full rounded-lg border border-line bg-surface px-3 text-ink" /></label>
          <label class="space-y-1">창고 위치<input v-model="form.warehouse_location" maxlength="50" class="h-10 w-full rounded-lg border border-line bg-surface px-3 text-ink" /></label>
          <div class="grid grid-cols-4 gap-2 sm:col-span-2">
            <label class="space-y-1">가로cm<input v-model.number="form.package_length_cm" type="number" min="0" class="h-10 w-full rounded-lg border border-line bg-surface px-2 text-ink" /></label>
            <label class="space-y-1">세로cm<input v-model="form.package_width_cm" type="number" min="0" class="h-10 w-full rounded-lg border border-line bg-surface px-2 text-ink" /></label>
            <label class="space-y-1">높이cm<input v-model="form.package_height_cm" type="number" min="0" class="h-10 w-full rounded-lg border border-line bg-surface px-2 text-ink" /></label>
            <label class="space-y-1">무게kg<input v-model.number="form.package_weight_kg" type="number" min="0" step="0.01" class="h-10 w-full rounded-lg border border-line bg-surface px-2 text-ink" /></label>
          </div>
        </div>
      </section>

      <section class="space-y-3 rounded-2xl border border-line bg-surface p-5" aria-label="상품 주요정보">
        <h2 class="text-sm font-bold text-ink">상품 주요정보</h2>
        <div class="grid grid-cols-1 gap-3 text-xs sm:grid-cols-2">
          <div class="space-y-1">
            <label class="block space-y-1">브랜드 *<input v-model="form.brand" maxlength="100" class="h-10 w-full rounded-lg border border-line bg-surface px-3 text-ink" /></label>
            <button type="button" class="text-2xs font-bold text-primary hover:underline" @click="form.brand = NOBRAND_VALUE">브랜드 없음 (노브랜드/자체제작으로 입력)</button>
          </div>
          <label class="space-y-1">제조사<input v-model="form.manufacturer" maxlength="100" class="h-10 w-full rounded-lg border border-line bg-surface px-3 text-ink" /></label>
          <label class="space-y-1 sm:col-span-2">모델명<input v-model="form.model_name" maxlength="100" placeholder="예: ABC-1234" class="h-10 w-full rounded-lg border border-line bg-surface px-3 text-ink" /></label>
        </div>
        <p class="text-2xs text-ink-subtle">바코드는 옵션별 SKU 표에서 입력합니다. 바코드가 없으면 해당 행에서 사유를 선택해 주세요.</p>
      </section>

      <section class="space-y-3 rounded-2xl border border-line bg-surface p-5" aria-label="상품 이미지">
        <h2 class="text-sm font-bold text-ink">상품 이미지 (최대 10장, 첫 장이 대표)</h2>
        <ProductImageUploader v-model="images" />
      </section>

      <section class="space-y-3 rounded-2xl border border-line bg-surface p-5" aria-label="상세 설명">
        <div class="flex items-center justify-between">
          <h2 class="text-sm font-bold text-ink">상세 설명 (HTML)</h2>
          <label class="cursor-pointer rounded-lg border border-line px-3 py-1.5 text-xs font-bold text-ink hover:bg-surface-2">
            <input type="file" accept="image/*" class="hidden" @change="uploadDetailImage" />상세 이미지 삽입
          </label>
        </div>
        <textarea v-model="form.description_html" rows="8" class="w-full rounded-lg border border-line bg-surface p-3 font-mono text-xs text-ink" />
      </section>

      <section class="space-y-3 rounded-2xl border border-line bg-surface p-5" aria-label="상품 고시">
        <h2 class="text-sm font-bold text-ink">상품 고시 (항목/값)</h2>
        <div v-for="(row, i) in notice_rows" :key="i" class="flex gap-2">
          <input v-model="row.key" placeholder="항목 (예: 제조국)" aria-label="고시 항목" class="h-9 w-40 rounded-lg border border-line bg-surface px-3 text-xs text-ink" />
          <input v-model="row.value" placeholder="값" aria-label="고시 값" class="h-9 min-w-0 flex-1 rounded-lg border border-line bg-surface px-3 text-xs text-ink" />
          <button type="button" class="h-9 shrink-0 rounded-lg border border-line px-3 text-xs font-bold text-ink-muted hover:bg-surface-2" @click="notice_rows = notice_rows.filter((_, n) => n !== i)">삭제</button>
        </div>
        <button type="button" class="h-9 rounded-lg border border-line px-3 text-xs font-bold text-ink hover:bg-surface-2" @click="notice_rows = [...notice_rows, { key: '', value: '' }]">고시행 추가</button>
      </section>

      <section class="space-y-3 rounded-2xl border border-line bg-surface p-5" aria-label="KC 인증">
        <h2 class="text-sm font-bold text-ink">KC 인증</h2>
        <label class="flex cursor-pointer items-center gap-2 text-xs font-bold text-ink">
          <input v-model="form.kc_certified" type="checkbox" class="rounded" />KC 인증 대상 상품
        </label>
        <input v-if="form.kc_certified" v-model="form.kc_cert_number" placeholder="KC 인증번호" aria-label="KC 인증번호" class="h-10 w-full rounded-lg border border-line bg-surface px-3 text-xs text-ink sm:w-80" />
      </section>

      <section class="space-y-3 rounded-2xl border border-line bg-surface p-5" aria-label="옵션">
        <h2 class="text-sm font-bold text-ink">옵션 (종류 3개·값 100개·조합 200개 이내)</h2>
        <OptionMatrixEditor :model-value="kinds" @update:model-value="onKindsChange" />
      </section>

      <section class="space-y-3 rounded-2xl border border-line bg-surface p-5" aria-label="SKU">
        <h2 class="text-sm font-bold text-ink">SKU ({{ skuRows.length }}개)</h2>
        <SkuTableEditor v-model="skuRows" />
      </section>

      <section class="space-y-3 rounded-2xl border border-line bg-surface p-5" aria-label="배송">
        <h2 class="text-sm font-bold text-ink">배송</h2>
        <div class="grid grid-cols-1 gap-3 text-xs sm:grid-cols-2">
          <label class="space-y-1">배송정책 (필수)<select v-model="form.shipping_policy_id" class="h-10 w-full rounded-lg border border-line bg-surface px-2 text-ink">
            <option value="" disabled>배송정책 선택</option>
            <option v-for="p in policies" :key="p.id" :value="p.id">{{ p.name }}{{ Number(p.is_default) === 1 ? ' (기본)' : '' }}</option>
          </select></label>
          <label class="space-y-1">묶음배송 그룹<input v-model="form.bundle_group_key" maxlength="60" placeholder="예: BUNDLE-A" class="h-10 w-full rounded-lg border border-line bg-surface px-3 text-ink" /></label>
        </div>
        <p v-if="!policies.length" class="text-xs text-warning">등록된 배송정책이 없습니다. <button type="button" class="font-bold underline" @click="router.push('/store/shipping-policies')">배송정책 먼저 만들기</button></p>
      </section>

      <p v-if="formError" role="alert" class="rounded-xl border border-danger bg-danger-soft px-3 py-2 text-xs font-bold text-danger">{{ formError }}</p>
      <div class="flex gap-2">
        <button type="button" class="h-11 rounded-xl border border-line px-5 text-xs font-bold text-ink hover:bg-surface-2" @click="router.push('/products')">취소</button>
        <button type="submit" :disabled="saving" class="h-11 flex-1 rounded-xl bg-primary text-xs font-bold text-primary-on hover:bg-primary-hover disabled:opacity-50">
          {{ saving ? '저장 중…' : isNew ? '심사 요청 등록' : '저장' }}
        </button>
      </div>
      </div>
    </form>
  </div>
</template>
