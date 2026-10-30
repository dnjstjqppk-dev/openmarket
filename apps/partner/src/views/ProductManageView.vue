<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { API_BASE_URL, getPartnerHeaders, getPartnerId } from '../config'

const products = ref<any[]>([])
const loading = ref(true)
const toast = ref('')

const showCreateModal = ref(false)
const newProd = ref({
  title: '',
  brand: 'OLMOA DIRECT',
  category_id: 'cat_e_audio',
  original_price: 89000,
  sale_price: 59000,
  stock_quantity: 120,
  hs_code: '6109.10',
  country_origin: 'KR',
  warehouse_location: 'INCHEON_FBO',
  package_length_cm: 25,
  package_width_cm: 20,
  package_height_cm: 12,
  package_weight_kg: 0.8,
  thumbnail_url: 'https://images.unsplash.com/photo-1505740420928-5e560c06d30e?auto=format&fit=crop&w=600&q=80'
})

const volumetricWeightKg = computed(() => {
  const l = Number(newProd.value.package_length_cm) || 0
  const w = Number(newProd.value.package_width_cm) || 0
  const h = Number(newProd.value.package_height_cm) || 0
  return Math.round(((l * w * h) / 5000) * 100) / 100
})

const chargeableWeightKg = computed(() => {
  return Math.max(Number(newProd.value.package_weight_kg) || 0, volumetricWeightKg.value)
})

const loadProducts = async () => {
  loading.value = true
  try {
    const res = await fetch(`${API_BASE_URL}/api/v1/partner/products`, {
      headers: getPartnerHeaders()
    })
    const json = await res.json()
    if (json.success && Array.isArray(json.data) && json.data.length > 0) {
      products.value = json.data.map((p: any) => ({
        ...p,
        editPrice: p.sale_price ?? p.lowest_sale_price ?? 0,
        editStock: p.stock_quantity ?? 100
      }))
    } else {
      const pubRes = await fetch(`${API_BASE_URL}/api/v1/products`)
      const pubJson = await pubRes.json()
      if (pubJson.success && Array.isArray(pubJson.data)) {
        const pid = getPartnerId()
        const list = pubJson.data.filter((p: any) => !p.partner_id || p.partner_id === pid)
        products.value = (list.length > 0 ? list : pubJson.data).map((p: any) => ({
          ...p,
          editPrice: p.lowest_sale_price,
          editStock: 100
        }))
      }
    }
  } catch (e) {
    console.error(e)
  } finally {
    loading.value = false
  }
}

const saveProductChanges = async (p: any) => {
  try {
    await Promise.all([
      fetch(`${API_BASE_URL}/api/v1/partner/products/${p.id}/price`, {
        method: 'PUT',
        headers: getPartnerHeaders(),
        body: JSON.stringify({ sale_price: Number(p.editPrice), original_price: Number(p.lowest_original_price) })
      }),
      fetch(`${API_BASE_URL}/api/v1/partner/products/${p.id}/stock`, {
        method: 'PUT',
        headers: getPartnerHeaders(),
        body: JSON.stringify({ stock_quantity: Number(p.editStock) })
      })
    ])
    toast.value = `✓ Updated price (₩${Number(p.editPrice).toLocaleString()}) & stock (${p.editStock}) for "${p.title}"`
    setTimeout(() => { toast.value = '' }, 3000)
  } catch (e) {
    console.error(e)
  }
}

const createNewProduct = async () => {
  if (!newProd.value.title.trim()) return
  try {
    const res = await fetch(`${API_BASE_URL}/api/v1/partner/products`, {
      method: 'POST',
      headers: getPartnerHeaders(),
      body: JSON.stringify({
        ...newProd.value,
        price: newProd.value.sale_price
      })
    })
    const json = await res.json()
    if (json.success) {
      showCreateModal.value = false
      toast.value = `✓ Registered global product "${newProd.value.title}" (HS: ${newProd.value.hs_code}, Vol Weight: ${volumetricWeightKg.value}kg)`
      newProd.value.title = ''
      await loadProducts()
    }
  } catch {}
}

onMounted(loadProducts)
</script>

