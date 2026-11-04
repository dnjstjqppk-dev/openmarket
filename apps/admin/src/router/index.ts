import { createRouter, createWebHistory } from 'vue-router';
import LoginView from '../views/LoginView.vue';
import DashboardView from '../views/DashboardView.vue';
import PartnerVerifyView from '../views/PartnerVerifyView.vue';
import ProductManageView from '../views/ProductManageView.vue';
import LedgerAuditView from '../views/LedgerAuditView.vue';
import MarketingView from '../views/MarketingView.vue';
import CategoriesView from '../views/CategoriesView.vue';
import CouponsView from '../views/CouponsView.vue';
import ReviewsView from '../views/ReviewsView.vue';
import OrdersView from '../views/OrdersView.vue';
import UsersView from '../views/UsersView.vue';
import BusinessEntitiesView from '../views/BusinessEntitiesView.vue';
import SuppliersView from '../views/SuppliersView.vue';
import ReconciliationView from '../views/ReconciliationView.vue';

const routes = [
  { path: '/login', name: 'login', component: LoginView },
  { path: '/', name: 'dashboard', component: DashboardView },
  { path: '/products', name: 'products', component: ProductManageView },
  { path: '/partners', name: 'partners', component: PartnerVerifyView },
  { path: '/ledger', name: 'ledger', component: LedgerAuditView },
  { path: '/orders', name: 'orders', component: OrdersView },
  { path: '/users', name: 'users', component: UsersView },
  { path: '/reviews', name: 'reviews', component: ReviewsView },
  { path: '/coupons', name: 'coupons', component: CouponsView },
  { path: '/categories', name: 'categories', component: CategoriesView },
  { path: '/marketing', name: 'marketing', component: MarketingView },
  { path: '/business', name: 'business', component: BusinessEntitiesView },
  { path: '/suppliers', name: 'suppliers', component: SuppliersView },
  { path: '/reconciliation', name: 'reconciliation', component: ReconciliationView }
];

const router = createRouter({
  history: createWebHistory(),
  routes
});

// Auth guard lives in main.ts (checks the JWT stored by LoginView).

export default router;
