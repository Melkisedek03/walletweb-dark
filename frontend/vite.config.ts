import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import wasm from 'vite-plugin-wasm';
import topLevelAwait from 'vite-plugin-top-level-await';

export default defineConfig({
  plugins: [react(), wasm(), topLevelAwait()],
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
