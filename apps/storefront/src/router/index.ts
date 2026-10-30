import { createRouter, createWebHistory } from 'vue-router'
import HomeView from '../views/HomeView.vue'

const router = createRouter({
  history: createWebHistory((import.meta as any).env?.BASE_URL || '/'),
  scrollBehavior() {
    return { top: 0 }
  },
  routes: [
    { path: '/', name: 'home', component: HomeView },
    { path: '/categories', name: 'categories', component: () => import('../views/CategoriesView.vue') },
    { path: '/category/:slug', name: 'category', component: () => import('../views/CategoryView.vue') },
    { path: '/product/:slug', name: 'product', component: () => import('../views/ProductDetailView.vue') },
    { path: '/cart', name: 'cart', component: () => import('../views/CartView.vue') },
    { path: '/checkout', name: 'checkout', component: () => import('../views/CheckoutView.vue') },
    { path: '/profile', name: 'profile', component: () => import('../views/ProfileView.vue') },
    { path: '/orders', name: 'orders', component: () => import('../views/OrdersView.vue') },
    { path: '/orders/:id', name: 'order-detail', component: () => import('../views/OrderDetailView.vue') },
    { path: '/search', name: 'search', component: () => import('../views/SearchView.vue') },
    { path: '/login', name: 'login', component: () => import('../views/LoginView.vue') },
    { path: '/forgot-password', name: 'forgot-password', component: () => import('../views/ForgotPasswordView.vue') },
    { path: '/register', name: 'register', component: () => import('../views/RegisterView.vue') },
    { path: '/channel/lightning-deals', name: 'lightning-deals', component: () => import('../views/LightningDealsView.vue') },
    { path: '/channel/best-sellers', name: 'best-sellers', component: () => import('../views/BestSellersView.vue') },
    { path: '/coupons', name: 'coupons', component: () => import('../views/CouponsView.vue') },
    { path: '/addresses', name: 'addresses', component: () => import('../views/AddressesView.vue') },
    { path: '/wishlist', name: 'wishlist', component: () => import('../views/WishlistView.vue') },
    { path: '/store/:id', name: 'seller-store', component: () => import('../views/SellerStoreView.vue') },
    { path: '/support', name: 'support', component: () => import('../views/SupportView.vue') },
    { path: '/policy/:type', name: 'policy', component: () => import('../views/PolicyView.vue') },
    { path: '/legal/terms', name: 'legal-terms', component: () => import('../views/LegalTermsView.vue') },
    { path: '/legal/privacy', name: 'legal-privacy', component: () => import('../views/LegalPrivacyView.vue') },
    { path: '/legal/refund', name: 'legal-refund', component: () => import('../views/LegalRefundView.vue') }
  ]
})

export default router
