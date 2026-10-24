<script setup lang="ts">
import { ref, onMounted, computed, watch } from 'vue'
import { useRoute, useRouter, RouterLink } from 'vue-router'
import { useCartStore } from '../stores/cart'
import { useAuthStore } from '../stores/auth'
import { useLocaleStore } from '../stores/locale'
import { API_BASE_URL } from '../config'

const route = useRoute()
const router = useRouter()
const cart = useCartStore()
const auth = useAuthStore()
const locale = useLocaleStore()

const product = ref<any>(null)
const selectedSku = ref<any>(null)
const quantity = ref(1)
const loading = ref(true)
const addedToast = ref(false)
const activeImage = ref('')
const activeTab = ref<'description' | 'reviews' | 'qna' | 'shipping'>('description')

const reviews = ref<any[]>([])
const reviewSummary = ref<any>({ count: 0, average_rating: 4.9 })
const newReviewRating = ref(5)
const newReviewComment = ref('')
const reviewSubmitting = ref(false)
const reviewMsg = ref('')

const qnaList = ref<any[]>([])
const newQuestion = ref('')
const qnaSubmitting = ref(false)
const qnaMsg = ref('')

const isWishlisted = ref(false)

// Strict HTML sanitizer for description_html (strips <script>, <iframe>, <object>, and inline on* event handlers)
const sanitizedDescriptionHtml = computed(() => {
  const raw = product.value?.description_html || ''
  if (!raw) return '<p>Official direct factory specification verified by OLMOA Quality Assurance.</p>'
  return String(raw)
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/<(iframe|object|embed|form)\b[^>]*>/gi, '')
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/javascript\s*:/gi, '')
})

const galleryImages = computed(() => {
  if (!product.value) return []
  const base = product.value.thumbnail_url
  return [
    base,
    base.includes('unsplash.com') ? `${base}&sat=-15` : base,
    base.includes('unsplash.com') ? `${base}&con=15` : base
  ]
})

const loadProductAll = async () => {
  loading.value = true
  try {
    const slug = route.params.slug
    const res = await fetch(`${API_BASE_URL}/api/v1/products/${slug}`)
    const json = await res.json()
    if (json.success && json.data) {
      product.value = json.data
      activeImage.value = json.data.thumbnail_url
      if (json.data.skus && json.data.skus.length > 0) {
        selectedSku.value = json.data.skus[0]
      }
      await Promise.all([
        loadReviews(json.data.id),
        loadQna(json.data.id),
        checkWishlist(json.data.id)
      ])
    }
  } catch (e) {
    console.error(e)
  } finally {
    loading.value = false
  }
}

const loadReviews = async (productId: string) => {
  try {
    const res = await fetch(`${API_BASE_URL}/api/v1/products/${productId}/reviews`)
    const json = await res.json()
    if (json.success) {
      reviews.value = json.data.reviews || []
      reviewSummary.value = json.data.summary || { count: 0, average_rating: 4.9 }
    }
  } catch {}
}

const loadQna = async (productId: string) => {
  try {
    const res = await fetch(`${API_BASE_URL}/api/v1/products/${productId}/qna`)
    const json = await res.json()
    if (json.success) qnaList.value = json.data || []
  } catch {}
}

const checkWishlist = async (productId: string) => {
  try {
    const cid = auth.user?.id || 'cust_demo_001'
    const res = await fetch(`${API_BASE_URL}/api/v1/wishlist?customer_id=${encodeURIComponent(cid)}`, {
      headers: { 'X-Customer-Id': cid }
    })
    const json = await res.json()
    if (json.success && Array.isArray(json.data)) {
      isWishlisted.value = json.data.some((w: any) => w.product_id === productId)
    }
  } catch {}
}

