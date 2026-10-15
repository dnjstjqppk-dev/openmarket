import { createRouter, createWebHistory } from 'vue-router';
import LoginView from '../views/LoginView.vue';
import DashboardView from '../views/DashboardView.vue';
import ProductManageView from '../views/ProductManageView.vue';
import BulkUploadView from '../views/BulkUploadView.vue';
import ShipmentView from '../views/ShipmentView.vue';
import SettlementView from '../views/SettlementView.vue';

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/login',
      name: 'login',
      component: LoginView
    },
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
      path: '/settlements',
      name: 'settlements',
      component: SettlementView,
      meta: { requiresAuth: true }
    }
  ]
});

router.beforeEach((to, _from, next) => {
  const token = localStorage.getItem('partner_token');
  if (to.meta.requiresAuth && !token) {
    next('/login');
  } else {
    next();
  }
});

export default router;
