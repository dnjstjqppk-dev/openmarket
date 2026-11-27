<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { API_BASE_URL, getPartnerHeaders } from '../config'
import { userErrorMessage } from '@olmoa/ui'
import { isValidGtin } from '../utils/gtin'

// The one-click sample batch is a development aid: production sellers only see the CSV template.
const isDev = (import.meta as any).env?.DEV === true

const fileName = ref('')
const parsedItems = ref<any[]>([])
const uploading = ref(false)
const uploadResult = ref<any>(null)
const errorMsg = ref('')
const serverRowErrors = ref<string[]>([])
// Rows that cannot be registered as-is. Nothing is filled in with default prices, stock, category or images.
const rowErrors = ref<string[]>([])
// T-N03: category ID reference (same loader as the single-product form).
const categories = ref<any[]>([])
// 6-11: the whole batch ships under one seller-chosen policy (per-row override via API only).
const policies = ref<any[]>([])
const bulkPolicyId = ref('')
onMounted(async () => {
  try {
    const res = await fetch(`${API_BASE_URL}/api/v1/categories`)
    const json = await res.json().catch(() => null)
    if (res.ok && json?.success && Array.isArray(json.data)) categories.value = json.data
  } catch { /* reference stays hidden */ }
  try {
    const res = await fetch(`${API_BASE_URL}/api/v1/partner/shipping-policies`, { headers: getPartnerHeaders() })
    const json = await res.json().catch(() => null)
    if (res.ok && json?.success && Array.isArray(json.data)) {
      policies.value = json.data
      const def = policies.value.find((p: any) => Number(p.is_default) === 1) || policies.value[0]
      if (def) bulkPolicyId.value = def.id
    }
  } catch { /* selector stays empty; upload validates */ }
})

const sampleCsvContent = `title,brand,manufacturer,model_name,category_id,original_price,sale_price,stock_quantity,option_label,thumbnail_url,gtin,gtin_exempt_reason
"Ultra-Light Carbon Trekking Poles (Pair)",OLMOA OUTDOOR,,,cat_sports,89000,49000,150,"Black / 120cm",https://example.com/sample/trekking-poles.jpg,5901234123457,
"Pro Ceramic Non-Stick Wok 30cm",OLMOA LIVING,,,cat_h_kitchen,75000,42000,200,"30cm Induction",https://example.com/sample/ceramic-wok.jpg,96385074,
"Pure Centella Calming Ampoule 100ml",노브랜드/자체제작,,,cat_beauty,38000,19800,300,"100ml Jumbo",https://example.com/sample/centella-ampoule.jpg,,SELF_MADE`

