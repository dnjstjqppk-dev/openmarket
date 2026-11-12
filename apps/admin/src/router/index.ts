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
import SupplierIntegrationView from '../views/SupplierIntegrationView.vue';
import ReconciliationView from '../views/ReconciliationView.vue';
import PartnerApplicationsView from '../views/PartnerApplicationsView.vue';
import SecurityView from '../views/SecurityView.vue';
import AuditLogView from '../views/AuditLogView.vue';
import InquiriesView from '../views/InquiriesView.vue';
import ShippingZonesView from '../views/ShippingZonesView.vue';
import NotFoundView from '../views/NotFoundView.vue';

// P1-A01: client-side route roles mirror the server ROLE_PERMISSIONS read side
// (gateway lib/admin-policy.js). The server still denies every unauthorized API
// call; this keeps operators from opening screens that can only render denied.
const ALL = ['SUPER_ADMIN', 'FINANCE', 'OPERATIONS', 'CS', 'PRIVACY_OFFICER'];

const routes = [
  { path: '/login', name: 'login', component: LoginView },
  { path: '/', name: 'dashboard', component: DashboardView, meta: { roles: ALL } },
  { path: '/products', name: 'products', component: ProductManageView, meta: { roles: ['SUPER_ADMIN', 'OPERATIONS', 'CS'] } },
  { path: '/partners', name: 'partners', component: PartnerVerifyView, meta: { roles: ['SUPER_ADMIN', 'FINANCE', 'OPERATIONS'] } },
  { path: '/ledger', name: 'ledger', component: LedgerAuditView, meta: { roles: ['SUPER_ADMIN', 'FINANCE'] } },
  { path: '/orders', name: 'orders', component: OrdersView, meta: { roles: ['SUPER_ADMIN', 'FINANCE', 'OPERATIONS', 'CS'] } },
  { path: '/users', name: 'users', component: UsersView, meta: { roles: ['SUPER_ADMIN', 'CS', 'PRIVACY_OFFICER'] } },
  { path: '/reviews', name: 'reviews', component: ReviewsView, meta: { roles: ['SUPER_ADMIN', 'OPERATIONS', 'CS'] } },
  { path: '/coupons', name: 'coupons', component: CouponsView, meta: { roles: ['SUPER_ADMIN', 'OPERATIONS'] } },
  { path: '/categories', name: 'categories', component: CategoriesView, meta: { roles: ['SUPER_ADMIN', 'OPERATIONS', 'CS'] } },
  { path: '/marketing', name: 'marketing', component: MarketingView, meta: { roles: ['SUPER_ADMIN', 'OPERATIONS'] } },
  { path: '/business', name: 'business', component: BusinessEntitiesView, meta: { roles: ['SUPER_ADMIN', 'FINANCE', 'OPERATIONS'] } },
  { path: '/suppliers', name: 'suppliers', component: SuppliersView, meta: { roles: ['SUPER_ADMIN', 'OPERATIONS'] } },
  { path: '/supplier-integrations', name: 'supplier-integrations', component: SupplierIntegrationView, meta: { roles: ['SUPER_ADMIN', 'OPERATIONS'] } },
  { path: '/reconciliation', name: 'reconciliation', component: ReconciliationView, meta: { roles: ['SUPER_ADMIN', 'FINANCE'] } },
  { path: '/partner-applications', name: 'partner-applications', component: PartnerApplicationsView, meta: { roles: ['SUPER_ADMIN', 'FINANCE', 'OPERATIONS'] } },
  { path: '/security', name: 'security', component: SecurityView, meta: { roles: ALL } },
  { path: '/audit-log', name: 'audit-log', component: AuditLogView, meta: { roles: ['SUPER_ADMIN', 'PRIVACY_OFFICER'] } },
  { path: '/inquiries', name: 'inquiries', component: InquiriesView, meta: { roles: ['SUPER_ADMIN', 'OPERATIONS', 'CS'] } },
  { path: '/shipping-zones', name: 'shipping-zones', component: ShippingZonesView, meta: { roles: ['SUPER_ADMIN', 'OPERATIONS'] } },
  { path: '/:pathMatch(.*)*', name: 'not-found', component: NotFoundView }
];

const router = createRouter({
  history: createWebHistory(),
  routes
});

// Auth guard lives in main.ts (checks the JWT stored by LoginView).

export default router;
