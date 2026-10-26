<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed } from 'vue'
import { RouterLink } from 'vue-router'
import { useCartStore } from '../stores/cart'
import { useLocaleStore } from '../stores/locale'
import { API_BASE_URL } from '../config'

const cart = useCartStore()
const locale = useLocaleStore()
const products = ref<any[]>([])
const categories = ref<any[]>([])
const lightningCampaign = ref<any>(null)
const loading = ref(true)
const activeCategorySlug = ref('ALL')
const sortBy = ref<'popular' | 'price_asc' | 'price_desc' | 'discount'>('popular')

const countdown = ref('04:59:42')
const banners = ref<any[]>([])
const currentBannerIdx = ref(0)
let timer: any = null
let bannerTimer: any = null

const nextBanner = () => {
  if (banners.value.length > 0) {
    currentBannerIdx.value = (currentBannerIdx.value + 1) % banners.value.length
  }
}

const prevBanner = () => {
  if (banners.value.length > 0) {
    currentBannerIdx.value = (currentBannerIdx.value - 1 + banners.value.length) % banners.value.length
  }
}

const updateCountdown = () => {
  const now = new Date()
  const sec = 59 - now.getSeconds()
  const min = 59 - now.getMinutes()
  const hr = 4 - (now.getHours() % 5)
  countdown.value = `${String(hr).padStart(2, '0')}:${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
}

onMounted(async () => {
  updateCountdown()
  timer = setInterval(updateCountdown, 1000)
  bannerTimer = setInterval(nextBanner, 5000)
  try {
    const [prodRes, catRes, flashRes, bnrRes] = await Promise.all([
      fetch(`${API_BASE_URL}/api/v1/products`),
      fetch(`${API_BASE_URL}/api/v1/categories`),
      fetch(`${API_BASE_URL}/api/v1/campaigns/lightning`),
      fetch(`${API_BASE_URL}/api/v1/banners`).catch(() => ({ json: () => ({ success: false }) }))
    ])
    const prodJson = await prodRes.json()
    const catJson = await catRes.json()
    const flashJson = await flashRes.json()
    const bnrJson = await bnrRes.json().catch(() => ({}))

    if (prodJson.success) products.value = prodJson.data
    if (catJson.success && Array.isArray(catJson.data)) {
      categories.value = catJson.data.filter((c: any) => Number(c.depth) === 0)
    }
    if (flashJson.success) lightningCampaign.value = flashJson.data
    if (bnrJson?.success && Array.isArray(bnrJson.data) && bnrJson.data.length > 0) {
      banners.value = bnrJson.data
    }
  } catch (e) {
    console.error('Failed to fetch storefront data:', e)
  } finally {
    loading.value = false
  }
})

onUnmounted(() => {
  if (timer) clearInterval(timer)
  if (bannerTimer) clearInterval(bannerTimer)
})

const getDiscountPercent = (sale: number, orig: number) => {
  if (!orig || orig <= sale) return 0
  return Math.round(((orig - sale) / orig) * 100)
}

const filteredProducts = computed(() => {
  let list = [...products.value]
  if (activeCategorySlug.value !== 'ALL') {
    list = list.filter(p =>
      p.category_slug === activeCategorySlug.value ||
      p.parent_category_slug === activeCategorySlug.value
    )
  }
  if (sortBy.value === 'price_asc') {
    list.sort((a, b) => a.lowest_sale_price - b.lowest_sale_price)
  } else if (sortBy.value === 'price_desc') {
    list.sort((a, b) => b.lowest_sale_price - a.lowest_sale_price)
  } else if (sortBy.value === 'discount') {
    list.sort((a, b) => getDiscountPercent(b.lowest_sale_price, b.lowest_original_price) - getDiscountPercent(a.lowest_sale_price, a.lowest_original_price))
  } else {
    list.sort((a, b) => (b.total_sold_count || 0) - (a.total_sold_count || 0))
  }
  return list
})

const flashDeals = computed(() => {
  if (lightningCampaign.value?.deals?.length) {
    return lightningCampaign.value.deals.slice(0, 5)
  }
  return [...products.value]
    .sort((a, b) => getDiscountPercent(b.lowest_sale_price, b.lowest_original_price) - getDiscountPercent(a.lowest_sale_price, a.lowest_original_price))
    .slice(0, 5)
})

const quickAdd = (e: Event, product: any) => {
  e.preventDefault()
  e.stopPropagation()
  cart.addItem({
    product_id: product.id,
    sku_id: product.default_sku_id || `${product.id}_sku_def`,
    partner_id: product.partner_id || 'pt_001',
    partner_name: product.partner_name || 'Olmoa Official Flagship',
    title: product.title,
    brand: product.brand,
    option_Label: 'Standard Choice',
    price: product.lowest_sale_price,
    original_price: product.lowest_original_price,
    quantity: 1,
    thumbnail_url: product.thumbnail_url,
    slug: product.slug
  })
}
</script>

<template>
  <div class="pb-16">
    <!-- Hero Promotional Banner Carousel (Dynamic D1 Data) -->
    <section class="relative bg-gradient-to-r from-[#FF5000] via-[#E60023] to-[#B8001F] text-white py-6 px-4 shadow-inner overflow-hidden">
      <div class="max-w-[1440px] mx-auto flex flex-col lg:flex-row items-center justify-between gap-6 relative z-10">
        <div class="max-w-2xl">
          <div class="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-black/25 text-xs font-extrabold uppercase tracking-wider mb-3 backdrop-blur-xs">
            <span class="w-2 h-2 rounded-full bg-[#FFE600] animate-ping"></span>
            {{ banners[currentBannerIdx]?.badge_text || 'Global Direct OpenMarket • 42 Root Categories Live' }}
          </div>
          <h1 class="text-3xl sm:text-5xl font-black tracking-tight leading-none mb-3">
            {{ banners[currentBannerIdx]?.title || 'DIRECT FACTORY DEALS UP TO 70% OFF' }}
          </h1>
          <p class="text-white/90 text-sm sm:text-base font-medium mb-5">
            {{ banners[currentBannerIdx]?.subtitle || 'Every order is backed by our 30-day Price-Match Adjustment Guarantee, 90-day Free Returns, and 1% Purchase Confirmation Reward Credits.' }}
          </p>
          <div class="flex flex-wrap items-center gap-3">
            <RouterLink :to="banners[currentBannerIdx]?.link_url || '/channel/lightning-deals'" class="px-5 py-2.5 rounded-full bg-[#FFE600] text-black font-black text-xs sm:text-sm hover:bg-yellow-300 transition-colors shadow-md">
              ⚡ 지금 특가 확인하기
            </RouterLink>
            <RouterLink to="/coupons" class="px-5 py-2.5 rounded-full bg-white/15 hover:bg-white/25 text-white font-bold text-xs sm:text-sm backdrop-blur-xs transition-colors">
              🎟️ 10,000원 웰컴 크레딧
            </RouterLink>
          </div>
        </div>

        <div class="grid grid-cols-3 gap-3 w-full lg:w-auto shrink-0">
          <RouterLink to="/coupons" class="bg-white/10 backdrop-blur-md border border-white/20 rounded-xl p-3.5 text-center hover:bg-white/20 transition-colors">
            <div class="text-2xl font-black text-[#FFE600]">₩10,000</div>
            <div class="text-[11px] text-white/90 font-medium mt-0.5">Instant Welcome Credit</div>
          </RouterLink>
          <RouterLink to="/policy/shipping" class="bg-white/10 backdrop-blur-md border border-white/20 rounded-xl p-3.5 text-center hover:bg-white/20 transition-colors">
            <div class="text-2xl font-black text-white">100%</div>
            <div class="text-[11px] text-white/90 font-medium mt-0.5">On-Time Guarantee</div>
          </RouterLink>
          <RouterLink to="/policy/returns" class="bg-white/10 backdrop-blur-md border border-white/20 rounded-xl p-3.5 text-center hover:bg-white/20 transition-colors">
            <div class="text-2xl font-black text-[#FFE600]">90 Days</div>
            <div class="text-[11px] text-white/90 font-medium mt-0.5">Free Return Window</div>
          </RouterLink>
        </div>
      </div>

      <!-- Banner Slide Indicator Controls -->
      <div v-if="banners.length > 1" class="max-w-[1440px] mx-auto mt-4 flex items-center justify-between relative z-10 px-2">
        <div class="flex items-center gap-1.5">
          <button
            v-for="(_, idx) in banners"
            :key="idx"
            @click="currentBannerIdx = idx"
            :class="['h-1.5 rounded-full transition-all duration-300 cursor-pointer', currentBannerIdx === idx ? 'w-6 bg-[#FFE600]' : 'w-2 bg-white/40 hover:bg-white/70']"
            :title="`Slide ${idx + 1}`"
          />
        </div>
        <div class="flex items-center gap-2">
          <button @click="prevBanner" class="w-7 h-7 rounded-full bg-black/30 hover:bg-black/50 text-white flex items-center justify-center text-xs transition cursor-pointer" title="Previous Banner">‹</button>
          <button @click="nextBanner" class="w-7 h-7 rounded-full bg-black/30 hover:bg-black/50 text-white flex items-center justify-center text-xs transition cursor-pointer" title="Next Banner">›</button>
        </div>
      </div>
    </section>

    <div class="max-w-[1440px] mx-auto px-4 sm:px-6 mt-6 space-y-8">
      <!-- Lightning Deals Row -->
      <section v-if="!loading && flashDeals.length > 0" class="bg-white rounded-2xl p-5 shadow-xs border border-orange-200/80">
        <div class="flex flex-wrap items-center justify-between gap-2 mb-4">
          <div class="flex items-center gap-3">
            <div class="flex items-center gap-1.5 text-[#E60023] font-black text-xl tracking-tight">
              <svg class="w-6 h-6 fill-current" viewBox="0 0 20 20"><path d="M11.3 1.046A1 1 0 0112 2v5h4a1 1 0 01.82 1.573l-7 10A1 1 0 018 18v-5H4a1 1 0 01-.82-1.573l7-10a1 1 0 011.12-.38z"/></svg>
              LIGHTNING DEALS
            </div>
            <span class="px-2.5 py-0.5 bg-red-50 text-[#E60023] font-extrabold text-xs rounded-full border border-red-200">
              Ends in {{ countdown }}
            </span>
          </div>
          <RouterLink to="/channel/lightning-deals" class="text-xs font-bold text-[#FF5000] hover:underline">
            View All Flash Deals →
          </RouterLink>
        </div>

        <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
          <RouterLink
            v-for="item in flashDeals"
            :key="'flash-' + (item.product_id || item.id)"
            :to="`/product/${item.slug}`"
            class="group bg-orange-50/40 rounded-xl p-3 border border-orange-100 hover:border-[#FF5000] hover:shadow-md transition-all flex flex-col"
          >
            <div class="relative aspect-square rounded-lg overflow-hidden bg-white mb-2.5">
              <img :src="item.thumbnail_url" :alt="item.title" class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />
              <span class="absolute top-2 left-2 bg-[#E60023] text-white text-[11px] font-black px-2 py-0.5 rounded-md shadow-xs">
                -{{ item.discount_rate || getDiscountPercent(item.deal_price || item.lowest_sale_price, item.lowest_original_price) }}%
              </span>
            </div>
            <h3 class="text-xs font-semibold text-gray-800 line-clamp-1 mb-1 group-hover:text-[#FF5000]">{{ item.title }}</h3>
            <div class="flex items-baseline gap-1.5 mt-auto">
              <span class="text-base font-black text-[#E60023]">{{ locale.formatPrice(item.deal_price || item.lowest_sale_price) }}</span>
              <span class="text-[11px] text-gray-400 line-through">{{ locale.formatPrice(item.lowest_original_price) }}</span>
            </div>
            <div class="mt-2 w-full bg-gray-200 h-2 rounded-full overflow-hidden">
              <div class="bg-gradient-to-r from-[#FF5000] to-[#E60023] h-full rounded-full" :style="{ width: `${Math.min(94, 48 + ((item.sold_quantity || item.total_sold_count || 20) % 45))}%` }"></div>
            </div>
            <span class="text-[10px] font-bold text-[#FF5000] mt-1">🔥 {{ (item.sold_quantity || item.total_sold_count || 85).toLocaleString() }} claimed</span>
          </RouterLink>
        </div>
      </section>

      <!-- Root Category Filter Bar & Sort Controls -->
      <div class="sticky top-25 z-40 bg-[#F5F5F7]/95 backdrop-blur-md py-3 border-b border-gray-200 flex flex-col md:flex-row items-start md:items-center justify-between gap-3">
        <div class="flex items-center gap-2 overflow-x-auto w-full md:w-auto pb-1 md:pb-0 no-scrollbar">
          <button
            @click="activeCategorySlug = 'ALL'"
            :class="[
              'px-4 py-2 rounded-full text-xs font-extrabold whitespace-nowrap transition-all cursor-pointer',
              activeCategorySlug === 'ALL'
                ? 'bg-[#111111] text-white shadow-xs'
                : 'bg-white text-gray-700 hover:bg-gray-100 border border-gray-200'
            ]"
          >
            🔥 All Recommended ({{ products.length }})
          </button>
          <button
            v-for="cat in categories.slice(0, 12)"
            :key="cat.id"
            @click="activeCategorySlug = cat.slug"
            :class="[
              'px-4 py-2 rounded-full text-xs font-bold whitespace-nowrap transition-all cursor-pointer',
              activeCategorySlug === cat.slug
                ? 'bg-[#FF5000] text-white shadow-xs'
                : 'bg-white text-gray-700 hover:bg-gray-100 border border-gray-200'
            ]"
          >
            {{ cat.name }}
          </button>
          <RouterLink
            to="/categories"
            class="px-4 py-2 rounded-full text-xs font-bold whitespace-nowrap bg-orange-50 text-[#FF5000] border border-orange-200 hover:bg-orange-100"
          >
            + All {{ categories.length }} Categories
          </RouterLink>
        </div>

        <div class="flex items-center gap-2 self-end md:self-auto shrink-0">
          <span class="text-xs text-gray-500 font-medium">Sort by:</span>
          <select
            v-model="sortBy"
            aria-label="Sort products by"
            class="bg-white border border-gray-300 rounded-lg px-3 py-1.5 text-xs font-bold text-gray-800 focus:outline-none focus:border-[#FF5000]"
          >
            <option value="popular">Most Popular</option>
            <option value="discount">Biggest Discount</option>
            <option value="price_asc">Price: Low to High</option>
            <option value="price_desc">Price: High to Low</option>
          </select>
        </div>
      </div>

      <!-- Loading Skeletons -->
      <div v-if="loading" class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
        <div v-for="n in 10" :key="n" class="bg-white rounded-xl p-3 animate-pulse h-80 border border-gray-100">
          <div class="w-full aspect-square bg-gray-200 rounded-lg mb-3"></div>
          <div class="h-3 bg-gray-200 rounded w-3/4 mb-2"></div>
          <div class="h-5 bg-gray-200 rounded w-1/2"></div>
        </div>
      </div>

      <!-- High-Density Commercial Product Grid -->
      <div v-else class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3 sm:gap-4">
        <RouterLink
          v-for="product in filteredProducts"
          :key="product.id"
          :to="`/product/${product.slug}`"
          class="group bg-white rounded-xl overflow-hidden border border-gray-200/80 hover:border-[#FF5000] hover:shadow-xl transition-all duration-200 flex flex-col"
        >
          <div class="relative aspect-square bg-gray-100 overflow-hidden">
            <img
              :src="product.thumbnail_url"
              :alt="product.title"
              loading="lazy"
              class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
            />
            <div
              v-if="getDiscountPercent(product.lowest_sale_price, product.lowest_original_price) > 0"
              class="absolute top-2 left-2 bg-[#E60023] text-white text-[11px] font-black px-2 py-0.5 rounded shadow-xs"
            >
              -{{ getDiscountPercent(product.lowest_sale_price, product.lowest_original_price) }}%
            </div>
            <div
              v-if="(product.total_sold_count || 0) >= 300"
              class="absolute bottom-2 left-2 bg-black/75 backdrop-blur-xs text-[#FFE600] text-[10px] font-extrabold px-2 py-0.5 rounded flex items-center gap-1"
            >
              🔥 BEST SELLER
            </div>
          </div>

          <div class="p-3 flex-1 flex flex-col justify-between">
            <div>
              <div class="flex items-center gap-1.5 mb-1">
                <span class="px-1.5 py-0.5 bg-[#FFE600] text-black text-[9px] font-black rounded uppercase tracking-tighter">CHOICE</span>
                <span class="text-[11px] font-bold text-gray-500 truncate">{{ product.brand }}</span>
              </div>
              <h2 class="text-xs sm:text-[13px] font-medium text-gray-800 line-clamp-2 leading-snug group-hover:text-[#FF5000] transition-colors mb-2">
                {{ product.title }}
              </h2>
            </div>

            <div>
              <div class="flex items-baseline gap-1.5 flex-wrap">
                <span class="text-base sm:text-lg font-black text-[#111111] tracking-tight">
                  {{ locale.formatPrice(product.lowest_sale_price) }}
                </span>
                <span
                  v-if="product.lowest_original_price > product.lowest_sale_price"
                  class="text-[11px] text-gray-400 line-through"
                >
                  {{ locale.formatPrice(product.lowest_original_price) }}
                </span>
              </div>

              <div class="flex items-center justify-between mt-2 pt-2 border-t border-gray-100">
                <div class="flex items-center gap-1 text-[11px] text-gray-500">
                  <span class="text-[#FFB800] font-bold">★ {{ Number(product.avg_rating || 4.8).toFixed(1) }}</span>
                  <span v-if="product.review_count">({{ product.review_count }})</span>
                  <span>•</span>
                  <span>{{ (product.total_sold_count || 120).toLocaleString() }}+ sold</span>
                </div>

                <button
                  @click="(e) => quickAdd(e, product)"
                  class="w-7 h-7 rounded-full bg-orange-50 hover:bg-[#FF5000] text-[#FF5000] hover:text-white flex items-center justify-center transition-colors shadow-2xs cursor-pointer"
                  title="Quick Add to Cart"
                >
                  <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.2" d="M12 4v16m8-8H4"/></svg>
                </button>
              </div>
            </div>
          </div>
        </RouterLink>
      </div>
    </div>
  </div>
</template>
