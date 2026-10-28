import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import wasm from 'vite-plugin-wasm';
import { nodePolyfills } from 'vite-plugin-node-polyfills';

// base './' so the site works from any GitHub Pages sub-path (https://user.github.io/repo/)
// Mesh was written for Node and uses crypto/stream/buffer, so the browser build needs polyfills for them.
export default defineConfig({
  base: './',
  plugins: [
    react(),
    wasm(),
    nodePolyfills({ include: ['crypto', 'stream', 'buffer', 'util', 'process', 'events', 'vm'], globals: { Buffer: true, process: true, global: true } }),
  ],
  build: { target: 'es2022', chunkSizeWarningLimit: 8000 },
});
