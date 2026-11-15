import { createRouter, createWebHistory } from 'vue-router';
import LoginView from '../views/LoginView.vue';
import DashboardView from '../views/DashboardView.vue';
import PartnerListView from '../views/partners/PartnerListView.vue';
import PartnerDetailView from '../views/partners/PartnerDetailView.vue';
import PenaltyGradeView from '../views/partners/PenaltyGradeView.vue';
import ProductListView from '../views/products/ProductListView.vue';
import ReviewQueueView from '../views/products/ReviewQueueView.vue';
import LedgerAuditView from '../views/LedgerAuditView.vue';
import BannerView from '../views/marketing/BannerView.vue';
import ExhibitionView from '../views/marketing/ExhibitionView.vue';
import FlashSaleView from '../views/marketing/FlashSaleView.vue';
import NotificationSendView from '../views/marketing/NotificationSendView.vue';
import CategoriesView from '../views/CategoriesView.vue';
import CouponsView from '../views/CouponsView.vue';
import ReviewsView from '../views/ReviewsView.vue';
import OrderListView from '../views/orders/OrderListView.vue';
import OrderDetailView from '../views/orders/OrderDetailView.vue';
import ClaimListView from '../views/claims/ClaimListView.vue';
import UsersView from '../views/UsersView.vue';
import BusinessEntitiesView from '../views/BusinessEntitiesView.vue';
import SuppliersView from '../views/SuppliersView.vue';
import SupplierIntegrationView from '../views/SupplierIntegrationView.vue';
import FinanceReconciliationView from '../views/finance/ReconciliationView.vue';
import SettlementBatchView from '../views/finance/SettlementBatchView.vue';
import PayoutApprovalView from '../views/finance/PayoutApprovalView.vue';
import PolicyView from '../views/finance/PolicyView.vue';
import ApplicationListView from '../views/partners/ApplicationListView.vue';
import ApplicationDetailView from '../views/partners/ApplicationDetailView.vue';
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
  { path: '/products', name: 'products', component: ProductListView, meta: { roles: ['SUPER_ADMIN', 'OPERATIONS', 'CS'] } },
  { path: '/products/review-queue', name: 'products-review-queue', component: ReviewQueueView, meta: { roles: ['SUPER_ADMIN', 'OPERATIONS'] } },
  { path: '/partners', name: 'partners', component: PartnerListView, meta: { roles: ['SUPER_ADMIN', 'FINANCE', 'OPERATIONS'] } },
  { path: '/partners/:id', name: 'partner-detail', component: PartnerDetailView, meta: { roles: ['SUPER_ADMIN', 'FINANCE', 'OPERATIONS'] } },
  { path: '/partners/penalties-grades', name: 'penalties-grades', component: PenaltyGradeView, meta: { roles: ['SUPER_ADMIN', 'OPERATIONS'] } },
  { path: '/ledger', name: 'ledger', component: LedgerAuditView, meta: { roles: ['SUPER_ADMIN', 'FINANCE'] } },
  { path: '/orders', name: 'orders', component: OrderListView, meta: { roles: ['SUPER_ADMIN', 'FINANCE', 'OPERATIONS', 'CS'] } },
  { path: '/orders/:id', name: 'order-detail', component: OrderDetailView, meta: { roles: ['SUPER_ADMIN', 'FINANCE', 'OPERATIONS', 'CS'] } },
  { path: '/claims', name: 'claims', component: ClaimListView, meta: { roles: ['SUPER_ADMIN', 'FINANCE', 'OPERATIONS'] } },
  { path: '/users', name: 'users', component: UsersView, meta: { roles: ['SUPER_ADMIN', 'CS', 'PRIVACY_OFFICER'] } },
  { path: '/reviews', name: 'reviews', component: ReviewsView, meta: { roles: ['SUPER_ADMIN', 'OPERATIONS', 'CS'] } },
  { path: '/coupons', name: 'coupons', component: CouponsView, meta: { roles: ['SUPER_ADMIN', 'OPERATIONS'] } },
  { path: '/categories', name: 'categories', component: CategoriesView, meta: { roles: ['SUPER_ADMIN', 'OPERATIONS', 'CS'] } },
  { path: '/marketing', redirect: '/marketing/banners' },
  { path: '/marketing/banners', name: 'marketing-banners', component: BannerView, meta: { roles: ['SUPER_ADMIN', 'OPERATIONS'] } },
  { path: '/marketing/exhibitions', name: 'marketing-exhibitions', component: ExhibitionView, meta: { roles: ['SUPER_ADMIN', 'OPERATIONS'] } },
  { path: '/marketing/flash-sales', name: 'marketing-flash-sales', component: FlashSaleView, meta: { roles: ['SUPER_ADMIN', 'OPERATIONS'] } },
  { path: '/marketing/notifications', name: 'marketing-notifications', component: NotificationSendView, meta: { roles: ['SUPER_ADMIN', 'OPERATIONS'] } },
  { path: '/business', name: 'business', component: BusinessEntitiesView, meta: { roles: ['SUPER_ADMIN', 'FINANCE', 'OPERATIONS'] } },
  { path: '/suppliers', name: 'suppliers', component: SuppliersView, meta: { roles: ['SUPER_ADMIN', 'OPERATIONS'] } },
  { path: '/supplier-integrations', name: 'supplier-integrations', component: SupplierIntegrationView, meta: { roles: ['SUPER_ADMIN', 'OPERATIONS'] } },
  { path: '/reconciliation', name: 'reconciliation', component: FinanceReconciliationView, meta: { roles: ['SUPER_ADMIN', 'FINANCE'] } },
  { path: '/finance/batches', name: 'finance-batches', component: SettlementBatchView, meta: { roles: ['SUPER_ADMIN', 'FINANCE'] } },
  { path: '/finance/payout-requests', name: 'finance-payout-requests', component: PayoutApprovalView, meta: { roles: ['SUPER_ADMIN', 'FINANCE'] } },
  { path: '/finance/policies', name: 'finance-policies', component: PolicyView, meta: { roles: ['SUPER_ADMIN', 'FINANCE'] } },
  { path: '/partner-applications', name: 'partner-applications', component: ApplicationListView, meta: { roles: ['SUPER_ADMIN', 'FINANCE', 'OPERATIONS'] } },
  { path: '/partner-applications/:id', name: 'partner-application-detail', component: ApplicationDetailView, meta: { roles: ['SUPER_ADMIN', 'FINANCE', 'OPERATIONS'] } },
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
