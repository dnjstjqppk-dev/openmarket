import { createRouter, createWebHistory } from 'vue-router';
import HomeView from '../views/HomeView.vue';
import CategoryView from '../views/CategoryView.vue';
import CategoriesView from '../views/CategoriesView.vue';
import CheckoutView from '../views/CheckoutView.vue';
import OrdersView from '../views/OrdersView.vue';

const routes = [
  { path: '/', name: 'home', component: HomeView },
  { path: '/categories', name: 'categories', component: CategoriesView },
  { path: '/category/:slug', name: 'category', component: CategoryView },
  { path: '/categories/:slug', redirect: (to: { params: { slug: string } }) => `/category/${to.params.slug}` },
  { path: '/checkout', name: 'checkout', component: CheckoutView },
  { path: '/orders', name: 'orders', component: OrdersView },
  { path: '/:pathMatch(.*)*', redirect: '/' }
];

const router = createRouter({
  history: createWebHistory(),
  routes,
  scrollBehavior() {
    return { top: 0 };
  }
});

export default router;
