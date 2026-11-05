import { createRouter, createWebHistory } from 'vue-router';
import LoginView from '../views/LoginView.vue';
import DashboardView from '../views/DashboardView.vue';
import ProductManageView from '../views/ProductManageView.vue';
import BulkUploadView from '../views/BulkUploadView.vue';
import ShipmentView from '../views/ShipmentView.vue';
import SettlementView from '../views/SettlementView.vue';
import QnaManageView from '../views/QnaManageView.vue';
import ProfileManageView from '../views/ProfileManageView.vue';
import ReturnsManageView from '../views/ReturnsManageView.vue';
import ApplyView from '../views/ApplyView.vue';
import ApplicationView from '../views/ApplicationView.vue';
import { getPartnerStatus } from '../config';

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
      component: ProductManageView,
      meta: { requiresAuth: true }
    },
    {
      path: '/bulk-upload',
      name: 'bulk-upload',
      component: BulkUploadView,
      meta: { requiresAuth: true }
    },
    {
      path: '/shipments',
      name: 'shipments',
      component: ShipmentView,
      meta: { requiresAuth: true }
    },
    {
      path: '/returns',
      name: 'returns',
      component: ReturnsManageView,
      meta: { requiresAuth: true }
    },
    {
      path: '/settlements',
      name: 'settlements',
      component: SettlementView,
      meta: { requiresAuth: true }
    },
    {
      path: '/qna',
      name: 'qna',
      component: QnaManageView,
      meta: { requiresAuth: true }
    },
    {
      path: '/profile',
      name: 'profile',
      component: ProfileManageView,
      meta: { requiresAuth: true }
    }
  ]
});

router.beforeEach((to, _from, next) => {
  const token = localStorage.getItem('partner_token');
  if (to.meta.requiresAuth && !token) {
    next({ path: '/login', query: { redirect: to.fullPath } });
  } else if (to.meta.requiresAuth && !to.meta.applicant && getPartnerStatus() && getPartnerStatus() !== 'APPROVED') {
    // Sellers under review only see their application.
    next({ path: '/application' });
  } else {
    next();
  }
});

export default router;
