import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import wasm from 'vite-plugin-wasm';
import topLevelAwait from 'vite-plugin-top-level-await';

// Generates dist/sw.js from sw-template.js at build time, with the
// precache list filled in from this build's actual hashed assets, so
// the service worker always caches the build it ships with. The cache
// name carries a hash of that list, so a new build invalidates the old
// cache. No Workbox or other dependency: the plugin is a few lines on
// top of Vite's own generateBundle hook. Public-dir files are not part
// of the bundle, so they are listed explicitly.
function serviceWorkerPlugin(): Plugin {
  return {
    name: 'nusacoin-sw',
    generateBundle(_options, bundle) {
      const precache = new Set([
        '/',
        '/index.html',
        '/manifest.webmanifest',
        '/favicon.png',
        '/icons/icon-192.png',
        '/icons/icon-512.png',
        '/icons/maskable-512.png',
        '/icons/apple-touch-icon-180.png',
      ]);
      for (const name of Object.keys(bundle)) {
        if (name !== 'sw.js') precache.add(`/${name}`);
      }
      const urls = [...precache].sort();
      const hash = createHash('sha256').update(urls.join('\n')).digest('hex').slice(0, 12);
      const template = readFileSync(new URL('./sw-template.js', import.meta.url), 'utf8');
      const sw = template
        .replaceAll('__CACHE_NAME__', `nux-wallet-${hash}`)
        .replaceAll('__PRECACHE_URLS__', JSON.stringify(urls));
      this.emitFile({ type: 'asset', fileName: 'sw.js', source: sw });
    },
  };
}

export default defineConfig({
  plugins: [react(), wasm(), topLevelAwait(), serviceWorkerPlugin()],
  resolve: {
    alias: {
      buffer: 'buffer/',
    },
  },
  define: {
    'process': JSON.stringify({ env: {}, browser: true, version: '' }),
    global: 'globalThis',
  },
  server: {
    allowedHosts: ['dompet.nusacoin.org', '.nusacoin.org'],
    // Development only. Production serving uses nginx (see nginx/);
    // no Vite process runs at runtime.
    proxy: {
      '/electrs': 'https://apinux.taobot.org',
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    target: 'esnext',
  },
});