const toggleWishlist = async () => {
  if (!product.value) return
  const cid = auth.user?.id || 'cust_demo_001'
  try {
    const res = await fetch(`${API_BASE_URL}/api/v1/wishlist`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Customer-Id': cid },
      body: JSON.stringify({ customer_id: cid, product_id: product.value.id })
    })
    const json = await res.json()
    if (json.success) {
      isWishlisted.value = json.action === 'ADDED'
    }
  } catch {}
}

const submitReview = async () => {
  if (!newReviewComment.value.trim() || !product.value) return
  reviewSubmitting.value = true
  reviewMsg.value = ''
  try {
    const cid = auth.user?.id || 'cust_demo_001'
    const res = await fetch(`${API_BASE_URL}/api/v1/products/${product.value.id}/reviews`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Customer-Id': cid },
      body: JSON.stringify({
        customer_id: cid,
        rating: newReviewRating.value,
        comment: newReviewComment.value.trim()
      })
    })
    const json = await res.json()
    if (json.success) {
      newReviewComment.value = ''
      reviewMsg.value = json.data.is_verified_purchase
        ? '✓ Verified Buyer review published!'
        : '✓ Review published!'
      await loadReviews(product.value.id)
    }
  } catch {} finally {
    reviewSubmitting.value = false
  }
}

const submitQuestion = async () => {
  if (!newQuestion.value.trim() || !product.value) return
  qnaSubmitting.value = true
  qnaMsg.value = ''
  try {
    const cid = auth.user?.id || 'cust_demo_001'
    const res = await fetch(`${API_BASE_URL}/api/v1/products/${product.value.id}/qna`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Customer-Id': cid },
      body: JSON.stringify({
        customer_id: cid,
        customer_name: auth.user?.name || 'Alex Kim',
        question: newQuestion.value.trim()
      })
    })
    const json = await res.json()
    if (json.success) {
      newQuestion.value = ''
      qnaMsg.value = '✓ Question submitted to seller!'
      await loadQna(product.value.id)
    }
  } catch {} finally {
    qnaSubmitting.value = false
  }
}

onMounted(loadProductAll)
watch(() => route.params.slug, loadProductAll)

const currentPrice = computed(() => selectedSku.value?.sale_price || product.value?.lowest_sale_price || 0)
const originalPrice = computed(() => selectedSku.value?.original_price || product.value?.lowest_original_price || 0)
const discountRate = computed(() => {
  if (!originalPrice.value || originalPrice.value <= currentPrice.value) return 0
  return Math.round(((originalPrice.value - currentPrice.value) / originalPrice.value) * 100)
})

const parseSkuOption = (jsonStr: string) => {
  try {
    const obj = JSON.parse(jsonStr)
    return Object.values(obj).join(' / ')
  } catch {
    return 'Standard Choice'
  }
}

const handleAddToCart = (goToCheckout = false) => {
  if (!product.value) return
  const sku = selectedSku.value || { id: `${product.value.id}_sku_def`, option_values_json: '{"Option":"Standard"}' }
  cart.addItem({
    product_id: product.value.id,
    sku_id: sku.id,
    partner_id: product.value.partner_id || 'pt_001',
    partner_name: product.value.partner_name || 'Olmoa Official Flagship',
    title: product.value.title,
    brand: product.value.brand,
    option_Label: parseSkuOption(sku.option_values_json),
    price: currentPrice.value,
    original_price: originalPrice.value,
    quantity: quantity.value,
    thumbnail_url: product.value.thumbnail_url,
    slug: product.value.slug
  })
  if (goToCheckout) {
    router.push('/checkout')
  } else {
    addedToast.value = true
    setTimeout(() => { addedToast.value = false }, 2500)
  }
}
</script>

