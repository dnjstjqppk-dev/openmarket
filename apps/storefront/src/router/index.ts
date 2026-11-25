import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router'
import HomeView from '../views/HomeView.vue'

// 6-2: locale mirrors. Every localizable route exists bare (ko, no prefix)
// and under /en + /ja with the same component, catalog and prices.
// Product names stay KO (data untouched); only the chrome translates.
const appRoutes: RouteRecordRaw[] = [
    { path: '/', name: 'home', component: HomeView },
    { path: '/categories', name: 'categories', component: () => import('../views/CategoriesView.vue') },
    { path: '/category/:slug', name: 'category', component: () => import('../views/CategoryView.vue') },
    { path: '/product/:slug', name: 'product', component: () => import('../views/ProductDetailView.vue') },
    { path: '/cart', name: 'cart', component: () => import('../views/CartView.vue') },
    { path: '/checkout', name: 'checkout', component: () => import('../views/CheckoutView.vue'), meta: { requiresAuth: true } },
    { path: '/profile', name: 'profile', redirect: '/my/settings' },
    { path: '/my', name: 'my', component: () => import('../views/my/MyHomeView.vue'), meta: { requiresAuth: true } },
    { path: '/my/reviews', name: 'my-reviews', component: () => import('../views/my/MyReviewsView.vue'), meta: { requiresAuth: true } },
    { path: '/my/qna', name: 'my-qna', component: () => import('../views/my/MyQnaView.vue'), meta: { requiresAuth: true } },
    { path: '/my/recent', name: 'my-recent', component: () => import('../views/my/RecentlyViewedView.vue'), meta: { requiresAuth: true } },
    { path: '/my/credits', name: 'my-credits', component: () => import('../views/my/CreditsView.vue'), meta: { requiresAuth: true } },
    { path: '/my/stores', name: 'my-stores', component: () => import('../views/my/FollowedStoresView.vue'), meta: { requiresAuth: true } },
    { path: '/my/settings', name: 'my-settings', component: () => import('../views/ProfileView.vue'), meta: { requiresAuth: true } },
    { path: '/orders', name: 'orders', component: () => import('../views/OrdersView.vue'), meta: { requiresAuth: true } },
    { path: '/orders/:id', name: 'order-detail', component: () => import('../views/OrderDetailView.vue'), meta: { requiresAuth: true } },
    { path: '/search', name: 'search', component: () => import('../views/SearchView.vue') },
    { path: '/login', name: 'login', component: () => import('../views/LoginView.vue') },
    { path: '/forgot-password', name: 'forgot-password', component: () => import('../views/ForgotPasswordView.vue') },
    { path: '/verify-email', name: 'verify-email', component: () => import('../views/VerifyEmailView.vue') },
    { path: '/register', name: 'register', component: () => import('../views/RegisterView.vue') },
    { path: '/channel/lightning-deals', name: 'lightning-deals', component: () => import('../views/LightningDealsView.vue') },
    { path: '/channel/best-sellers', name: 'best-sellers', component: () => import('../views/BestSellersView.vue') },
    { path: '/coupons', name: 'coupons', component: () => import('../views/CouponsView.vue'), meta: { requiresAuth: true } },
    { path: '/addresses', name: 'addresses', component: () => import('../views/AddressesView.vue'), meta: { requiresAuth: true } },
    { path: '/wishlist', name: 'wishlist', component: () => import('../views/WishlistView.vue'), meta: { requiresAuth: true } },
    { path: '/store/:id', name: 'seller-store', component: () => import('../views/SellerStoreView.vue') },
    { path: '/support', name: 'support', component: () => import('../views/SupportView.vue'), meta: { requiresAuth: true } },
    { path: '/policy/:type', name: 'policy', component: () => import('../views/PolicyView.vue') },
    { path: '/legal/terms', name: 'legal-terms', component: () => import('../views/LegalTermsView.vue') },
    { path: '/legal/privacy', name: 'legal-privacy', component: () => import('../views/LegalPrivacyView.vue') },
    { path: '/payments/success', name: 'payment-success', component: () => import('../views/PaymentResultView.vue'), meta: { requiresAuth: true } },
    { path: '/payments/fail', name: 'payment-fail', component: () => import('../views/PaymentResultView.vue'), meta: { requiresAuth: true } },
    { path: '/legal/refund', name: 'legal-refund', component: () => import('../views/LegalRefundView.vue') }
]

const notFoundRoute: RouteRecordRaw =
  { path: '/:pathMatch(.*)*', name: 'not-found', component: () => import('../views/NotFoundView.vue') }

const localeRoutes: RouteRecordRaw[] = []
for (const prefix of ['en', 'ja']) {
  for (const r of appRoutes) {
    const base = String(r.path)
    const mirrored = {
      ...r,
      path: base === '/' ? `/${prefix}` : `/${prefix}${base}`,
      name: r.name ? `${String(r.name)}-${prefix}` : undefined,
      // '/profile' redirects to a fixed path; keep it bare (ko) under mirrors too.
      ...(base === '/profile' ? { redirect: '/my/settings' } : {})
    } as RouteRecordRaw
    localeRoutes.push(mirrored)
  }
}

const router = createRouter({
  history: createWebHistory((import.meta as any).env?.BASE_URL || '/'),
  scrollBehavior() {
    return { top: 0 }
  },
  routes: [...appRoutes, ...localeRoutes, notFoundRoute]
})

export default router
