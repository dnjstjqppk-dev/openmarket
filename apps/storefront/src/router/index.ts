import { createRouter, createWebHistory } from 'vue-router';
import HomeView from '../views/HomeView.vue';
import CategoryView from '../views/CategoryView.vue';
import CategoriesView from '../views/CategoriesView.vue';
import ProductDetailView from '../views/ProductDetailView.vue';
import SearchView from '../views/SearchView.vue';
import CartView from '../views/CartView.vue';
import CheckoutView from '../views/CheckoutView.vue';
import OrdersView from '../views/OrdersView.vue';
import OrderDetailView from '../views/OrderDetailView.vue';

const routes = [
  { path: '/', name: 'home', component: HomeView },
  { path: '/categories', name: 'categories', component: CategoriesView },
  { path: '/category/:slug', name: 'category', component: CategoryView },
  { path: '/categories/:slug', redirect: (to: any) => `/category/${to.params.slug}` },
  { path: '/product/:id', name: 'product-detail', component: ProductDetailView },
  { path: '/search', name: 'search', component: SearchView },
  { path: '/cart', name: 'cart', component: CartView },
  { path: '/checkout', name: 'checkout', component: CheckoutView },
  { path: '/orders', name: 'orders', component: OrdersView },
  { path: '/order/:id', name: 'order-detail', component: OrderDetailView },
  { path: '/account/orders', redirect: '/orders' },
  { path: '/:pathMatch(.*)*', redirect: '/' }
];

const router = createRouter({
  history: createWebHistory(),
  routes: routes as any,
  scrollBehavior() {
    return { top: 0 };
  }
});

export default router;
