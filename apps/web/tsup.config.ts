import { defineConfig } from 'tsup';

export default defineConfig([
  {
    entry: { server: 'src/server.ts' },
    format: 'esm',
    outDir: 'dist/server',
    target: 'node20',
    clean: true,
  },
  {
    entry: { cli: 'src/cli.ts' },
    format: 'esm',
    outDir: 'dist/cli',
    target: 'node20',
    clean: true,
    banner: { js: '#!/usr/bin/env node' },
  },
]);
