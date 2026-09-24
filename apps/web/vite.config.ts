import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';

export default defineConfig({
  plugins: [preact()],
  resolve: { dedupe: ['preact', 'preact/hooks', '@preact/signals', '@preact/signals-core'] },
  optimizeDeps: { include: ['preact', 'preact/hooks', '@preact/signals', 'pixi.js'] },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://127.0.0.1:8080',
      '/healthz': 'http://127.0.0.1:8080',
      '/ws': { target: 'ws://127.0.0.1:8080', ws: true },
    },
  },
  build: { outDir: 'dist', sourcemap: true, target: 'es2022' },
});
