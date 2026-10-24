<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { RouterLink, RouterView, useRouter } from 'vue-router'
import { useCartStore } from './stores/cart'
import { useAuthStore } from './stores/auth'
import { useLocaleStore } from './stores/locale'
import { API_BASE_URL, PARTNER_CONSOLE_URL, ADMIN_CONSOLE_URL } from './config'
import SearchAutocomplete from './components/SearchAutocomplete.vue'

const cart = useCartStore()
const auth = useAuthStore()
const locale = useLocaleStore()
const router = useRouter()

const showMegaMenu = ref(false)
const allCategories = ref<any[]>([])
const activeRootCat = ref<any>(null)

const rootCategories = computed(() =>
  allCategories.value.filter(c => Number(c.depth) === 0).slice(0, 14)
)
const subCategories = computed(() => {
  if (!activeRootCat.value) return []
  return allCategories.value.filter(c => c.parent_id === activeRootCat.value.id)
})

const handleLogout = () => {
  auth.logout()
  router.push('/')
}

onMounted(async () => {
  try {
    const res = await fetch(`${API_BASE_URL}/api/v1/categories`)
    const json = await res.json()
    if (json.success && Array.isArray(json.data)) {
      allCategories.value = json.data
      const roots = json.data.filter((c: any) => Number(c.depth) === 0)
      if (roots.length > 0) activeRootCat.value = roots[0]
    }
  } catch {}
})
</script>

