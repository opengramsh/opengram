// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { downloadFile } from '@/app/chats/[chatId]/_lib/download-file';

describe('downloadFile iOS return behavior', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
  });

  it('runs beforeOpen callback before triggering the anchor click', async () => {
    const order: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new Blob(['abc']), { status: 200 })));
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: vi.fn(() => 'blob:test-1'),
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: vi.fn(),
    });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {
      order.push('click');
    });

    await downloadFile('/api/v1/files/file-1', 'report.pdf', {
      beforeOpen: () => {
        order.push('before');
      },
    });

    expect(order).toEqual(['before', 'click']);
  });

  it('uses blob URL flow by default and revokes object URL later', async () => {
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    const createObjectURLMock = vi.fn();
    const revokeObjectURLMock = vi.fn();
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: createObjectURLMock,
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: revokeObjectURLMock,
    });
    const fetchMock = vi.fn(async () => new Response(new Blob(['hello']), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await downloadFile('/api/v1/files/file-1', 'report.pdf');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(createObjectURLMock).toHaveBeenCalledTimes(1);
    const link = document.body.querySelector('a') as HTMLAnchorElement | null;
    expect(link?.download).toBe('report.pdf');

    vi.advanceTimersByTime(60_000);
    expect(revokeObjectURLMock).toHaveBeenCalledTimes(1);
  });

  it('supports explicit direct-open mode via forceNewContext', async () => {
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const fetchMock = vi.fn(async () => new Response(new Blob(['hello']), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await downloadFile('/api/v1/files/file-1', 'report.pdf', { forceNewContext: true });

    expect(fetchMock).not.toHaveBeenCalled();
    const link = document.body.querySelector('a') as HTMLAnchorElement | null;
    expect(link?.target).toBe('_blank');
    expect(link?.download).toBe('');
  });
});