<template>
  <div class="space-y-6">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h2 class="text-xl font-black text-gray-900 flex items-center gap-2">
          <span>Global Catalog, HS Code & SKU Inventory Control</span>
          <span class="px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-600 text-[10px] font-bold">HS Code & Volumetric Weight</span>
        </h2>
        <p class="text-xs text-gray-500">Real-time synchronization with D1 Edge Database, Customs HS Classification, and Multi-Warehouse Ledger</p>
      </div>
      <div class="flex items-center gap-3">
        <div v-if="toast" class="px-4 py-2 rounded-xl bg-emerald-600 text-white text-xs font-bold shadow-sm">
          {{ toast }}
        </div>
        <button
          @click="showCreateModal = true"
          class="px-4 py-2.5 rounded-xl bg-[#FF5000] hover:bg-[#E04600] text-white text-xs font-black cursor-pointer shadow-xs"
        >
          + Register Global Product
        </button>
      </div>
    </div>

    <!-- Create Product Modal -->
    <div v-if="showCreateModal" class="bg-white rounded-2xl p-6 border-2 border-[#FF5000] shadow-lg space-y-5">
      <div class="flex items-center justify-between border-b pb-3">
        <h3 class="text-sm font-black text-gray-900">Register Global Cross-Border Product & Default SKU</h3>
        <button @click="showCreateModal = false" class="text-xs text-gray-400 cursor-pointer">Close ✕</button>
      </div>

      <div class="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs">
        <div class="sm:col-span-2">
          <label class="block font-bold text-gray-700 mb-1">Product Title (상품명)</label>
          <input v-model="newProd.title" placeholder="e.g., Pro Wireless ANC Studio Headphones" class="w-full h-9 px-3 rounded-lg border border-gray-300" />
        </div>
        <div>
          <label class="block font-bold text-gray-700 mb-1">Brand (브랜드)</label>
          <input v-model="newProd.brand" class="w-full h-9 px-3 rounded-lg border border-gray-300" />
        </div>
        <div>
          <label class="block font-bold text-gray-700 mb-1">Original Price (정상가 KRW)</label>
          <input v-model.number="newProd.original_price" type="number" class="w-full h-9 px-3 rounded-lg border border-gray-300" />
        </div>
        <div>
          <label class="block font-bold text-gray-700 mb-1">Direct Sale Price (판매가 KRW)</label>
          <input v-model.number="newProd.sale_price" type="number" class="w-full h-9 px-3 rounded-lg border border-gray-300" />
        </div>
        <div>
          <label class="block font-bold text-gray-700 mb-1">Initial Stock Quantity (초기 재고)</label>
          <input v-model.number="newProd.stock_quantity" type="number" class="w-full h-9 px-3 rounded-lg border border-gray-300" />
        </div>

        <!-- Global Customs & Fulfillment Fields -->
        <div>
          <label class="block font-bold text-gray-700 mb-1">HS Code (관세 품목분류코드)</label>
          <select v-model="newProd.hs_code" class="w-full h-9 px-2.5 rounded-lg border border-gray-300 bg-white font-mono">
            <option value="6109.10">6109.10 (면 티셔츠/의류)</option>
            <option value="8517.13">8517.13 (스마트폰/무선통신)</option>
            <option value="8518.30">8518.30 (헤드폰/이어폰)</option>
            <option value="3304.99">3304.99 (기초화장품/스킨케어)</option>
            <option value="6404.11">6404.11 (스포츠화/운동화)</option>
            <option value="9503.00">9503.00 (완구/취미용품)</option>
          </select>
        </div>
        <div>
          <label class="block font-bold text-gray-700 mb-1">Country of Origin (원산지/제조국)</label>
          <select v-model="newProd.country_origin" class="w-full h-9 px-2.5 rounded-lg border border-gray-300 bg-white">
            <option value="KR">🇰🇷 대한민국 (KR)</option>
            <option value="US">🇺🇸 미국 (US - $200 면세)</option>
            <option value="CN">🇨🇳 중국 (CN - $150 면세)</option>
            <option value="JP">🇯🇵 일본 (JP - $150 면세)</option>
            <option value="VN">🇻🇳 베트남 (VN - $150 면세)</option>
            <option value="DE">🇩🇪 독일 (DE - $150 면세)</option>
          </select>
        </div>
        <div>
          <label class="block font-bold text-gray-700 mb-1">Fulfillment Warehouse (출고 물류거점)</label>
          <select v-model="newProd.warehouse_location" class="w-full h-9 px-2.5 rounded-lg border border-gray-300 bg-white">
            <option value="INCHEON_FBO">인천 자유무역 보세창고 (FBO)</option>
            <option value="DOMESTIC_3PL">국내 3PL 당일출고 센터</option>
            <option value="OVERSEAS_WEIHAI">중국 위해(Weihai) 글로벌 허브</option>
            <option value="OVERSEAS_LA">미국 LA 항공특송 센터</option>
            <option value="OVERSEAS_TOKYO">일본 도쿄 풀필먼트 센터</option>
          </select>
        </div>
      </div>

      <!-- Volumetric Weight Calculator Box -->
      <div class="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-3 text-xs">
        <div class="flex items-center justify-between">
          <span class="font-bold text-slate-800">항공/해상 국제특송 부피중량(Volumetric Weight) 자동 계산기</span>
          <span class="text-[11px] font-mono text-indigo-600 font-bold">
            부피중량: {{ volumetricWeightKg }}kg | 청구중량: {{ chargeableWeightKg }}kg
          </span>
        </div>
        <div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div>
            <label class="block text-[10px] text-slate-500 font-bold mb-1">가로 (Length cm)</label>
            <input v-model.number="newProd.package_length_cm" type="number" class="w-full h-8 px-2.5 rounded border border-slate-300 bg-white" />
          </div>
          <div>
            <label class="block text-[10px] text-slate-500 font-bold mb-1">세로 (Width cm)</label>
            <input v-model.number="newProd.package_width_cm" type="number" class="w-full h-8 px-2.5 rounded border border-slate-300 bg-white" />
          </div>
          <div>
            <label class="block text-[10px] text-slate-500 font-bold mb-1">높이 (Height cm)</label>
            <input v-model.number="newProd.package_height_cm" type="number" class="w-full h-8 px-2.5 rounded border border-slate-300 bg-white" />
          </div>
          <div>
            <label class="block text-[10px] text-slate-500 font-bold mb-1">실중량 (Actual kg)</label>
            <input v-model.number="newProd.package_weight_kg" type="number" step="0.1" class="w-full h-8 px-2.5 rounded border border-slate-300 bg-white" />
          </div>
        </div>
      </div>

      <div class="flex justify-end gap-2">
        <button @click="showCreateModal = false" class="px-4 py-2 rounded-lg border border-gray-300 text-xs font-bold cursor-pointer">Cancel</button>
        <button @click="createNewProduct" class="px-5 py-2 rounded-lg bg-[#FF5000] text-white text-xs font-black cursor-pointer">Save Global Product</button>
      </div>
    </div>

    <div class="bg-white rounded-2xl border border-gray-200 overflow-hidden shadow-2xs">
      <table class="w-full text-left border-collapse text-xs">
        <thead>
          <tr class="bg-gray-50 text-gray-500 border-b border-gray-200 uppercase">
            <th class="py-3.5 px-5 font-bold">Product</th>
            <th class="py-3.5 px-5 font-bold">Origin / HS Code</th>
            <th class="py-3.5 px-5 font-bold">Warehouse / Weight</th>
            <th class="py-3.5 px-5 font-bold">Sale Price (KRW)</th>
            <th class="py-3.5 px-5 font-bold">SKU Stock</th>
            <th class="py-3.5 px-5 font-bold">Action</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-gray-100">
          <tr v-for="p in products" :key="p.id + '_' + (p.sku_id || '')" class="hover:bg-gray-50">
            <td class="py-3 px-5">
              <div class="flex items-center gap-3">
                <img :src="p.thumbnail_url" class="w-10 h-10 rounded-lg object-cover bg-gray-100" />
                <div>
                  <div class="font-bold text-gray-900 line-clamp-1 max-w-xs">{{ p.title }}</div>
                  <div class="text-[10px] text-gray-400 font-mono">{{ p.sku_code || p.id }}</div>
                </div>
              </div>
            </td>
            <td class="py-3 px-5">
              <span class="px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 font-mono font-bold text-[10px] mr-1">
                {{ p.country_origin || 'KR' }}
              </span>
              <span class="font-mono text-gray-600 text-[11px]">HS:{{ p.hs_code || '6109.10' }}</span>
            </td>
            <td class="py-3 px-5">
              <div class="font-semibold text-gray-700 text-[11px]">{{ p.warehouse_location || 'INCHEON_FBO' }}</div>
              <div class="text-[10px] text-gray-400">Vol: {{ p.volumetric_weight_kg || 0.6 }}kg</div>
            </td>
            <td class="py-3 px-5">
              <input v-model.number="p.editPrice" type="number" class="w-28 h-8 px-2.5 rounded border border-gray-300 font-bold text-gray-900" />
            </td>
            <td class="py-3 px-5">
              <input v-model.number="p.editStock" type="number" class="w-20 h-8 px-2.5 rounded border border-gray-300 font-bold text-gray-900" />
            </td>
            <td class="py-3 px-5">
              <button
                @click="saveProductChanges(p)"
                class="px-3.5 py-1.5 rounded-lg bg-gray-900 hover:bg-[#FF5000] text-white font-bold transition-colors cursor-pointer"
              >
                Apply
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
