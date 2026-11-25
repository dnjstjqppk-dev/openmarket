import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { requireBuildEnv } from '../../scripts/vite-require-env.mjs';

export default defineConfig({
  plugins: [vue(), requireBuildEnv(['VITE_API_BASE_URL', 'VITE_PARTNER_URL', 'VITE_ADMIN_URL'])],
  build: {
    outDir: 'dist',
    emptyOutDir: true
  }
});