<template>
  <div class="min-h-screen flex flex-col bg-[#F5F5F7] text-[#111111] font-sans antialiased selection:bg-[#FF5000] selection:text-white">
    <!-- Top Trust & Utility Bar -->
    <div class="bg-[#111111] text-white text-[11px] font-medium py-1.5 px-4 border-b border-gray-800">
      <div class="max-w-[1440px] mx-auto flex flex-wrap justify-between items-center gap-2">
        <div class="flex items-center gap-5">
          <span class="flex items-center gap-1.5 text-[#00A862] font-bold">
            <svg class="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20"><path d="M5 4a2 2 0 012-2h6a2 2 0 012 2v14l-5-2.5L5 18V4z"/></svg>
            Free Shipping on Orders ₩30,000+
          </span>
          <RouterLink to="/policy/price-match" class="hidden sm:inline text-gray-300 hover:text-white transition-colors">✓ 30-Day Price-Match Adjustment</RouterLink>
          <RouterLink to="/policy/returns" class="hidden md:inline text-gray-300 hover:text-white transition-colors">✓ Free 90-Day Returns</RouterLink>
        </div>
        <div class="flex items-center gap-4 text-gray-300">
          <!-- Language & Currency Selector -->
          <div class="flex items-center gap-1.5 bg-gray-900 px-2 py-0.5 rounded border border-gray-700">
            <select
              :value="locale.lang"
              @change="locale.setLang(($event.target as HTMLSelectElement).value as any)"
              class="bg-transparent text-white text-[11px] font-bold focus:outline-none cursor-pointer"
              aria-label="Select Language"
            >
              <option value="ko" class="text-black">🇰🇷 한국어</option>
              <option value="en" class="text-black">🇺🇸 EN</option>
              <option value="ja" class="text-black">🇯🇵 日本語</option>
            </select>
            <span class="text-gray-600">/</span>
            <select
              :value="locale.currency"
              @change="locale.setCurrency(($event.target as HTMLSelectElement).value as any)"
              class="bg-transparent text-[#FF5000] text-[11px] font-bold focus:outline-none cursor-pointer"
              aria-label="Select Currency"
            >
              <option value="KRW" class="text-black">KRW (₩)</option>
              <option value="USD" class="text-black">USD ($)</option>
              <option value="JPY" class="text-black">JPY (¥)</option>
            </select>
          </div>
          <a :href="PARTNER_CONSOLE_URL" target="_blank" rel="noopener" class="hover:text-[#FF5000] transition-colors font-semibold">Sell on OLMOA (Partner Center)</a>
          <span class="text-gray-600">|</span>
          <RouterLink to="/support" class="hover:text-white transition-colors">Help & 1:1 Support</RouterLink>
        </div>
      </div>
    </div>

    <!-- Main Sticky Commercial Header -->
    <header class="sticky top-0 z-50 bg-white shadow-sm border-b border-gray-200">
      <div class="max-w-[1440px] mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-3 sm:gap-6">
        <!-- Brand & Mega-Menu Trigger -->
        <div class="flex items-center gap-4 shrink-0 relative" @mouseleave="showMegaMenu = false">
          <RouterLink to="/" class="flex items-center gap-1.5 group">
            <div class="w-9 h-9 rounded-xl bg-gradient-to-br from-[#FF5000] to-[#E60023] flex items-center justify-center text-white font-black text-xl shadow-sm group-hover:scale-105 transition-transform">
              O
            </div>
            <span class="text-2xl font-black tracking-tighter text-[#111111]">OLMOA</span>
          </RouterLink>

          <button
            @mouseenter="showMegaMenu = true"
            @click="router.push('/categories')"
            class="hidden lg:flex items-center gap-1.5 px-3 py-2 rounded-full hover:bg-gray-100 text-sm font-bold text-gray-800 transition-colors cursor-pointer"
          >
            <svg class="w-4 h-4 text-[#FF5000]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16"/></svg>
            {{ locale.t('categories') }}
            <svg class="w-3.5 h-3.5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"/></svg>
          </button>

          <!-- Mega-Menu Flyout -->
          <div
            v-if="showMegaMenu && rootCategories.length > 0"
            class="absolute top-full left-0 pt-2 w-[680px] z-50"
          >
            <div class="bg-white rounded-2xl shadow-2xl border border-gray-200 flex overflow-hidden min-h-[360px]">
              <div class="w-64 bg-gray-50 border-r border-gray-100 py-2 max-h-[420px] overflow-y-auto">
                <div
                  v-for="cat in rootCategories"
                  :key="cat.id"
                  @mouseenter="activeRootCat = cat"
                  @click="showMegaMenu = false; router.push(`/category/${cat.slug}`)"
                  :class="['px-4 py-2.5 text-xs font-bold flex items-center justify-between cursor-pointer transition-colors', activeRootCat?.id === cat.id ? 'bg-white text-[#FF5000] shadow-xs' : 'text-gray-700 hover:bg-gray-100']"
                >
                  <span class="truncate">{{ cat.name }}</span>
                  <span class="text-[10px] text-gray-400">›</span>
                </div>
                <RouterLink
                  to="/categories"
                  @click="showMegaMenu = false"
                  class="block px-4 py-2.5 text-xs font-black text-[#FF5000] hover:underline border-t border-gray-200 mt-1"
                >
                  View All 42 Departments →
                </RouterLink>
              </div>
              <div class="flex-1 p-5 bg-white">
                <div v-if="activeRootCat" class="mb-4 flex items-center justify-between border-b border-gray-100 pb-3">
                  <div>
                    <h4 class="text-base font-black text-gray-900">{{ activeRootCat.name }}</h4>
                    <p class="text-[11px] text-gray-400">Direct Factory & Official Brand Store</p>
                  </div>
                  <RouterLink
                    :to="`/category/${activeRootCat.slug}`"
                    @click="showMegaMenu = false"
                    class="text-xs font-bold text-[#FF5000] hover:underline"
                  >
                    Shop All →
                  </RouterLink>
                </div>
                <div v-if="subCategories.length > 0" class="grid grid-cols-2 gap-2.5">
                  <RouterLink
                    v-for="sub in subCategories"
                    :key="sub.id"
                    :to="`/category/${sub.slug}`"
                    @click="showMegaMenu = false"
                    class="px-3 py-2 rounded-lg border border-gray-100 hover:border-[#FF5000] hover:bg-orange-50/40 text-xs font-semibold text-gray-700 hover:text-[#FF5000] transition-all flex items-center justify-between"
                  >
                    <span class="truncate">{{ sub.name }}</span>
                    <span class="text-[10px] text-gray-400">{{ sub.product_count || '' }}</span>
                  </RouterLink>
                </div>
                <div v-else class="text-xs text-gray-400 py-8 text-center">
                  Explore top-rated items in {{ activeRootCat?.name }}
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Central Search Autocomplete Engine -->
        <SearchAutocomplete />

        <!-- Right User Actions -->
        <div class="flex items-center gap-1 sm:gap-2 shrink-0">
          <div v-if="auth.isAuthenticated" class="flex items-center gap-1">
            <RouterLink to="/orders" class="flex items-center gap-2 px-2.5 py-1.5 rounded-full hover:bg-gray-100 transition-colors">
              <div class="w-7 h-7 rounded-full bg-orange-100 text-[#FF5000] flex items-center justify-center font-black text-xs">
                {{ auth.user?.name?.charAt(0) || 'U' }}
              </div>
              <div class="hidden xl:flex flex-col text-left leading-tight">
                <span class="text-[10px] text-gray-500">Hello, {{ auth.user?.name }}</span>
                <span class="text-xs font-bold text-gray-900">{{ locale.t('orders') }}</span>
              </div>
            </RouterLink>
            <button @click="handleLogout" class="text-[11px] text-gray-400 hover:text-red-600 px-1.5 py-1 cursor-pointer" title="Sign Out">Exit</button>
          </div>
          <RouterLink v-else to="/login" class="flex items-center gap-2 px-2.5 py-1.5 rounded-full hover:bg-gray-100 transition-colors">
            <svg class="w-5 h-5 text-gray-700" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"/></svg>
            <div class="hidden xl:flex flex-col text-left leading-tight">
              <span class="text-[10px] text-gray-500">{{ locale.t('signIn') }}</span>
              <span class="text-xs font-bold text-gray-900">Account</span>
            </div>
          </RouterLink>

          <RouterLink to="/coupons" class="hidden md:flex items-center gap-1 px-2.5 py-1.5 rounded-full hover:bg-gray-100 transition-colors text-xs font-bold text-gray-800" title="Coupons & Credits">
            <span class="text-base">🎟️</span>
            <span class="hidden lg:inline">{{ locale.t('coupons') }}</span>
          </RouterLink>

          <RouterLink to="/wishlist" class="flex items-center gap-1 px-2.5 py-1.5 rounded-full hover:bg-gray-100 transition-colors text-xs font-bold text-gray-800" title="Wishlist">
            <svg class="w-5 h-5 text-gray-700 hover:text-[#E60023]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z"/></svg>
            <span class="hidden lg:inline">{{ locale.t('wishlist') }}</span>
          </RouterLink>

          <!-- Shopping Cart -->
          <RouterLink to="/cart" class="relative flex items-center gap-1.5 px-3.5 py-2 rounded-full bg-orange-50 hover:bg-orange-100 text-[#FF5000] transition-colors">
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.2" d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z"/></svg>
            <span class="text-xs font-extrabold hidden sm:inline">{{ locale.t('cart') }}</span>
            <span v-if="cart.totalCount > 0" class="px-1.5 py-0.5 text-[11px] font-black bg-[#FF5000] text-white rounded-full leading-none shadow-xs">
              {{ cart.totalCount }}
            </span>
          </RouterLink>
        </div>
      </div>

      <!-- Sub-Header Channel Navigation Bar -->
      <div class="bg-white border-t border-gray-100 px-4">
        <div class="max-w-[1440px] mx-auto flex items-center gap-6 h-9 overflow-x-auto no-scrollbar text-xs font-bold text-gray-700">
          <RouterLink to="/channel/lightning-deals" class="flex items-center gap-1 text-[#E60023] hover:opacity-80 shrink-0">
            <span>⚡</span> {{ locale.t('lightningDeals') }}
          </RouterLink>
          <RouterLink to="/channel/best-sellers" class="flex items-center gap-1 text-[#FF5000] hover:opacity-80 shrink-0">
            <span>🏆</span> {{ locale.t('bestSellers') }}
          </RouterLink>
          <RouterLink to="/categories" class="hover:text-[#FF5000] shrink-0">All 42 Categories</RouterLink>
          <RouterLink to="/coupons" class="hover:text-[#FF5000] shrink-0">Coupon & Credit Center</RouterLink>
          <RouterLink to="/store/pt_001" class="hover:text-[#FF5000] shrink-0">Official Partner Flagship</RouterLink>
          <RouterLink to="/store/pt_002" class="hover:text-[#FF5000] shrink-0">K-Tech Lifestyle Store</RouterLink>
          <RouterLink to="/support" class="hover:text-[#FF5000] shrink-0">Customer Care & Claims</RouterLink>
        </div>
      </div>
    </header>

    <!-- Main View Router -->
    <main class="flex-1">
      <RouterView />
    </main>

    <!-- Footer with Korean Electronic Commerce Act Disclosures -->
    <footer class="bg-[#111111] text-gray-400 text-xs mt-16 border-t border-gray-800">
      <div class="max-w-[1440px] mx-auto px-4 sm:px-6 py-12 grid grid-cols-2 md:grid-cols-5 gap-8">
        <div>
          <div class="flex items-center gap-2 mb-3">
            <div class="w-7 h-7 rounded-lg bg-[#FF5000] flex items-center justify-center text-white font-black text-sm">O</div>
            <span class="text-white font-black text-base tracking-tight">OLMOA GLOBAL</span>
          </div>
          <p class="text-gray-500 leading-relaxed mb-4">Next-Gen Direct Factory & Verified Brand OpenMarket Engine powered by Cloudflare Edge & D1.</p>
          <div class="flex gap-2 text-[10px] text-gray-300 font-bold">
            <span class="px-2 py-1 bg-gray-800 rounded">PCI-DSS Ready</span>
            <span class="px-2 py-1 bg-gray-800 rounded">Escrow Protected</span>
          </div>
        </div>
        <div>
          <h4 class="text-white font-bold mb-3 uppercase tracking-wider">Shopping Channels</h4>
          <ul class="space-y-2">
            <li><RouterLink to="/channel/lightning-deals" class="hover:text-white">⚡ Lightning Deals</RouterLink></li>
            <li><RouterLink to="/channel/best-sellers" class="hover:text-white">🏆 Top 100 Best Sellers</RouterLink></li>
            <li><RouterLink to="/categories" class="hover:text-white">All 42 Categories</RouterLink></li>
            <li><RouterLink to="/coupons" class="hover:text-white">Coupons & Reward Credits</RouterLink></li>
          </ul>
        </div>
        <div>
          <h4 class="text-white font-bold mb-3 uppercase tracking-wider">Buyer Protection</h4>
          <ul class="space-y-2">
            <li><RouterLink to="/policy/price-match" class="hover:text-white">30-Day Price-Match Refund</RouterLink></li>
            <li><RouterLink to="/policy/returns" class="hover:text-white">90-Day Free Return Guarantee</RouterLink></li>
            <li><RouterLink to="/policy/shipping" class="hover:text-white">Split-Partner Delivery Policy</RouterLink></li>
            <li><RouterLink to="/orders" class="hover:text-white">Order Tracking & Claims</RouterLink></li>
          </ul>
        </div>
        <div>
          <h4 class="text-white font-bold mb-3 uppercase tracking-wider">Partner Ecosystem</h4>
          <ul class="space-y-2">
            <li><a :href="PARTNER_CONSOLE_URL" target="_blank" rel="noopener" class="hover:text-[#FF5000] text-gray-300 font-semibold">Partner Seller Center ↗</a></li>
            <li><RouterLink to="/store/pt_001" class="hover:text-white">Olmoa Official Flagship</RouterLink></li>
            <li><RouterLink to="/store/pt_002" class="hover:text-white">K-Tech & Lifestyle Official</RouterLink></li>
            <li><a :href="ADMIN_CONSOLE_URL" target="_blank" rel="noopener" class="hover:text-white">Admin Ledger & Audit Portal ↗</a></li>
          </ul>
        </div>
        <div>
          <h4 class="text-white font-bold mb-3 uppercase tracking-wider">Customer Care & Legal</h4>
          <ul class="space-y-2">
            <li><RouterLink to="/support" class="hover:text-white">Help Center & 1:1 Inquiry</RouterLink></li>
            <li><RouterLink to="/policy/terms" class="hover:text-white">Terms of Service (이용약관)</RouterLink></li>
            <li><RouterLink to="/policy/privacy" class="hover:text-white font-bold text-white">Privacy Policy (개인정보처리방침)</RouterLink></li>
            <li><RouterLink to="/policy/escrow" class="hover:text-white">Escrow Purchase Safety Guarantee</RouterLink></li>
          </ul>
        </div>
      </div>
      <div class="border-t border-gray-800 py-6 px-4 text-[11px] text-gray-500">
        <div class="max-w-[1440px] mx-auto flex flex-col md:flex-row justify-between gap-4">
          <div>
            <p class="font-semibold text-gray-400 mb-1">주식회사 올모아글로벌 (OLMOA Commerce Inc.) | 대표이사: 김올모 | 사업자등록번호: 120-88-99102 | 통신판매업신고: 제2026-서울강남-04821호</p>
            <p>주소: 서울특별시 강남구 테헤란로 427, 올모아타워 15층 | 고객센터: 1588-0000 (평일 09:00~18:00) | 전자우편: support@olmoa.com</p>
            <p class="mt-1 text-gray-600">올모아는 통신판매중개자로서 오픈마켓 거래 당사자가 아니며, 입점 판매자가 등록한 상품 정보 및 거래에 대해 올모아 결제대금예치(에스크로) 및 90일 무료반품/30일 최저가 차액보상 정책에 따라 소비자를 보호합니다.</p>
          </div>
          <div class="shrink-0 text-right self-end">
            <p>© 2026 OLMOA Commerce Inc. All rights reserved.</p>
          </div>
        </div>
      </div>
    </footer>
  </div>
</template>
