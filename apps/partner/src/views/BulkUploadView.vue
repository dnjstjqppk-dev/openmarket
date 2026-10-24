<script setup lang="ts">
import { ref } from 'vue'
import { API_BASE_URL, getPartnerHeaders } from '../config'

const fileName = ref('')
const parsedItems = ref<any[]>([])
const uploading = ref(false)
const uploadResult = ref<any>(null)
const errorMsg = ref('')

const sampleCsvContent = `title,brand,category_id,original_price,sale_price,stock_quantity,option_label,thumbnail_url
"Ultra-Light Carbon Trekking Poles (Pair)",OLMOA OUTDOOR,cat_s_camp,89000,49000,150,"Black / 120cm",https://images.unsplash.com/photo-1551632811-561732d1e306?auto=format&fit=crop&w=600&q=80
"Pro Ceramic Non-Stick Wok 30cm",OLMOA LIVING,cat_h_cook,75000,42000,200,"30cm Induction",https://images.unsplash.com/photo-1584990347449-a2d4c2c044c9?auto=format&fit=crop&w=600&q=80
"Pure Centella Calming Ampoule 100ml",OLMOA BEAUTY,cat_b_skin,38000,19800,300,"100ml Jumbo",https://images.unsplash.com/photo-1620916566398-39f1143ab7be?auto=format&fit=crop&w=600&q=80`

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
  for (let i = 1; i < lines.length; i++) {
    // Handle quoted CSV fields
    const matches = lines[i].match(/(".*?"|[^",]+)(?=\s*,|\s*$)/g) || []
    const vals = matches.map(v => v.trim().replace(/^"|"$/g, ''))
    const obj: any = {}
    headers.forEach((h, idx) => { obj[h] = vals[idx] || '' })
    if (obj.title) {
      rows.push({
        title: obj.title,
        brand: obj.brand || 'OLMOA PARTNER',
        category_id: obj.category_id || 'cat_e_audio',
        original_price: Number(obj.original_price) || 50000,
        sale_price: Number(obj.sale_price) || 35000,
        stock_quantity: Number(obj.stock_quantity) || 100,
        option_values_json: JSON.stringify({ Option: obj.option_label || 'Standard' }),
        thumbnail_url: obj.thumbnail_url || 'https://images.unsplash.com/photo-1523275335684-37898b6baf30?auto=format&fit=crop&w=600&q=80'
      })
    }
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
      errorMsg.value = 'No valid product rows found in CSV. Click "Load Sample Batch" to test.'
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
  uploading.value = true
  errorMsg.value = ''
  try {
    const res = await fetch(`${API_BASE_URL}/api/v1/partner/products/bulk`, {
      method: 'POST',
      headers: getPartnerHeaders(),
      body: JSON.stringify({ items: parsedItems.value })
    })
    const json = await res.json()
    if (!res.ok || !json.success) throw new Error(json.error || 'Bulk upload failed')
    uploadResult.value = json.data
  } catch (err: any) {
    errorMsg.value = err.message || 'Network error'
  } finally {
    uploading.value = false
  }
}
</script>

<template>
  <div class="max-w-4xl space-y-6">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h2 class="text-xl font-black text-gray-900">Mass SKU & Product Registration (CSV Batch Engine)</h2>
        <p class="text-xs text-gray-500">Atomically insert up to 200 products, SKUs, and initial inventory ledger records into D1</p>
      </div>
      <div class="flex gap-2">
        <button @click="downloadSampleCsv" class="px-3.5 py-2 rounded-xl border border-gray-300 bg-white hover:bg-gray-50 text-xs font-bold cursor-pointer">
          ⬇ Download CSV Template
        </button>
        <button @click="loadSampleBatchDirectly" class="px-3.5 py-2 rounded-xl bg-orange-50 text-[#FF5000] border border-orange-200 text-xs font-black cursor-pointer">
          ⚡ Load Sample 3-Product Batch
        </button>
      </div>
    </div>

    <div class="bg-white rounded-2xl p-8 border-2 border-dashed border-gray-300 text-center">
      <div class="text-4xl mb-3">📦</div>
      <h3 class="text-base font-bold text-gray-800 mb-1">Drop your Catalog CSV file here</h3>
      <p class="text-xs text-gray-500 mb-5">Columns: title, brand, category_id, original_price, sale_price, stock_quantity, option_label, thumbnail_url</p>

      <label class="inline-block px-5 py-2.5 rounded-xl bg-gray-900 hover:bg-gray-800 text-white text-xs font-bold cursor-pointer">
        Select CSV File
        <input type="file" accept=".csv" class="hidden" @change="handleFileSelect" />
      </label>

      <div v-if="fileName" class="mt-4 text-xs font-bold text-[#FF5000]">
        Loaded File: {{ fileName }} ({{ parsedItems.length }} rows parsed)
      </div>
    </div>

    <div v-if="errorMsg" class="p-4 rounded-xl bg-red-50 border border-red-200 text-xs font-bold text-red-600">
      {{ errorMsg }}
    </div>

    <!-- Preview Table & Execute Button -->
    <div v-if="parsedItems.length > 0" class="bg-white rounded-2xl border border-gray-200 overflow-hidden shadow-2xs">
      <div class="p-4 bg-gray-50 border-b border-gray-200 flex items-center justify-between">
        <span class="text-xs font-black text-gray-800">Parsed CSV Batch Preview ({{ parsedItems.length }} items)</span>
        <button
          @click="executeBulkUpload"
          :disabled="uploading"
          class="px-5 py-2 rounded-xl bg-[#FF5000] hover:bg-[#E04600] text-white text-xs font-black cursor-pointer disabled:opacity-50"
        >
          {{ uploading ? 'Executing D1 Batch Insert...' : `Commit ${parsedItems.length} Products to D1` }}
        </button>
      </div>
      <table class="w-full text-left border-collapse text-xs">
        <thead>
          <tr class="border-b border-gray-200 text-gray-500 uppercase">
            <th class="py-2.5 px-4">Title</th>
            <th class="py-2.5 px-4">Brand</th>
            <th class="py-2.5 px-4">Category ID</th>
            <th class="py-2.5 px-4">Orig Price</th>
            <th class="py-2.5 px-4">Sale Price</th>
            <th class="py-2.5 px-4">Stock</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-gray-100">
          <tr v-for="(item, idx) in parsedItems" :key="idx">
            <td class="py-2.5 px-4 font-bold text-gray-900">{{ item.title }}</td>
            <td class="py-2.5 px-4 text-gray-600">{{ item.brand }}</td>
            <td class="py-2.5 px-4 font-mono text-gray-500">{{ item.category_id }}</td>
            <td class="py-2.5 px-4 text-gray-400 line-through">₩{{ item.original_price.toLocaleString() }}</td>
            <td class="py-2.5 px-4 font-black text-[#FF5000]">₩{{ item.sale_price.toLocaleString() }}</td>
            <td class="py-2.5 px-4 font-bold">{{ item.stock_quantity }}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <div v-if="uploadResult" class="p-5 rounded-2xl bg-emerald-50 border border-emerald-200 text-xs text-emerald-900 font-bold">
      ✓ Successfully committed {{ uploadResult.inserted_count }} products & SKUs to Cloudflare D1! (IDs: {{ uploadResult.products.map((p: any) => p.product_id).join(', ') }})
    </div>
  </div>
</template>
