import 'pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css';
import '@olmoa/ui/styles.css';
import { createApp } from 'vue';
import { createPinia } from 'pinia';
import router from './router';
import App from './App.vue';
import { API_BASE_URL } from './config';
import { useAuthStore } from './stores/auth';

const app = createApp(App);
const pinia = createPinia();
app.use(pinia);
app.use(router);

// Session expiry / revocation: any 401 from our API ends the local session and sends the user to login.
const nativeFetch = window.fetch.bind(window);
window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const res = await nativeFetch(input, init);
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  if (res.status === 401 && url.startsWith(API_BASE_URL) && !url.includes('/api/v1/auth/login')) {
    const auth = useAuthStore(pinia);
    if (auth.isAuthenticated) {
      auth.logout();
      const here = router.currentRoute.value.fullPath;
      router.push({ path: '/login', query: { redirect: here, expired: '1' } });
    }
  }
  return res;
};

router.beforeEach((to) => {
  const auth = useAuthStore(pinia);
  if (to.meta.requiresAuth && !auth.isAuthenticated) {
    return { path: '/login', query: { redirect: to.fullPath } };
  }
  return true;
});

app.mount('#app');
