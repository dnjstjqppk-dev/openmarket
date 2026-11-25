import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { requireBuildEnv } from '../../scripts/vite-require-env.mjs';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [vue(), requireBuildEnv(['VITE_API_BASE_URL', 'VITE_STOREFRONT_URL'])],
  server: {
    port: 5175
  },
  build: {
    outDir: 'dist'
  }
});

