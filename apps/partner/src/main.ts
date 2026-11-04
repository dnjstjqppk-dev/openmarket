import { createApp } from 'vue';
import { createPinia } from 'pinia';
import App from './App.vue';
import router from './router';

const app = createApp(App);
app.use(createPinia());
app.use(router);
import { API_BASE_URL, clearPartnerSession } from './config';
const nativeFetch = window.fetch.bind(window);
window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const res = await nativeFetch(input, init);
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  if (res.status === 401 && url.startsWith(API_BASE_URL) && !url.includes('/auth/login')) {
    clearPartnerSession();
    router.push({ path: '/login', query: { expired: '1' } });
  }
  return res;
};
app.mount('#app');

