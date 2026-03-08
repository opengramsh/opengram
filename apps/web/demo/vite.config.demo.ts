import path from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const ROOT = path.resolve(__dirname);
const PROJECT_ROOT = path.resolve(__dirname, '..');

export default defineConfig({
  plugins: [react()],
  base: '/',
  root: ROOT,
  publicDir: path.resolve(PROJECT_ROOT, 'public'),
  resolve: {
    alias: [
      // Mock overrides — MUST come before the generic '@' alias so they
      // match first during resolution.
      {
        find: '@/src/lib/api-fetch',
        replacement: path.resolve(ROOT, 'lib/mock-api-fetch'),
      },
      {
        find: '@/src/lib/events-stream',
        replacement: path.resolve(ROOT, 'lib/mock-events-stream'),
      },
      // Generic aliases
      { find: '@', replacement: PROJECT_ROOT },
      { find: /^shiki$/, replacement: 'shiki/bundle/web' },
    ],
  },
  build: {
    outDir: path.resolve(PROJECT_ROOT, 'dist/demo'),
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-react': ['react', 'react-dom', 'react-router'],
          'vendor-streamdown': ['streamdown', '@streamdown/cjk', '@streamdown/code'],
          'vendor-katex': ['@streamdown/math'],
          'vendor-mermaid': ['@streamdown/mermaid'],
          'vendor-shiki': ['shiki/bundle/web'],
        },
      },
    },
  },
});
