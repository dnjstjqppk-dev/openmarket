<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { RouterLink } from 'vue-router'
import { useAuthStore } from '../stores/auth'
import { useLocaleStore } from '../stores/locale'
import { API_BASE_URL } from '../config'

const auth = useAuthStore()
const locale = useLocaleStore()
const items = ref<any[]>([])
const loading = ref(true)

const loadWishlist = async () => {
  loading.value = true
  const cid = auth.user?.id || 'cust_demo_001'
  try {
    const res = await fetch(`${API_BASE_URL}/api/v1/wishlist?customer_id=${encodeURIComponent(cid)}`, {
      headers: { 'X-Customer-Id': cid }
    })
    const json = await res.json()
    if (json.success) items.value = json.data || []
  } catch {} finally {
    loading.value = false
  }
}

const removeWish = async (productId: string) => {
  const cid = auth.user?.id || 'cust_demo_001'
  await fetch(`${API_BASE_URL}/api/v1/wishlist`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Customer-Id': cid },
    body: JSON.stringify({ customer_id: cid, product_id: productId })
  })
  await loadWishlist()
}

onMounted(loadWishlist)
</script>

<template>
  <div class="max-w-[1280px] mx-auto px-4 sm:px-6 py-8">
    <h1 class="text-2xl font-black text-gray-900 mb-6">My Saved Wishlist ({{ items.length }})</h1>

    <div v-if="loading" class="grid grid-cols-2 md:grid-cols-4 gap-4">
      <div v-for="n in 4" :key="n" class="h-64 bg-white rounded-2xl animate-pulse"></div>
    </div>

    <div v-else-if="items.length === 0" class="bg-white rounded-2xl p-12 text-center border border-gray-200">
      <div class="text-4xl mb-2">♥</div>
      <p class="text-base font-bold text-gray-800 mb-2">Your wishlist is empty</p>
      <p class="text-xs text-gray-500 mb-5">Tap the heart icon on any product page to save items for price-drop alerts.</p>
      <RouterLink to="/" class="inline-block px-6 py-2.5 rounded-full bg-[#FF5000] text-white text-xs font-black">Explore Products</RouterLink>
    </div>

    <div v-else class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
      <div
        v-for="item in items"
        :key="item.wishlist_id"
        class="bg-white rounded-2xl overflow-hidden border border-gray-200 flex flex-col justify-between p-3"
      >
        <RouterLink :to="`/product/${item.slug}`">
          <div class="aspect-square rounded-xl overflow-hidden bg-gray-100 mb-2.5">
            <img :src="item.thumbnail_url" :alt="item.title" class="w-full h-full object-cover" />
          </div>
          <span class="text-[10px] font-bold text-gray-400 uppercase">{{ item.brand }}</span>
          <h2 class="text-xs font-bold text-gray-900 line-clamp-2 mt-0.5">{{ item.title }}</h2>
        </RouterLink>
        <div class="flex items-center justify-between mt-3 pt-2 border-t border-gray-100">
          <span class="text-base font-black text-[#E60023]">{{ locale.formatPrice(item.lowest_sale_price) }}</span>
          <button @click="removeWish(item.product_id)" class="text-xs text-gray-400 hover:text-red-600 font-bold cursor-pointer">
            Remove ✕
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
