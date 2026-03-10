// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';

const STORAGE_KEY = 'opengram.instanceSecret';

function setBootstrap(value: string | null | undefined) {
  const w = window as typeof window & {
    __OPENGRAM_BOOTSTRAP__?: { instanceSecret?: string | null };
  };

  if (value === undefined) {
    delete w.__OPENGRAM_BOOTSTRAP__;
    return;
  }

  w.__OPENGRAM_BOOTSTRAP__ = { instanceSecret: value };
}

async function loadApiFetch() {
  vi.resetModules();
  return import('@/src/lib/api-fetch');
}

describe('api secret bootstrap resolution', () => {
  beforeEach(() => {
    localStorage.clear();
    setBootstrap(undefined);
  });

  it('falls back to localStorage when bootstrap is absent', async () => {
    localStorage.setItem(STORAGE_KEY, 'stored-secret');
    const { getApiSecret } = await loadApiFetch();

    expect(getApiSecret()).toBe('stored-secret');
  });

  it('prefers bootstrap secret and synchronizes localStorage', async () => {
    localStorage.setItem(STORAGE_KEY, 'old-secret');
    setBootstrap('fresh-secret');

    const { getApiSecret } = await loadApiFetch();

    expect(getApiSecret()).toBe('fresh-secret');
    expect(localStorage.getItem(STORAGE_KEY)).toBe('fresh-secret');
  });

  it('treats bootstrap null as authoritative and clears stale localStorage', async () => {
    localStorage.setItem(STORAGE_KEY, 'very-old-secret');
    setBootstrap(null);

    const { getApiSecret } = await loadApiFetch();

    expect(getApiSecret()).toBeNull();
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });
});
