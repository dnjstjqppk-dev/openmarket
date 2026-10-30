<script setup lang="ts">
import { ref, watch, onMounted, computed } from 'vue'
import { useRoute, RouterLink } from 'vue-router'
import { useCartStore } from '../stores/cart'
import { useLocaleStore } from '../stores/locale'
import { API_BASE_URL } from '../config'

const route = useRoute()
const cart = useCartStore()
const locale = useLocaleStore()
const products = ref<any[]>([])
const categories = ref<any[]>([])
const loading = ref(true)
const sortBy = ref<'popular' | 'price_asc' | 'price_desc'>('popular')

const currentSlug = computed(() => String(route.params.slug || ''))
const currentCategory = computed(() => categories.value.find(c => c.slug === currentSlug.value))
const childCategories = computed(() => {
  if (!currentCategory.value) return []
  return categories.value.filter(c => c.parent_id === currentCategory.value.id)
})

const fetchCategoryData = async () => {
  loading.value = true
  try {
    const [prodRes, catRes] = await Promise.all([
      fetch(`${API_BASE_URL}/api/v1/products?category=${encodeURIComponent(currentSlug.value)}`),
      fetch(`${API_BASE_URL}/api/v1/categories`)
    ])
    const prodJson = await prodRes.json()
    const catJson = await catRes.json()
    if (prodJson.success) products.value = prodJson.data
    if (catJson.success) categories.value = catJson.data
  } catch (e) {
    console.error(e)
  } finally {
    loading.value = false
  }
}

onMounted(fetchCategoryData)
watch(() => route.params.slug, fetchCategoryData)

const sortedProducts = computed(() => {
  const list = [...products.value]
  if (sortBy.value === 'price_asc') return list.sort((a, b) => a.lowest_sale_price - b.lowest_sale_price)
  if (sortBy.value === 'price_desc') return list.sort((a, b) => b.lowest_sale_price - a.lowest_sale_price)
  return list.sort((a, b) => (b.total_sold_count || 0) - (a.total_sold_count || 0))
})
</script>

<template>
  <div class="max-w-[1440px] mx-auto px-4 sm:px-6 py-6">
    <!-- Breadcrumbs -->
    <nav class="flex items-center gap-2 text-xs text-gray-500 mb-4">
      <RouterLink to="/" class="hover:text-[#FF5000]">Home</RouterLink>
      <span>/</span>
      <RouterLink to="/categories" class="hover:text-[#FF5000]">Categories</RouterLink>
      <span>/</span>
      <span class="font-bold text-gray-900">{{ currentCategory?.name || currentSlug }}</span>
    </nav>

    <!-- Category Header -->
    <div class="bg-white rounded-2xl p-6 border border-gray-200/80 mb-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
      <div>
        <h1 class="text-2xl font-black text-gray-900">{{ currentCategory?.name || currentSlug.toUpperCase() }}</h1>
        <p class="text-xs text-gray-500 mt-1">{{ sortedProducts.length }} verified products available with instant shipping</p>
        <div v-if="childCategories.length > 0" class="flex flex-wrap gap-2 mt-3">
          <RouterLink
            v-for="sub in childCategories"
            :key="sub.id"
            :to="`/category/${sub.slug}`"
            class="px-3 py-1 rounded-full bg-orange-50 hover:bg-[#FF5000] text-[#FF5000] hover:text-white text-xs font-bold transition-colors"
          >
            {{ sub.name }}
          </RouterLink>
        </div>
      </div>
      <div class="flex items-center gap-2">
        <span class="text-xs text-gray-500 font-medium">Sort:</span>
        <select v-model="sortBy" class="bg-gray-50 border border-gray-300 rounded-lg px-3 py-1.5 text-xs font-bold">
          <option value="popular">Best Selling</option>
          <option value="price_asc">Price: Low to High</option>
          <option value="price_desc">Price: High to Low</option>
        </select>
      </div>
    </div>

    <!-- Product Grid -->
    <div v-if="loading" class="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-4">
      <div v-for="n in 5" :key="n" class="h-72 bg-white rounded-xl animate-pulse"></div>
    </div>

    <div v-else-if="sortedProducts.length === 0" class="bg-white rounded-2xl p-12 text-center border border-gray-200">
      <p class="text-base font-bold text-gray-700 mb-2">No products found in this subcategory yet.</p>
      <RouterLink to="/categories" class="inline-block mt-2 px-5 py-2.5 rounded-full bg-[#FF5000] text-white text-xs font-black">Browse All Departments</RouterLink>
    </div>

    <div v-else class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
      <RouterLink
        v-for="product in sortedProducts"
        :key="product.id"
        :to="`/product/${product.slug}`"
        class="group bg-white rounded-2xl overflow-hidden border border-slate-200/80 hover:border-[#FF5000] hover:shadow-xl hover:-translate-y-1 transition-all duration-300 flex flex-col relative"
      >
        <div class="aspect-square bg-gray-100 overflow-hidden relative">
          <img :src="product.thumbnail_url" :alt="product.title" class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />
        </div>
        <div class="p-3.5 flex-1 flex flex-col justify-between">
          <div>
            <div class="flex items-center gap-1.5 mb-1 flex-wrap">
              <span class="text-[10px] font-bold text-slate-400 uppercase">{{ product.brand }}</span>
              <span class="bg-emerald-50 text-emerald-700 border border-emerald-200 text-[9px] font-black px-1.5 py-0.2 rounded-full inline-flex items-center">🚀 무료배송</span>
            </div>
            <h3 class="text-xs font-bold text-slate-800 line-clamp-2 mt-0.5 mb-2 group-hover:text-[#FF5000] transition-colors leading-snug">{{ product.title }}</h3>
          </div>
          <div>
            <div class="text-base font-black text-gray-900">{{ locale.formatPrice(product.lowest_sale_price) }}</div>
            <div class="flex items-center justify-between text-[11px] text-gray-500 mt-1">
              <span class="text-[#FFB800] font-bold">★ {{ Number(product.avg_rating || 4.8).toFixed(1) }}</span>
              <span>{{ (product.total_sold_count || 95).toLocaleString() }}+ sold</span>
            </div>
          </div>
        </div>
      </RouterLink>
    </div>
  </div>
</template>
