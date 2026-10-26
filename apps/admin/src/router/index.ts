import { createRouter, createWebHistory } from 'vue-router';
import LoginView from '../views/LoginView.vue';
import DashboardView from '../views/DashboardView.vue';
import PartnerVerifyView from '../views/PartnerVerifyView.vue';
import ProductManageView from '../views/ProductManageView.vue';
import LedgerAuditView from '../views/LedgerAuditView.vue';
import MarketingView from '../views/MarketingView.vue';

const routes = [
  { path: '/login', name: 'login', component: LoginView },
  { path: '/', name: 'dashboard', component: DashboardView },
  { path: '/products', name: 'products', component: ProductManageView },
  { path: '/partners', name: 'partners', component: PartnerVerifyView },
  { path: '/ledger', name: 'ledger', component: LedgerAuditView },
  { path: '/marketing', name: 'marketing', component: MarketingView }
];

const router = createRouter({
  history: createWebHistory(),
  routes
});

router.beforeEach((to, from, next) => {
  const isAuthenticated = localStorage.getItem('admin_token');
  if (to.name !== 'login' && !isAuthenticated) {
    next({ name: 'login' });
  } else {
    next();
  }
});

export default router;
