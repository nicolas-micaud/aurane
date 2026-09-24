import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import preact from '@preact/preset-vite';

/** Writes dist/sw.js from sw.src.js with the built shell precached and a version derived from it. */
function serviceWorker(): Plugin {
  let outDir = 'dist';
  return {
    name: 'aurane-sw',
    apply: 'build',
    configResolved(cfg) { outDir = cfg.build.outDir; },
    closeBundle() {
      const dist = resolve(outDir);
      const assets = readdirSync(resolve(dist, 'assets')).filter((f) => /\.(js|css|woff2?)$/.test(f)).map((f) => `/assets/${f}`);
      const shell = ['/', '/index.html', '/manifest.webmanifest', '/icon.svg', '/icon-192.png', '/icon-512.png', ...assets];
      const version = createHash('sha1').update(shell.join('\n') + readFileSync(resolve(dist, 'index.html'), 'utf8')).digest('hex').slice(0, 10);
      const src = readFileSync(resolve('sw.src.js'), 'utf8').replace("const VERSION = '__VERSION__';", `const VERSION = '${version}';`).replace('const PRECACHE = __PRECACHE__;', `const PRECACHE = ${JSON.stringify(shell)};`);
      writeFileSync(resolve(dist, 'sw.js'), src);
    },
  };
}

export default defineConfig({
  plugins: [preact(), serviceWorker()],
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
  preview: {
    port: 4173,
    proxy: {
      '/api': 'http://127.0.0.1:8080',
      '/healthz': 'http://127.0.0.1:8080',
      '/ws': { target: 'ws://127.0.0.1:8080', ws: true },
    },
  },
  build: { outDir: 'dist', sourcemap: true, target: 'es2022' },
});
