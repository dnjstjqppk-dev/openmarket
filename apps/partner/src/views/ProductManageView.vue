<script setup lang="ts">
import { ref, onMounted } from 'vue'
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
  thumbnail_url: 'https://images.unsplash.com/photo-1505740420928-5e560c06d30e?auto=format&fit=crop&w=600&q=80'
})

const loadProducts = async () => {
  loading.value = true
  try {
    const res = await fetch(`${API_BASE_URL}/api/v1/products`)
    const json = await res.json()
    if (json.success) {
      const pid = getPartnerId()
      const list = json.data.filter((p: any) => !p.partner_id || p.partner_id === pid)
      products.value = (list.length > 0 ? list : json.data).map((p: any) => ({
        ...p,
        editPrice: p.lowest_sale_price,
        editStock: 100
      }))
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
      body: JSON.stringify(newProd.value)
    })
    const json = await res.json()
    if (json.success) {
      showCreateModal.value = false
      toast.value = `✓ Registered new product "${newProd.value.title}" (${json.data.product_id})`
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
        <h2 class="text-xl font-black text-gray-900">Catalog Price & SKU Inventory Control</h2>
        <p class="text-xs text-gray-500">Real-time synchronization with D1 Edge Database and Inventory Ledger</p>
      </div>
      <div class="flex items-center gap-3">
        <div v-if="toast" class="px-4 py-2 rounded-xl bg-emerald-600 text-white text-xs font-bold shadow-sm">
          {{ toast }}
        </div>
        <button
          @click="showCreateModal = true"
          class="px-4 py-2.5 rounded-xl bg-[#FF5000] hover:bg-[#E04600] text-white text-xs font-black cursor-pointer shadow-xs"
        >
          + Register New Product
        </button>
      </div>
    </div>

    <!-- Create Product Modal -->
    <div v-if="showCreateModal" class="bg-white rounded-2xl p-6 border-2 border-[#FF5000] shadow-lg space-y-4">
      <div class="flex items-center justify-between">
        <h3 class="text-sm font-black text-gray-900">Register Single Product & Default SKU</h3>
        <button @click="showCreateModal = false" class="text-xs text-gray-400">Close ✕</button>
      </div>
      <div class="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs">
        <div class="sm:col-span-2">
          <label class="block font-bold text-gray-700 mb-1">Product Title</label>
          <input v-model="newProd.title" placeholder="e.g., Pro Wireless ANC Studio Headphones" class="w-full h-9 px-3 rounded-lg border border-gray-300" />
        </div>
        <div>
          <label class="block font-bold text-gray-700 mb-1">Brand</label>
          <input v-model="newProd.brand" class="w-full h-9 px-3 rounded-lg border border-gray-300" />
        </div>
        <div>
          <label class="block font-bold text-gray-700 mb-1">Original Price (KRW)</label>
          <input v-model.number="newProd.original_price" type="number" class="w-full h-9 px-3 rounded-lg border border-gray-300" />
        </div>
        <div>
          <label class="block font-bold text-gray-700 mb-1">Direct Sale Price (KRW)</label>
          <input v-model.number="newProd.sale_price" type="number" class="w-full h-9 px-3 rounded-lg border border-gray-300" />
        </div>
        <div>
          <label class="block font-bold text-gray-700 mb-1">Initial Stock Quantity</label>
          <input v-model.number="newProd.stock_quantity" type="number" class="w-full h-9 px-3 rounded-lg border border-gray-300" />
        </div>
      </div>
      <div class="flex justify-end gap-2">
        <button @click="showCreateModal = false" class="px-4 py-2 rounded-lg border border-gray-300 text-xs font-bold">Cancel</button>
        <button @click="createNewProduct" class="px-5 py-2 rounded-lg bg-[#FF5000] text-white text-xs font-black cursor-pointer">Save Product</button>
      </div>
    </div>

    <div class="bg-white rounded-2xl border border-gray-200 overflow-hidden shadow-2xs">
      <table class="w-full text-left border-collapse text-xs">
        <thead>
          <tr class="bg-gray-50 text-gray-500 border-b border-gray-200 uppercase">
            <th class="py-3.5 px-5 font-bold">Product</th>
            <th class="py-3.5 px-5 font-bold">Brand / Partner</th>
            <th class="py-3.5 px-5 font-bold">Original Price</th>
            <th class="py-3.5 px-5 font-bold">Sale Price (KRW)</th>
            <th class="py-3.5 px-5 font-bold">SKU Stock</th>
            <th class="py-3.5 px-5 font-bold">Action</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-gray-100">
          <tr v-for="p in products" :key="p.id" class="hover:bg-gray-50">
            <td class="py-3 px-5">
              <div class="flex items-center gap-3">
                <img :src="p.thumbnail_url" class="w-10 h-10 rounded-lg object-cover bg-gray-100" />
                <div>
                  <div class="font-bold text-gray-900 line-clamp-1 max-w-xs">{{ p.title }}</div>
                  <div class="text-[10px] text-gray-400 font-mono">{{ p.id }}</div>
                </div>
              </div>
            </td>
            <td class="py-3 px-5 font-semibold text-gray-600">{{ p.brand }}</td>
            <td class="py-3 px-5 text-gray-400 line-through">₩{{ p.lowest_original_price?.toLocaleString() }}</td>
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
