import { createRouter, createWebHistory } from 'vue-router';
import LoginView from '../views/LoginView.vue';
import DashboardView from '../views/DashboardView.vue';
import BulkUploadView from '../views/BulkUploadView.vue';
import ShipmentView from '../views/ShipmentView.vue';
import QnaManageView from '../views/QnaManageView.vue';
import ProfileManageView from '../views/ProfileManageView.vue';
import BiddingView from '../views/BiddingView.vue';
import UrlImportView from '../views/UrlImportView.vue';
import MultiChannelListingView from '../views/MultiChannelListingView.vue';
import ApplyView from '../views/ApplyView.vue';
import ApplicationView from '../views/ApplicationView.vue';
import NotFoundView from '../views/NotFoundView.vue';
import { getPartnerStatus, ensurePartnerSession } from '../config';

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/login',
      name: 'login',
      component: LoginView
    },
    { path: '/apply', name: 'apply', component: ApplyView },
    { path: '/application', name: 'application', component: ApplicationView, meta: { requiresAuth: true, applicant: true } },
    {
      path: '/',
      name: 'dashboard',
      component: DashboardView,
      meta: { requiresAuth: true }
    },
    {
      path: '/products',
      name: 'products',
      component: () => import('../views/products/ProductListView.vue'),
      meta: { requiresAuth: true }
    },
    {
      path: '/products/new',
      name: 'products-new',
      component: () => import('../views/products/ProductEditView.vue'),
      meta: { requiresAuth: true }
    },
    {
      path: '/products/:id/edit',
      name: 'products-edit',
      component: () => import('../views/products/ProductEditView.vue'),
      meta: { requiresAuth: true }
    },
    {
      path: '/bidding',
      name: 'bidding',
      component: BiddingView,
      meta: { requiresAuth: true }
    },
    {
      path: '/bulk-upload',
      name: 'bulk-upload',
      component: BulkUploadView,
      meta: { requiresAuth: true }
    },
    {
      path: '/imports',
      name: 'imports',
      component: UrlImportView,
      meta: { requiresAuth: true }
    },
    {
      path: '/channels',
      name: 'channels',
      component: MultiChannelListingView,
      meta: { requiresAuth: true }
    },
    {
      path: '/promotions/coupons',
      name: 'promotions-coupons',
      component: () => import('../views/promotions/CouponListView.vue'),
      meta: { requiresAuth: true }
    },
    {
      path: '/promotions/flash-sales',
      name: 'promotions-flash-sales',
      component: () => import('../views/promotions/FlashSaleApplyView.vue'),
      meta: { requiresAuth: true }
    },
    {
      path: '/promotions/exhibitions',
      name: 'promotions-exhibitions',
      component: () => import('../views/promotions/ExhibitionApplyView.vue'),
      meta: { requiresAuth: true }
    },
    {
      path: '/shipments',
      name: 'shipments',
      component: ShipmentView,
      meta: { requiresAuth: true }
    },
    { path: '/returns', redirect: '/claims/return' },
    {
      path: '/claims/cancel',
      name: 'claims-cancel',
      component: () => import('../views/claims/CancelListView.vue'),
      meta: { requiresAuth: true }
    },
    {
      path: '/claims/return',
      name: 'claims-return',
      component: () => import('../views/claims/ReturnListView.vue'),
      meta: { requiresAuth: true }
    },
    {
      path: '/claims/exchange',
      name: 'claims-exchange',
      component: () => import('../views/claims/ExchangeListView.vue'),
      meta: { requiresAuth: true }
    },
    {
      path: '/settlements',
      name: 'settlements',
      component: () => import('../views/settlements/SettlementOverviewView.vue'),
      meta: { requiresAuth: true }
    },
    {
      path: '/settlements/deposits',
      name: 'settlements-deposits',
      component: () => import('../views/settlements/WithdrawableDepositsView.vue'),
      meta: { requiresAuth: true }
    },
    {
      path: '/qna',
      name: 'qna',
      component: QnaManageView,
      meta: { requiresAuth: true }
    },
    {
      path: '/reviews',
      name: 'reviews',
      component: () => import('../views/ReviewManageView.vue'),
      meta: { requiresAuth: true }
    },
    {
      path: '/profile',
      name: 'profile',
      component: ProfileManageView,
      meta: { requiresAuth: true }
    },
    {
      path: '/store-profile',
      name: 'store-profile',
      component: () => import('../views/StoreProfileView.vue'),
      meta: { requiresAuth: true }
    },
    {
      path: '/store/shipping-policies',
      name: 'store-shipping-policies',
      component: () => import('../views/ShippingPolicyView.vue'),
      meta: { requiresAuth: true }
    },
    {
      path: '/:pathMatch(.*)*',
      name: 'not-found',
      component: NotFoundView
    }
  ]
});

router.beforeEach(async (to, _from, next) => {
  // P0-2: the session is memory-only; restore it from the cookie on entry.
  if (to.meta.requiresAuth && !(await ensurePartnerSession())) {
    next({ path: '/login', query: { redirect: to.fullPath } });
  } else if (to.meta.requiresAuth && !to.meta.applicant && getPartnerStatus() !== 'APPROVED') {
    // P2-T02: unknown/empty status also routes to the application (the API
    // enforces approval per call; this is only the routing hint).
    next({ path: '/application' });
  } else {
    next();
  }
});

export default router;