const downloadSampleCsv = () => {
  const blob = new Blob([sampleCsvContent], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'olmoa_partner_bulk_template.csv'
  a.click()
  URL.revokeObjectURL(url)
}

const parseCsvText = (text: string) => {
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean)
  if (lines.length < 2) return []
  const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''))
  const rows: any[] = []
  rowErrors.value = []
  for (let i = 1; i < lines.length; i++) {
    // Handle quoted CSV fields
    const matches = lines[i].match(/(".*?"|[^",]+)(?=\s*,|\s*$)/g) || []
    const vals = matches.map(v => v.trim().replace(/^"|"$/g, ''))
    const obj: any = {}
    headers.forEach((h, idx) => { obj[h] = vals[idx] || '' })
    const num = (v: string) => (v === undefined || v === '' ? NaN : Number(v))
    const original = num(obj.original_price), sale = num(obj.sale_price), stock = num(obj.stock_quantity)
    const problems: string[] = []
    if (!obj.title) problems.push('상품명 없음')
    if (!obj.brand) problems.push('브랜드 없음')
    if (!Number.isInteger(sale) || sale <= 0) problems.push('판매가 없음/오류')
    if (!Number.isInteger(original) || original < sale) problems.push('정가 없음/판매가보다 낮음')
    if (!Number.isInteger(stock) || stock < 0) problems.push('재고 없음/오류')
    if (!obj.category_id) problems.push('카테고리 없음')
    if (!/^https:\/\//.test(obj.thumbnail_url || '')) problems.push('대표 이미지 URL 없음')
    if (!(obj.gtin || '').trim() && !(obj.gtin_exempt_reason || '').trim()) problems.push('바코드 또는 면제사유 없음')
    else if ((obj.gtin || '').trim() && !isValidGtin(obj.gtin)) problems.push('바코드 형식 오류')
    if (problems.length) {
      rowErrors.value.push(`${i + 1}행 ${obj.title ? `(${obj.title}) ` : ''}— ${problems.join(', ')}`)
      continue
    }
    rows.push({
      title: obj.title,
      brand: obj.brand,
      manufacturer: obj.manufacturer || undefined,
      model_name: obj.model_name || undefined,
      category_id: obj.category_id,
      original_price: original,
      sale_price: sale,
      stock_quantity: stock,
      option_json: JSON.stringify({ 옵션: obj.option_label || '단일' }), // server reads option_json
      thumbnail_url: obj.thumbnail_url,
      gtin: (obj.gtin || '').trim() || undefined,
      gtin_exempt_reason: (obj.gtin || '').trim() ? undefined : (obj.gtin_exempt_reason || '').trim()
    })
  }
  return rows
}

const handleFileSelect = async (e: Event) => {
  const input = e.target as HTMLInputElement
  errorMsg.value = ''
  uploadResult.value = null
  if (input.files && input.files.length > 0) {
    const file = input.files[0]
    fileName.value = file.name
    const text = await file.text()
    parsedItems.value = parseCsvText(text)
    if (parsedItems.value.length === 0) {
      errorMsg.value = isDev ? 'No valid product rows found in CSV. Click "Load Sample Batch" to test.' : 'CSV에서 유효한 상품 행을 찾지 못했습니다. 템플릿 양식에 맞게 작성해 주세요.'
    }
  }
}

const loadSampleBatchDirectly = () => {
  fileName.value = 'olmoa_partner_bulk_template.csv'
  parsedItems.value = parseCsvText(sampleCsvContent)
  errorMsg.value = ''
  uploadResult.value = null
}

const executeBulkUpload = async () => {
  if (parsedItems.value.length === 0) return
  if (!bulkPolicyId.value) { errorMsg.value = '배송정책을 선택해 주세요. 배송정책이 없으면 먼저 등록해 주세요.'; return }
  uploading.value = true
  errorMsg.value = ''
  serverRowErrors.value = []
  try {
    const res = await fetch(`${API_BASE_URL}/api/v1/partner/products/bulk`, {
      method: 'POST',
      headers: getPartnerHeaders(),
      body: JSON.stringify({ shipping_policy_id: bulkPolicyId.value, items: parsedItems.value })
    })
    const json = await res.json()
    if (!res.ok || !json.success) {
      // T-N02: whole-batch rejects carry per-row errors — render them like rowErrors.
      if (Array.isArray(json.errors) && json.errors.length) {
        serverRowErrors.value = json.errors.map((e: any) => (e && typeof e === 'object' ? `${e.row}행: ${e.error}` : String(e)))
      }
      throw new Error(json.error || 'Bulk upload failed')
    }
    uploadResult.value = { ...json.data, warnings: json.warnings || [] }
  } catch (err: any) {
    errorMsg.value = userErrorMessage(err, '업로드하지 못했습니다. 잠시 후 다시 시도해주세요.')
  } finally {
    uploading.value = false
  }
}
</script>

<template>
  <div class="max-w-4xl space-y-6">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h2 class="text-xl font-black text-ink">CSV 대량 상품 등록</h2>
        <p class="text-xs text-ink-muted">상품·SKU·초기 재고를 최대 200개까지 한 번에 등록합니다. 한 건이라도 실패하면 전체가 등록되지 않습니다.</p>
      </div>
      <div class="flex gap-2">
        <button @click="downloadSampleCsv" class="px-3.5 py-2 rounded-xl border border-line bg-surface hover:bg-surface-2 text-xs font-bold cursor-pointer">
          ⬇ CSV 양식 내려받기
        </button>
        <button v-if="isDev" @click="loadSampleBatchDirectly" class="px-3.5 py-2 rounded-xl bg-primary-soft text-primary border border-line text-xs font-black cursor-pointer">
          ⚡ 개발용 테스트 상품 3개 불러오기
        </button>
      </div>
    </div>

    <div class="bg-surface rounded-2xl p-8 border-2 border-dashed border-line text-center">
      <div class="text-4xl mb-3">📦</div>
      <h3 class="text-base font-bold text-ink mb-1">상품 CSV 파일을 선택하세요</h3>
      <p class="text-xs text-ink-muted mb-2">열 순서: title, brand, manufacturer, model_name, category_id, original_price, sale_price, stock_quantity, option_label, thumbnail_url, gtin, gtin_exempt_reason</p>
      <details v-if="categories.length" class="mb-5 text-left text-xs text-ink-muted bg-surface-2 rounded-xl p-3 max-h-40 overflow-y-auto">
        <summary class="font-bold cursor-pointer">카테고리 ID 참조 ({{ categories.length }}개)</summary>
        <ul class="mt-2 space-y-0.5 font-mono"><li v-for="c in categories" :key="c.id">{{ c.id }} — {{ c.name }}</li></ul>
      </details>
      <div v-else class="mb-5"></div>

      <label class="inline-block px-5 py-2.5 rounded-xl bg-secondary hover:bg-secondary-hover text-secondary-on text-xs font-bold cursor-pointer">
        CSV 파일 선택
        <input type="file" accept=".csv" class="hidden" @change="handleFileSelect" />
      </label>

      <div v-if="fileName" class="mt-4 text-xs font-bold text-primary">
        Loaded File: {{ fileName }} ({{ parsedItems.length }} rows parsed)
      </div>
    </div>

    <div v-if="rowErrors.length" class="p-4 rounded-xl bg-warning-soft border border-line text-xs text-warning" role="alert">
      <div class="font-bold mb-1">등록에서 제외된 행 {{ rowErrors.length }}개 (값을 채워 다시 올려 주세요)</div>
      <ul class="list-disc pl-4 space-y-0.5"><li v-for="e in rowErrors" :key="e">{{ e }}</li></ul>
    </div>
    <div v-if="errorMsg" class="p-4 rounded-xl bg-danger-soft border border-line text-xs font-bold text-danger">
      {{ errorMsg }}
    </div>
    <div v-if="serverRowErrors.length" class="p-4 rounded-xl bg-danger-soft border border-line text-xs text-danger" role="alert">
      <div class="font-bold mb-1">서버 반려 행 {{ serverRowErrors.length }}개 (전량 업로드 중단됨)</div>
      <ul class="list-disc pl-4 space-y-0.5 max-h-48 overflow-y-auto"><li v-for="e in serverRowErrors" :key="e">{{ e }}</li></ul>
    </div>

    <!-- Preview Table & Execute Button -->
    <div v-if="parsedItems.length > 0" class="bg-surface rounded-2xl border border-line overflow-hidden shadow-2xs">
      <div class="p-4 bg-surface-2 border-b border-line flex flex-wrap items-center justify-between gap-3">
        <span class="text-xs font-black text-ink">Parsed CSV Batch Preview ({{ parsedItems.length }} items)</span>
        <label class="flex items-center gap-2 text-xs font-bold text-ink">배송정책 (필수)
          <select v-model="bulkPolicyId" class="h-9 rounded-lg border border-line bg-surface px-2 text-ink">
            <option value="" disabled>배송정책 선택</option>
            <option v-for="p in policies" :key="p.id" :value="p.id">{{ p.name }}{{ Number(p.is_default) === 1 ? ' (기본)' : '' }}</option>
          </select>
        </label>
        <button
          @click="executeBulkUpload"
          :disabled="uploading"
          class="px-5 py-2 rounded-xl bg-primary hover:bg-primary-hover text-primary-on text-xs font-black cursor-pointer disabled:opacity-50"
        >
          {{ uploading ? '등록 중…' : `상품 ${parsedItems.length}개 등록` }}
        </button>
      </div>
      <table class="w-full text-left border-collapse text-xs">
        <thead>
          <tr class="border-b border-line text-ink-muted uppercase">
            <th class="py-2.5 px-4">상품명</th>
            <th class="py-2.5 px-4">브랜드</th>
            <th class="py-2.5 px-4">카테고리 ID</th>
            <th class="py-2.5 px-4">정상가</th>
            <th class="py-2.5 px-4">판매가</th>
            <th class="py-2.5 px-4">재고</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-line-divider">
          <tr v-for="(item, idx) in parsedItems" :key="idx">
            <td class="py-2.5 px-4 font-bold text-ink">{{ item.title }}</td>
            <td class="py-2.5 px-4 text-ink-muted">{{ item.brand }}</td>
            <td class="py-2.5 px-4 font-mono text-ink-muted">{{ item.category_id }}</td>
            <td class="py-2.5 px-4 text-ink-subtle line-through">₩{{ item.original_price.toLocaleString() }}</td>
            <td class="py-2.5 px-4 font-black text-price">₩{{ item.sale_price.toLocaleString() }}</td>
            <td class="py-2.5 px-4 font-bold">{{ item.stock_quantity }}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <div v-if="uploadResult" class="p-5 rounded-2xl bg-success-soft border border-line text-xs text-success font-bold">
      ✓ Successfully committed {{ uploadResult.inserted_count }} products & SKUs to Cloudflare D1! (IDs: {{ uploadResult.products.map((p: any) => p.product_id).join(', ') }})
      <ul v-if="uploadResult.warnings && uploadResult.warnings.length" class="mt-2 list-disc pl-4 font-bold text-warning">
        <li v-for="(w, i) in uploadResult.warnings" :key="i">{{ w.message || w }}</li>
      </ul>
    </div>
  </div>
</template>
