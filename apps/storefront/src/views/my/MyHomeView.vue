<script setup lang="ts">
// 3-9: /my home — member summary, order pipeline, shortcut grid. Every count
// comes from the same API the linked page reads, so the numbers always agree.
import { ref, onMounted } from 'vue'
import { RouterLink } from 'vue-router'
import { useWishlistStore } from '../../stores/wishlist'
import { API_BASE_URL, authHeader } from '../../config'
import { userErrorMessage, OmEmptyState, OmErrorState, OmSkeleton } from '@olmoa/ui'
import MyLayout from './MyLayout.vue'

const wishlist = useWishlistStore()

const loading = ref(true)
const loadError = ref('')
const member = ref<any>({})
const summary = ref({ upcoming: 0, purchasing: 0, completed: 0, total: 0 })
const couponCount = ref(0)
const creditBalance = ref(0)
const reviewableCount = ref(0)

const formatDate = (dStr?: string) => {
  if (!dStr) return '-'
  const d = new Date(dStr)
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`
}

const load = async () => {
  loading.value = true
  loadError.value = ''
  try {
    const [profileRes, summaryRes, couponsRes, reviewableRes] = await Promise.all([
      fetch(`${API_BASE_URL}/api/v1/auth/profile`, { headers: { ...authHeader() } }),
      fetch(`${API_BASE_URL}/api/v1/me/order-summary`, { headers: { ...authHeader() } }),
      fetch(`${API_BASE_URL}/api/v1/coupons`, { headers: { ...authHeader() } }),
      fetch(`${API_BASE_URL}/api/v1/me/reviewable`, { headers: { ...authHeader() } })
    ])
    const [profile, sum, coupons, reviewable] = await Promise.all([
      profileRes.json(), summaryRes.json(), couponsRes.json(), reviewableRes.json()
    ])
    if (!profile.success) throw new Error(profile.error || '회원 정보를 불러오지 못했습니다.')
    if (!sum.success) throw new Error(sum.error || '주문 현황을 불러오지 못했습니다.')
    member.value = profile.data.user || {}
    creditBalance.value = profile.data.credit_balance || 0
    summary.value = sum.data
    couponCount.value = coupons.success && Array.isArray(coupons.data?.usable) ? coupons.data.usable.length : 0
    reviewableCount.value = reviewable.success ? reviewable.count || 0 : 0
    await wishlist.load()
  } catch (e: any) {
    loadError.value = userErrorMessage(e, '마이페이지를 불러오지 못했습니다.')
  } finally {
    loading.value = false
  }
}

onMounted(load)
</script>

<template>
  <MyLayout title="마이페이지">
    <div v-if="loading" class="space-y-4">
      <OmSkeleton variant="rect" height="h-28" />
      <OmSkeleton variant="row" :count="3" />
    </div>
    <OmErrorState v-else-if="loadError" :message="loadError" @retry="load" />
    <div v-else class="space-y-6">
      <!-- Member summary -->
      <section class="rounded-2xl border border-line bg-surface p-5" aria-label="회원 요약">
        <div class="flex items-center gap-4">
          <span class="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary-soft text-xl font-bold text-primary-soft-ink" aria-hidden="true">
            {{ (member.full_name || '회').charAt(0) }}
          </span>
          <div class="min-w-0">
            <p class="truncate text-base font-bold text-ink">{{ member.full_name || '회원' }}</p>
            <p class="truncate text-xs text-ink-muted">{{ member.email || '-' }}</p>
            <p class="mt-0.5 text-2xs text-ink-subtle">가입일 {{ formatDate(member.created_at) }}</p>
          </div>
        </div>
      </section>

      <!-- Order pipeline -->
      <section aria-label="주문 진행 상태">
        <div class="grid grid-cols-3 gap-3">
          <RouterLink to="/orders?tab=upcoming" class="rounded-2xl border border-line bg-surface p-4 text-center transition-colors hover:border-line-strong">
            <span class="om-num block text-xl font-bold text-ink">{{ summary.upcoming }}</span>
            <span class="mt-1 block text-xs font-semibold text-ink-muted">예정</span>
          </RouterLink>
          <RouterLink to="/orders?tab=purchasing" class="rounded-2xl border border-line bg-surface p-4 text-center transition-colors hover:border-line-strong">
            <span class="om-num block text-xl font-bold text-ink">{{ summary.purchasing }}</span>
            <span class="mt-1 block text-xs font-semibold text-ink-muted">구매중</span>
          </RouterLink>
          <RouterLink to="/orders?tab=completed" class="rounded-2xl border border-line bg-surface p-4 text-center transition-colors hover:border-line-strong">
            <span class="om-num block text-xl font-bold text-ink">{{ summary.completed }}</span>
            <span class="mt-1 block text-xs font-semibold text-ink-muted">완료</span>
          </RouterLink>
        </div>
      </section>

      <!-- Shortcuts -->
      <nav class="grid grid-cols-2 gap-3 sm:grid-cols-3" aria-label="바로가기">
        <RouterLink to="/coupons" class="rounded-2xl border border-line bg-surface p-4 transition-colors hover:border-line-strong">
          <span class="om-num block text-sm font-bold text-primary">쿠폰 {{ couponCount }}장</span>
          <span class="mt-0.5 block text-2xs text-ink-muted">사용 가능한 쿠폰</span>
        </RouterLink>
        <RouterLink to="/my/credits" class="rounded-2xl border border-line bg-surface p-4 transition-colors hover:border-line-strong">
          <span class="om-num block text-sm font-bold text-primary">적립금 {{ creditBalance.toLocaleString('ko-KR') }}원</span>
          <span class="mt-0.5 block text-2xs text-ink-muted">보유 적립금</span>
        </RouterLink>
        <RouterLink to="/wishlist" class="rounded-2xl border border-line bg-surface p-4 transition-colors hover:border-line-strong">
          <span class="om-num block text-sm font-bold text-ink">찜 {{ wishlist.ids.size }}</span>
          <span class="mt-0.5 block text-2xs text-ink-muted">찜한 상품</span>
        </RouterLink>
        <RouterLink to="/my/recent" class="rounded-2xl border border-line bg-surface p-4 transition-colors hover:border-line-strong">
          <span class="block text-sm font-bold text-ink">최근 본 상품</span>
          <span class="mt-0.5 block text-2xs text-ink-muted">최근에 본 상품 보기</span>
        </RouterLink>
        <RouterLink to="/my/stores" class="rounded-2xl border border-line bg-surface p-4 transition-colors hover:border-line-strong">
          <span class="block text-sm font-bold text-ink">팔로우 스토어</span>
          <span class="mt-0.5 block text-2xs text-ink-muted">팔로우한 스토어</span>
        </RouterLink>
        <RouterLink to="/my/reviews" class="rounded-2xl border border-line bg-surface p-4 transition-colors hover:border-line-strong">
          <span class="om-num block text-sm font-bold text-ink">쓸 수 있는 리뷰 {{ reviewableCount }}건</span>
          <span class="mt-0.5 block text-2xs text-ink-muted">리뷰 쓰기</span>
        </RouterLink>
        <RouterLink to="/my/qna" class="rounded-2xl border border-line bg-surface p-4 transition-colors hover:border-line-strong">
          <span class="block text-sm font-bold text-ink">문의 내역</span>
          <span class="mt-0.5 block text-2xs text-ink-muted">1:1 문의 보기</span>
        </RouterLink>
        <RouterLink to="/addresses" class="rounded-2xl border border-line bg-surface p-4 transition-colors hover:border-line-strong">
          <span class="block text-sm font-bold text-ink">배송지</span>
          <span class="mt-0.5 block text-2xs text-ink-muted">배송지 관리</span>
        </RouterLink>
        <RouterLink to="/my/settings" class="rounded-2xl border border-line bg-surface p-4 transition-colors hover:border-line-strong">
          <span class="block text-sm font-bold text-ink">회원정보</span>
          <span class="mt-0.5 block text-2xs text-ink-muted">정보 수정·탈퇴</span>
        </RouterLink>
      </nav>

      <OmEmptyState v-if="summary.total === 0" title="아직 주문이 없습니다" description="첫 주문을 해보세요.">
        <RouterLink to="/" class="rounded-full bg-primary px-5 py-2.5 text-xs font-bold text-primary-on hover:bg-primary-hover">쇼핑하러 가기</RouterLink>
      </OmEmptyState>
    </div>
  </MyLayout>
</template>
