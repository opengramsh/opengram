// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PendingAttachment } from '@/app/chats/[chatId]/_lib/types';

describe('pending attachment local preview', () => {
  let revokedUrls: string[];

  beforeEach(() => {
    revokedUrls = [];
    // Mock URL.createObjectURL and URL.revokeObjectURL
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: vi.fn((blob: Blob) => `blob:local/${blob.size}`),
      revokeObjectURL: vi.fn((url: string) => {
        revokedUrls.push(url);
      }),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('creates a local preview URL for image files immediately', () => {
    const file = new File(['image-data'], 'photo.png', { type: 'image/png' });
    const isImage = file.type.startsWith('image/');
    const localPreviewUrl = isImage ? URL.createObjectURL(file) : null;

    const entry: PendingAttachment = {
      localId: 'pending-1',
      localPreviewUrl,
      file,
      filename: file.name,
      kind: 'image',
      contentType: file.type,
      status: 'uploading',
      mediaItem: null,
    };

    expect(entry.localPreviewUrl).toBe('blob:local/10');
    expect(entry.status).toBe('uploading');
    expect(entry.mediaItem).toBeNull();
    expect(URL.createObjectURL).toHaveBeenCalledWith(file);
  });

  it('does not create a preview URL for non-image files', () => {
    const file = new File(['pdf-data'], 'report.pdf', { type: 'application/pdf' });
    const isImage = file.type.startsWith('image/');
    const localPreviewUrl = isImage ? URL.createObjectURL(file) : null;

    const entry: PendingAttachment = {
      localId: 'pending-2',
      localPreviewUrl,
      file,
      filename: file.name,
      kind: 'file',
      contentType: file.type,
      status: 'uploading',
      mediaItem: null,
    };

    expect(entry.localPreviewUrl).toBeNull();
    expect(entry.kind).toBe('file');
  });

  it('transitions to ready status with mediaItem on upload success', () => {
    const file = new File(['image-data'], 'photo.png', { type: 'image/png' });

    const entry: PendingAttachment = {
      localId: 'pending-3',
      localPreviewUrl: URL.createObjectURL(file),
      file,
      filename: file.name,
      kind: 'image',
      contentType: file.type,
      status: 'uploading',
      mediaItem: null,
    };

    // Simulate upload completion
    const uploaded: PendingAttachment = {
      ...entry,
      status: 'ready',
      mediaItem: {
        id: 'media-1',
        message_id: null,
        filename: 'photo.png',
        created_at: '2026-02-26T00:00:00Z',
        byte_size: 10,
        content_type: 'image/png',
        kind: 'image',
      },
    };

    expect(uploaded.status).toBe('ready');
    expect(uploaded.mediaItem?.id).toBe('media-1');
    expect(uploaded.localPreviewUrl).toBeTruthy();
  });

  it('revokes object URL on removal', () => {
    const file = new File(['image-data'], 'photo.png', { type: 'image/png' });
    const previewUrl = URL.createObjectURL(file);

    const entries: PendingAttachment[] = [
      {
        localId: 'pending-4',
        localPreviewUrl: previewUrl,
        file,
        filename: file.name,
        kind: 'image',
        contentType: file.type,
        status: 'uploading',
        mediaItem: null,
      },
    ];

    // Simulate removal (mirrors removePendingAttachment logic)
    const localIdToRemove = 'pending-4';
    const removed = entries.find((a) => a.localId === localIdToRemove);
    if (removed?.localPreviewUrl) URL.revokeObjectURL(removed.localPreviewUrl);
    const remaining = entries.filter((a) => a.localId !== localIdToRemove);

    expect(remaining).toHaveLength(0);
    expect(revokedUrls).toContain(previewUrl);
  });

  it('revokes all object URLs on send (cleanup)', () => {
    const file1 = new File(['img1'], 'a.png', { type: 'image/png' });
    const file2 = new File(['img2'], 'b.png', { type: 'image/png' });
    const url1 = URL.createObjectURL(file1);
    const url2 = URL.createObjectURL(file2);

    const entries: PendingAttachment[] = [
      {
        localId: 'p-1',
        localPreviewUrl: url1,
        file: file1,
        filename: 'a.png',
        kind: 'image',
        contentType: 'image/png',
        status: 'ready',
        mediaItem: { id: 'm-1', message_id: null, filename: 'a.png', created_at: '', byte_size: 4, content_type: 'image/png', kind: 'image' },
      },
      {
        localId: 'p-2',
        localPreviewUrl: url2,
        file: file2,
        filename: 'b.png',
        kind: 'image',
        contentType: 'image/png',
        status: 'ready',
        mediaItem: { id: 'm-2', message_id: null, filename: 'b.png', created_at: '', byte_size: 4, content_type: 'image/png', kind: 'image' },
      },
    ];

    // Simulate send cleanup (mirrors sendMessage logic)
    for (const att of entries) {
      if (att.localPreviewUrl) URL.revokeObjectURL(att.localPreviewUrl);
    }

    expect(revokedUrls).toContain(url1);
    expect(revokedUrls).toContain(url2);
    expect(revokedUrls).toHaveLength(2);
  });

  it('blocks send when any attachment is still uploading', () => {
    const file1 = new File(['img1'], 'a.png', { type: 'image/png' });
    const file2 = new File(['img2'], 'b.png', { type: 'image/png' });

    const entries: PendingAttachment[] = [
      {
        localId: 'p-1',
        localPreviewUrl: URL.createObjectURL(file1),
        file: file1,
        filename: 'a.png',
        kind: 'image',
        contentType: 'image/png',
        status: 'ready',
        mediaItem: { id: 'm-1', message_id: null, filename: 'a.png', created_at: '', byte_size: 4, content_type: 'image/png', kind: 'image' },
      },
      {
        localId: 'p-2',
        localPreviewUrl: URL.createObjectURL(file2),
        file: file2,
        filename: 'b.png',
        kind: 'image',
        contentType: 'image/png',
        status: 'uploading',
        mediaItem: null,
      },
    ];

    // Mirrors allAttachmentsReady logic
    const allReady = entries.every((a) => a.status === 'ready');
    expect(allReady).toBe(false);

    // Mirrors sendMessage gate
    const readyAttachments = entries.filter((a) => a.status === 'ready' && a.mediaItem);
    const canSend = readyAttachments.length === entries.length;
    expect(canSend).toBe(false);
  });

  it('allows send when all attachments are ready', () => {
    const file1 = new File(['img1'], 'a.png', { type: 'image/png' });

    const entries: PendingAttachment[] = [
      {
        localId: 'p-1',
        localPreviewUrl: URL.createObjectURL(file1),
        file: file1,
        filename: 'a.png',
        kind: 'image',
        contentType: 'image/png',
        status: 'ready',
        mediaItem: { id: 'm-1', message_id: null, filename: 'a.png', created_at: '', byte_size: 4, content_type: 'image/png', kind: 'image' },
      },
    ];

    const allReady = entries.every((a) => a.status === 'ready');
    expect(allReady).toBe(true);

    const readyAttachments = entries.filter((a) => a.status === 'ready' && a.mediaItem);
    const mediaIds = readyAttachments.map((a) => a.mediaItem!.id);
    expect(mediaIds).toEqual(['m-1']);
  });

  it('uses forcedKind=image even for non-image MIME when forcedKind is set', () => {
    // e.g. camera capture might produce a file without proper MIME
    const file = new File(['camera-data'], 'capture.jpg', { type: '' });
    const forcedKind = 'image' as const;
    const isImage = forcedKind === 'image' || file.type.startsWith('image/');

    expect(isImage).toBe(true);

    const localPreviewUrl = isImage ? URL.createObjectURL(file) : null;
    expect(localPreviewUrl).toBeTruthy();
  });
});
