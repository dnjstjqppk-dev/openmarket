<script setup lang="ts">
// 3-9: shared my-page frame. Desktop shows a 200px menu beside the content;
// on mobile the menu hides and /my (shortcuts) is the menu instead.
import { RouterLink, useRoute } from 'vue-router'

defineProps<{ title: string }>()

const route = useRoute()

const items = [
  { to: '/my', label: '마이홈' },
  { to: '/orders', label: '주문·배송' },
  { to: '/my/reviews', label: '리뷰' },
  { to: '/my/qna', label: '문의 내역' },
  { to: '/my/recent', label: '최근 본 상품' },
  { to: '/my/credits', label: '적립금' },
  { to: '/my/stores', label: '팔로우 스토어' },
  { to: '/coupons', label: '쿠폰' },
  { to: '/wishlist', label: '찜' },
  { to: '/addresses', label: '배송지' },
  { to: '/my/settings', label: '회원정보' }
] as const

// /my matches exactly (it prefixes every sibling); the rest match their subtree.
const isActive = (to: string) => (to === '/my' ? route.path === '/my' : route.path === to || route.path.startsWith(`${to}/`))
</script>

<template>
  <div class="om-container flex gap-6 py-6">
    <aside class="hidden w-[200px] shrink-0 md:block" aria-label="마이 메뉴">
      <nav class="space-y-1 rounded-2xl border border-line bg-surface p-3">
        <RouterLink
          v-for="it in items"
          :key="it.to"
          :to="it.to"
          :class="[
            'block rounded-xl px-3 py-2 text-sm font-semibold hover:bg-surface-2',
            isActive(it.to) ? 'bg-primary-soft text-primary-soft-ink' : 'text-ink-muted hover:text-ink'
          ]"
        >
          {{ it.label }}
        </RouterLink>
      </nav>
    </aside>
    <section class="min-w-0 flex-1">
      <h1 class="mb-4 text-xl font-bold text-ink">{{ title }}</h1>
      <slot />
    </section>
  </div>
</template>
