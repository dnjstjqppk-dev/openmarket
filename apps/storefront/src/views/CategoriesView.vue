<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { RouterLink } from 'vue-router'
import { API_BASE_URL } from '../config'

const allCategories = ref<any[]>([])
const loading = ref(true)
const searchFilter = ref('')

onMounted(async () => {
  try {
    const res = await fetch(`${API_BASE_URL}/api/v1/categories`)
    const json = await res.json()
    if (json.success) allCategories.value = json.data
  } catch (e) {
    console.error(e)
  } finally {
    loading.value = false
  }
})

const rootCategories = computed(() => {
  const roots = allCategories.value.filter(c => Number(c.depth) === 0)
  if (!searchFilter.value.trim()) return roots
  const q = searchFilter.value.toLowerCase()
  return roots.filter(r =>
    r.name.toLowerCase().includes(q) ||
    allCategories.value.some(sub => sub.parent_id === r.id && sub.name.toLowerCase().includes(q))
  )
})

const getSubcategories = (parentId: string) =>
  allCategories.value.filter(c => c.parent_id === parentId)

const categoryIcons: Record<string, string> = {
  'womens-clothing': '👗', 'mens-clothing': '👔', 'electronics': '💻', 'home-kitchen': '🍳',
  'beauty-health': '💄', 'shoes': '👟', 'bags-luggage': '👜', 'jewelry-watches': '⌚',
  'baby-kids': '🧸', 'sports-outdoors': '⛺', 'automotive': '🚗', 'pet-supplies': '🐾',
  'office-school': '📎', 'tools-home-improvement': '🛠️', 'patio-lawn-garden': '🌱',
  'arts-crafts-sewing': '🎨', 'musical-instruments': '🎸', 'toys-games': '🎮',
  'appliances': '🧺', 'cell-phones-accessories': '📱', 'smart-home': '🏠',
  'industrial-scientific': '🔬', 'grocery-gourmet': '🥑', 'health-household': '💊',
  'books-media': '📚', 'collectibles-fine-art': '🖼️', 'handmade-crafts': '🧶',
  'luxury-beauty': '✨', 'camera-photo': '📷', 'video-games-consoles': '🕹️',
  'wearable-technology': '⌚', 'computer-components': '🖥️', 'networking-cloud': '📡',
  'home-audio-theater': '🔊', 'furniture-mattresses': '🛋️', 'bedding-bath': '🛁',
  'lighting-ceiling-fans': '💡', 'storage-organization': '📦', 'cleaning-laundry': '🧼',
  'party-event-supplies': '🎈', 'travel-accessories': '✈️', 'sustainable-eco-living': '♻️'
}
</script>

<template>
  <div class="max-w-[1440px] mx-auto px-4 sm:px-6 py-8">
    <div class="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
      <div>
        <div class="text-xs font-extrabold text-[#FF5000] uppercase tracking-wider mb-1">Global Taxonomic Directory</div>
        <h1 class="text-2xl sm:text-3xl font-black text-gray-900">All {{ rootCategories.length }} Store Departments</h1>
      </div>
      <div class="w-full md:w-80">
        <input
          v-model="searchFilter"
          type="search"
          placeholder="Filter departments or subcategories..."
          class="w-full h-10 px-4 rounded-full bg-white border border-gray-300 text-sm focus:outline-none focus:border-[#FF5000]"
        />
      </div>
    </div>

    <div v-if="loading" class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
      <div v-for="n in 9" :key="n" class="h-44 bg-white rounded-2xl p-5 animate-pulse border border-gray-100"></div>
    </div>

    <div v-else class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
      <div
        v-for="root in rootCategories"
        :key="root.id"
        class="bg-white rounded-2xl p-5 border border-gray-200/80 hover:border-[#FF5000] hover:shadow-md transition-all flex flex-col justify-between"
      >
        <div>
          <RouterLink :to="`/category/${root.slug}`" class="flex items-center justify-between group mb-3">
            <div class="flex items-center gap-3">
              <span class="w-10 h-10 rounded-xl bg-orange-50 flex items-center justify-center text-xl">
                {{ categoryIcons[root.slug] || '🛍️' }}
              </span>
              <div>
                <h2 class="font-black text-gray-900 group-hover:text-[#FF5000] transition-colors">{{ root.name }}</h2>
                <span class="text-[11px] text-gray-400">Department • Direct Verified</span>
              </div>
            </div>
            <span class="text-xs font-bold text-[#FF5000] group-hover:translate-x-1 transition-transform">Explore →</span>
          </RouterLink>

          <div class="flex flex-wrap gap-1.5 mt-3 pt-3 border-t border-gray-100">
            <RouterLink
              v-for="sub in getSubcategories(root.id)"
              :key="sub.id"
              :to="`/category/${sub.slug}`"
              class="px-2.5 py-1 rounded-full bg-gray-100 hover:bg-[#FF5000] hover:text-white text-gray-700 text-xs font-medium transition-colors"
            >
              {{ sub.name }}
            </RouterLink>
            <RouterLink
              v-if="getSubcategories(root.id).length === 0"
              :to="`/category/${root.slug}`"
              class="text-xs text-gray-400 hover:text-[#FF5000]"
            >
              Browse all {{ root.name }} products →
            </RouterLink>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