<template>
  <div class="max-w-[1280px] mx-auto px-4 sm:px-6 py-8 pb-28 lg:pb-12">
    <div v-if="loading" class="bg-white rounded-2xl p-8 animate-pulse grid grid-cols-1 lg:grid-cols-12 gap-8">
      <div class="lg:col-span-5 aspect-square bg-gray-200 rounded-xl"></div>
      <div class="lg:col-span-7 space-y-4">
        <div class="h-6 bg-gray-200 rounded w-1/3"></div>
        <div class="h-10 bg-gray-200 rounded w-3/4"></div>
        <div class="h-24 bg-gray-200 rounded w-full"></div>
      </div>
    </div>

    <div v-else-if="product">
      <!-- Breadcrumb -->
      <nav class="flex items-center gap-2 text-xs text-gray-500 mb-5">
        <RouterLink to="/" class="hover:text-[#FF5000]">Home</RouterLink>
        <span>/</span>
        <RouterLink :to="`/category/${product.category_slug || 'electronics'}`" class="hover:text-[#FF5000]">
          {{ product.category_name || 'Catalog' }}
        </RouterLink>
        <span>/</span>
        <span class="text-gray-800 font-semibold truncate max-w-xs">{{ product.title }}</span>
      </nav>

      <div class="bg-white rounded-2xl p-6 sm:p-8 shadow-xs border border-gray-200/80 grid grid-cols-1 lg:grid-cols-12 gap-8">
        <!-- Left Multi-Image Gallery -->
        <div class="lg:col-span-5">
          <div class="relative aspect-square rounded-2xl overflow-hidden bg-gray-100 border border-gray-100 mb-3">
            <img :src="activeImage || product.thumbnail_url" :alt="product.title" class="w-full h-full object-cover" />
            <span v-if="discountRate > 0" class="absolute top-3 left-3 bg-[#E60023] text-white text-xs font-black px-3 py-1 rounded-lg shadow-sm">
              SAVE {{ discountRate }}%
            </span>
            <button
              @click="toggleWishlist"
              class="absolute top-3 right-3 w-10 h-10 rounded-full bg-white/90 hover:bg-white shadow-md flex items-center justify-center text-lg cursor-pointer transition-transform hover:scale-105"
              :title="isWishlisted ? 'Remove from Wishlist' : 'Add to Wishlist'"
            >
              <span :class="isWishlisted ? 'text-[#E60023]' : 'text-gray-400'">♥</span>
            </button>
          </div>
          <!-- Thumbnails -->
          <div class="flex gap-2.5">
            <button
              v-for="(img, idx) in galleryImages"
              :key="idx"
              @click="activeImage = img"
              :class="['w-16 h-16 rounded-xl overflow-hidden border-2 cursor-pointer transition-all', activeImage === img ? 'border-[#FF5000] scale-105' : 'border-gray-200 opacity-75 hover:opacity-100']"
            >
              <img :src="img" class="w-full h-full object-cover" />
            </button>
          </div>
        </div>

        <!-- Right Buy Box -->
        <div class="lg:col-span-7 flex flex-col justify-between">
          <div>
            <!-- Partner Store Badge & Brand -->
            <div class="flex flex-wrap items-center justify-between gap-2 mb-2">
              <div class="flex items-center gap-2">
                <span class="px-2 py-0.5 bg-[#FFE600] text-black text-[10px] font-black rounded uppercase">OLMOA CHOICE</span>
                <span class="text-xs font-extrabold text-[#FF5000] uppercase tracking-wider">{{ product.brand }}</span>
              </div>
              <RouterLink
                :to="`/store/${product.partner_id || 'pt_001'}`"
                class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-gray-100 hover:bg-orange-50 text-xs font-bold text-gray-700 hover:text-[#FF5000] transition-colors"
              >
                <span>🏪 {{ product.partner_name || 'Olmoa Official Flagship' }}</span>
                <span class="text-[#FF5000]">Visit Store →</span>
              </RouterLink>
            </div>

            <h1 class="text-xl sm:text-2xl font-black text-gray-900 leading-snug mb-3">
              {{ product.title }}
            </h1>

            <!-- Rating & Sold Proof -->
            <div class="flex items-center gap-4 text-xs text-gray-600 mb-5 pb-4 border-b border-gray-100">
              <button @click="activeTab = 'reviews'" class="flex items-center gap-1 text-[#FFB800] font-black text-sm hover:underline cursor-pointer">
                ★★★★★ <span class="text-gray-900 ml-1">{{ reviewSummary.average_rating || 4.9 }}</span>
              </button>
              <span>•</span>
              <button @click="activeTab = 'reviews'" class="underline hover:text-[#FF5000] cursor-pointer">
                {{ reviewSummary.count }} Verified Reviews
              </button>
              <span>•</span>
              <button @click="activeTab = 'qna'" class="underline hover:text-[#FF5000] cursor-pointer">
                {{ qnaList.length }} Q&A
              </button>
              <span>•</span>
              <span class="font-bold text-gray-900">{{ (product.total_sold_count || 150).toLocaleString() }}+ Sold</span>
            </div>

            <!-- Flash Deal Price Banner -->
            <div class="bg-gradient-to-r from-orange-50 to-red-50 border border-orange-200/80 rounded-xl p-4 mb-6">
              <div class="flex items-baseline gap-3">
                <span class="text-3xl font-black text-[#E60023] tracking-tight">
                  {{ locale.formatPrice(currentPrice) }}
                </span>
                <span v-if="originalPrice > currentPrice" class="text-sm text-gray-400 line-through font-medium">
                  {{ locale.formatPrice(originalPrice) }}
                </span>
                <span v-if="discountRate > 0" class="px-2 py-0.5 bg-[#E60023] text-white text-xs font-black rounded">
                  -{{ discountRate }}% OFF
                </span>
              </div>
              <p class="text-[11px] text-gray-600 mt-1.5 font-medium">
                ✓ Price includes VAT • Earn <strong class="text-[#FF5000]">{{ locale.formatPrice(Math.round(currentPrice * 0.01)) }}</strong> (1%) Olmoa Credit upon purchase confirmation
              </p>
            </div>

            <!-- SKU Option Selector -->
            <div v-if="product.skus && product.skus.length > 0" class="mb-6">
              <label class="block text-xs font-extrabold text-gray-700 uppercase tracking-wider mb-2">
                Select Option ({{ product.skus.length }} available)
              </label>
              <div class="flex flex-wrap gap-2">
                <button
                  v-for="sku in product.skus"
                  :key="sku.id"
                  @click="selectedSku = sku"
                  :class="[
                    'px-4 py-2.5 rounded-xl text-xs font-bold border transition-all cursor-pointer flex items-center gap-2',
                    selectedSku?.id === sku.id
                      ? 'border-[#FF5000] bg-orange-50/70 text-[#FF5000] ring-2 ring-[#FF5000]/20'
                      : 'border-gray-200 bg-white text-gray-800 hover:border-gray-400'
                  ]"
                >
                  <span>{{ parseSkuOption(sku.option_values_json) }}</span>
                  <span class="text-[10px] text-gray-400">({{ sku.stock_quantity }} left)</span>
                </button>
              </div>
            </div>

            <!-- Quantity Selector -->
            <div class="flex items-center gap-4 mb-6">
              <label class="text-xs font-extrabold text-gray-700 uppercase tracking-wider">Quantity</label>
              <div class="flex items-center border border-gray-300 rounded-lg overflow-hidden">
                <button @click="quantity = Math.max(1, quantity - 1)" class="w-9 h-9 bg-gray-50 hover:bg-gray-100 font-bold text-gray-700 cursor-pointer">-</button>
                <span class="w-12 text-center text-sm font-bold">{{ quantity }}</span>
                <button @click="quantity++" class="w-9 h-9 bg-gray-50 hover:bg-gray-100 font-bold text-gray-700 cursor-pointer">+</button>
              </div>
              <span v-if="selectedSku" class="text-xs text-[#00A862] font-bold">
                ● In Stock ({{ selectedSku.stock_quantity }} units ready to ship)
              </span>
            </div>

            <!-- Trust & Delivery Guarantees -->
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-xs bg-gray-50 p-4 rounded-xl border border-gray-200/60 mb-6">
              <div class="flex items-center gap-2 text-gray-700">
                <span class="text-[#00A862] font-black">✓</span>
                <span><strong>Free Shipping</strong> on partner orders over ₩30,000</span>
              </div>
              <div class="flex items-center gap-2 text-gray-700">
                <span class="text-[#00A862] font-black">✓</span>
                <span><strong>₩5,000 Delay Credit</strong> if late</span>
              </div>
              <div class="flex items-center gap-2 text-gray-700">
                <span class="text-[#00A862] font-black">✓</span>
                <span><strong>90-Day Free Returns</strong> from Orders page</span>
              </div>
              <div class="flex items-center gap-2 text-gray-700">
                <span class="text-[#00A862] font-black">✓</span>
                <span><strong>30-Day Price Match</strong> instant adjustment</span>
              </div>
            </div>
          </div>

          <!-- Primary CTA Buttons -->
          <div class="space-y-3">
            <div v-if="addedToast" class="p-3 rounded-xl bg-[#00A862] text-white text-xs font-bold text-center shadow-sm">
              ✓ Added to your shopping cart!
            </div>
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <button
                @click="handleAddToCart(false)"
                class="h-13 rounded-full border-2 border-[#FF5000] text-[#FF5000] hover:bg-orange-50 font-black text-sm tracking-wide transition-colors cursor-pointer"
              >
                {{ locale.t('addToCart') }}
              </button>
              <button
                @click="handleAddToCart(true)"
                class="h-13 rounded-full bg-gradient-to-r from-[#FF5000] to-[#E60023] hover:opacity-95 text-white font-black text-sm tracking-wide shadow-md transition-opacity cursor-pointer"
              >
                {{ locale.t('buyNow') }}
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- Tabbed Navigation: Overview / Verified Reviews / Product Q&A / Shipping & Returns -->
      <div class="mt-8 bg-white rounded-2xl shadow-xs border border-gray-200/80 overflow-hidden">
        <div class="flex border-b border-gray-200 overflow-x-auto">
          <button
            @click="activeTab = 'description'"
            :class="['px-6 py-4 text-xs sm:text-sm font-black border-b-2 transition-colors cursor-pointer whitespace-nowrap', activeTab === 'description' ? 'border-[#FF5000] text-[#FF5000]' : 'border-transparent text-gray-600 hover:text-gray-900']"
          >
            Product Specifications
          </button>
          <button
            @click="activeTab = 'reviews'"
            :class="['px-6 py-4 text-xs sm:text-sm font-black border-b-2 transition-colors cursor-pointer whitespace-nowrap', activeTab === 'reviews' ? 'border-[#FF5000] text-[#FF5000]' : 'border-transparent text-gray-600 hover:text-gray-900']"
          >
            Verified Customer Reviews ({{ reviewSummary.count }})
          </button>
          <button
            @click="activeTab = 'qna'"
            :class="['px-6 py-4 text-xs sm:text-sm font-black border-b-2 transition-colors cursor-pointer whitespace-nowrap', activeTab === 'qna' ? 'border-[#FF5000] text-[#FF5000]' : 'border-transparent text-gray-600 hover:text-gray-900']"
          >
            Product Q&A ({{ qnaList.length }})
          </button>
          <button
            @click="activeTab = 'shipping'"
            :class="['px-6 py-4 text-xs sm:text-sm font-black border-b-2 transition-colors cursor-pointer whitespace-nowrap', activeTab === 'shipping' ? 'border-[#FF5000] text-[#FF5000]' : 'border-transparent text-gray-600 hover:text-gray-900']"
          >
            Shipping, Escrow & Return Policy
          </button>
        </div>

        <div class="p-6 sm:p-8">
          <!-- Tab 1: Sanitized Description -->
          <div v-if="activeTab === 'description'">
            <div class="prose max-w-none text-sm text-gray-700 leading-relaxed" v-html="sanitizedDescriptionHtml"></div>
          </div>

          <!-- Tab 2: Real Customer Reviews & Submission Form -->
          <div v-else-if="activeTab === 'reviews'" class="space-y-6">
            <div class="bg-gray-50 rounded-2xl p-5 border border-gray-200/70 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
              <div>
                <div class="flex items-center gap-2">
                  <span class="text-3xl font-black text-gray-900">{{ reviewSummary.average_rating || 4.9 }}</span>
                  <span class="text-xl text-[#FFB800]">★★★★★</span>
                </div>
                <p class="text-xs text-gray-500 mt-1">Based on {{ reviewSummary.count }} reviews • Verified purchases are badged automatically</p>
              </div>

              <!-- Write Review Form -->
              <form @submit.prevent="submitReview" class="w-full md:w-96 space-y-2">
                <div class="flex items-center justify-between">
                  <span class="text-xs font-extrabold text-gray-700">Write a Customer Review</span>
                  <select v-model="newReviewRating" class="text-xs border border-gray-300 rounded px-2 py-1 font-bold">
                    <option :value="5">★★★★★ (5)</option>
                    <option :value="4">★★★★☆ (4)</option>
                    <option :value="3">★★★☆☆ (3)</option>
                    <option :value="2">★★☆☆☆ (2)</option>
                    <option :value="1">★☆☆☆☆ (1)</option>
                  </select>
                </div>
                <div class="flex gap-2">
                  <input
                    v-model="newReviewComment"
                    type="text"
                    required
                    placeholder="Share your experience with this product..."
                    class="flex-1 h-9 px-3 rounded-lg border border-gray-300 text-xs focus:outline-none focus:border-[#FF5000]"
                  />
                  <button
                    type="submit"
                    :disabled="reviewSubmitting"
                    class="px-4 h-9 rounded-lg bg-[#111111] hover:bg-[#FF5000] text-white text-xs font-bold transition-colors cursor-pointer"
                  >
                    Post
                  </button>
                </div>
                <p v-if="reviewMsg" class="text-xs text-[#00A862] font-bold">{{ reviewMsg }}</p>
              </form>
            </div>

            <div v-if="reviews.length === 0" class="text-center py-8 text-xs text-gray-400">
              No reviews yet. Be the first to review this item!
            </div>
            <div v-else class="divide-y divide-gray-100">
              <div v-for="rev in reviews" :key="rev.id" class="py-4">
                <div class="flex items-center justify-between mb-1.5">
                  <div class="flex items-center gap-2">
                    <span class="text-sm text-[#FFB800] font-bold">{{ '★'.repeat(rev.rating || 5) }}</span>
                    <span class="text-xs font-bold text-gray-900">{{ rev.customer_name || 'Verified Shopper' }}</span>
                    <span v-if="rev.is_verified_purchase" class="px-2 py-0.5 bg-green-50 text-[#00A862] text-[10px] font-extrabold rounded border border-green-200">
                      ✓ Verified Purchase
                    </span>
                  </div>
                  <span class="text-[11px] text-gray-400">{{ new Date(rev.created_at).toLocaleDateString() }}</span>
                </div>
                <p class="text-xs sm:text-sm text-gray-700 leading-relaxed">{{ rev.comment }}</p>
              </div>
            </div>
          </div>

          <!-- Tab 3: Product Q&A -->
          <div v-else-if="activeTab === 'qna'" class="space-y-6">
            <form @submit.prevent="submitQuestion" class="bg-gray-50 rounded-2xl p-5 border border-gray-200/70">
              <h3 class="text-xs font-extrabold text-gray-800 uppercase tracking-wider mb-2">Ask the Seller a Question about this Product</h3>
              <div class="flex gap-2">
                <input
                  v-model="newQuestion"
                  type="text"
                  required
                  placeholder="Ask about compatibility, warranty, sizing, or bulk stock..."
                  class="flex-1 h-10 px-3.5 rounded-xl border border-gray-300 bg-white text-xs focus:outline-none focus:border-[#FF5000]"
                />
                <button
                  type="submit"
                  :disabled="qnaSubmitting"
                  class="px-5 h-10 rounded-xl bg-[#FF5000] text-white text-xs font-black hover:bg-[#E60023] transition-colors cursor-pointer"
                >
                  Submit Question
                </button>
              </div>
              <p v-if="qnaMsg" class="text-xs text-[#00A862] font-bold mt-2">{{ qnaMsg }}</p>
            </form>

            <div v-if="qnaList.length === 0" class="text-center py-8 text-xs text-gray-400">
              No questions asked yet. Ask the seller above!
            </div>
            <div v-else class="space-y-4">
              <div v-for="q in qnaList" :key="q.id" class="p-4 rounded-xl border border-gray-200 bg-white">
                <div class="flex items-center justify-between mb-2">
                  <div class="flex items-center gap-2">
                    <span class="px-2 py-0.5 rounded bg-gray-900 text-white text-[10px] font-black">Q</span>
                    <span class="text-xs font-bold text-gray-900">{{ q.question }}</span>
                  </div>
                  <span :class="['px-2 py-0.5 rounded text-[10px] font-extrabold', q.status === 'ANSWERED' ? 'bg-green-50 text-[#00A862]' : 'bg-amber-50 text-amber-700']">
                    {{ q.status }}
                  </span>
                </div>
                <div v-if="q.answer" class="mt-2 pl-4 border-l-2 border-[#FF5000] bg-orange-50/30 p-2.5 rounded-r-lg">
                  <div class="text-[11px] font-extrabold text-[#FF5000] mb-0.5">Official Seller Answer</div>
                  <p class="text-xs text-gray-700">{{ q.answer }}</p>
                </div>
              </div>
            </div>
          </div>

          <!-- Tab 4: Shipping & Return Policy -->
          <div v-else class="text-xs text-gray-600 space-y-3 leading-relaxed">
            <p><strong>• Partner-Grouped Split Shipping:</strong> Shipping is free per seller when your items from that seller total ₩30,000 or more (otherwise ₩3,000 base fee).</p>
            <p><strong>• 90-Day Free Return Guarantee:</strong> Request an instant return or exchange within 90 days of delivery from your Order Detail page.</p>
            <p><strong>• 30-Day Price-Match Guarantee:</strong> If the sale price drops on OLMOA within 30 days of your order, claim an instant price-difference credit.</p>
          </div>
        </div>
      </div>

      <!-- Mobile Sticky Bottom Purchase Bar -->
      <div class="fixed bottom-0 left-0 right-0 z-40 lg:hidden bg-white border-t border-gray-200 px-4 py-2.5 flex items-center justify-between gap-3 shadow-2xl">
        <button @click="toggleWishlist" class="w-10 h-10 rounded-full border border-gray-200 flex items-center justify-center text-lg">
          <span :class="isWishlisted ? 'text-[#E60023]' : 'text-gray-400'">♥</span>
        </button>
        <div class="flex-1">
          <div class="text-[10px] text-gray-400 font-bold">Best Direct Price</div>
          <div class="text-base font-black text-[#E60023]">{{ locale.formatPrice(currentPrice) }}</div>
        </div>
        <button @click="handleAddToCart(false)" class="px-4 h-10 rounded-full border-2 border-[#FF5000] text-[#FF5000] text-xs font-black">
          Add to Cart
        </button>
        <button @click="handleAddToCart(true)" class="px-5 h-10 rounded-full bg-[#FF5000] text-white text-xs font-black">
          Buy Now
        </button>
      </div>
    </div>
  </div>
</template>
