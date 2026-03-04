import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { resetConfigCacheForTests } from '@/src/config/opengram-config';
import { app } from '@/src/server';

const TEST_CONFIG = {
  appName: 'OpenGram',
  maxUploadBytes: 50_000_000,
  allowedMimeTypes: ['*/*'],
  titleMaxChars: 48,
  agents: [{ id: 'agent-default', name: 'Test Agent', description: 'test', defaultModelId: 'model-default' }],
  models: [{ id: 'model-default', name: 'Test Model', description: 'test' }],
  push: { enabled: false, vapidPublicKey: '', vapidPrivateKey: '', subject: '' },
  security: {
    instanceSecretEnabled: true,
    instanceSecret: 'fresh-secret',
    readEndpointsRequireInstanceSecret: false,
  },
  server: { publicBaseUrl: 'http://localhost:3333', port: 3333, streamTimeoutSeconds: 60, corsOrigins: [] },
  hooks: [],
};

let previousConfigPath: string | undefined;

beforeEach(() => {
  previousConfigPath = process.env.OPENGRAM_CONFIG_PATH;

  const tempDir = mkdtempSync(join(tmpdir(), 'opengram-bootstrap-'));
  const configPath = join(tempDir, 'opengram.config.json');
  writeFileSync(configPath, JSON.stringify(TEST_CONFIG), 'utf8');
  process.env.OPENGRAM_CONFIG_PATH = configPath;

  resetConfigCacheForTests();
});

afterEach(() => {
  if (previousConfigPath === undefined) {
    delete process.env.OPENGRAM_CONFIG_PATH;
  } else {
    process.env.OPENGRAM_CONFIG_PATH = previousConfigPath;
  }
  resetConfigCacheForTests();
});

describe('SPA bootstrap injection', () => {
  it('injects runtime bootstrap and no-store cache policy on root path', async () => {
    const response = await app.request('/');
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(html).toContain('window.__OPENGRAM_BOOTSTRAP__');
    expect(html).toContain('"instanceSecret":"fresh-secret"');
  });

  it('injects runtime bootstrap and no-store cache policy on /index.html', async () => {
    const response = await app.request('/index.html');
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(html).toContain('window.__OPENGRAM_BOOTSTRAP__');
    expect(html).toContain('"instanceSecret":"fresh-secret"');
  });
});
