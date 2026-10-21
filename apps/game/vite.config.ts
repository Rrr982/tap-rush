import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';

export default defineConfig({
  // Facebook serves the bundle from its own CDN, so every asset URL has to be
  // relative to the document.
  base: './',
  // Read `.env.local` from the repository root, so the game and the API share
  // one set of environment values. Only `VITE_` prefixed variables end up in
  // the bundle.
  envDir: fileURLToPath(new URL('../..', import.meta.url)),
  resolve: {
    alias: {
      '@shared': fileURLToPath(new URL('../../shared', import.meta.url)),
    },
  },
  server: {
    fs: {
      allow: ['..'],
    },
  },
  build: {
    target: 'es2020',
    outDir: 'dist',
    assetsDir: 'assets',
    emptyOutDir: true,
    sourcemap: false,
  },
});
