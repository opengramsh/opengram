import { useCallback, useState } from 'react';
import { toast } from 'sonner';

import { uploadMedia } from '../_lib/api';
import type { MediaItem } from '../_lib/types';

export type PendingAttachmentV2 = {
  localId: string;
  file: File;
  filename: string;
  kind: 'image' | 'audio' | 'file';
  contentType: string;
  status: 'uploading' | 'ready' | 'error';
  previewUrl: string | null;
  mediaId: string | null;
};

export function useChatV2Attachments(chatId: string) {
  const [attachments, setAttachments] = useState<PendingAttachmentV2[]>([]);

  const uploadFiles = useCallback(async (files: FileList | null, kind?: 'image' | 'file') => {
    if (!files || files.length === 0) return;

    const fileArray = Array.from(files);
    const newEntries: PendingAttachmentV2[] = fileArray.map((file) => {
      const isImage = kind === 'image' || (!kind && file.type.startsWith('image/'));
      const resolvedKind = kind ?? (isImage ? 'image' : 'file');
      return {
        localId: `pending-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        file,
        filename: file.name,
        kind: resolvedKind,
        contentType: file.type,
        status: 'uploading' as const,
        previewUrl: isImage ? URL.createObjectURL(file) : null,
        mediaId: null,
      };
    });

    setAttachments((prev) => [...prev, ...newEntries]);

    for (const entry of newEntries) {
      uploadMedia(chatId, entry.file, entry.kind)
        .then((mediaItem: MediaItem) => {
          setAttachments((prev) =>
            prev.map((a) => (a.localId === entry.localId ? { ...a, status: 'ready' as const, mediaId: mediaItem.id } : a)),
          );
        })
        .catch(() => {
          toast.error(`Failed to upload ${entry.filename}.`);
          setAttachments((prev) => {
            const failed = prev.find((a) => a.localId === entry.localId);
            if (failed?.previewUrl) URL.revokeObjectURL(failed.previewUrl);
            return prev.filter((a) => a.localId !== entry.localId);
          });
        });
    }
  }, [chatId]);

  const removeAttachment = useCallback((localId: string) => {
    setAttachments((prev) => {
      const removed = prev.find((a) => a.localId === localId);
      if (removed?.previewUrl) URL.revokeObjectURL(removed.previewUrl);
      return prev.filter((a) => a.localId !== localId);
    });
  }, []);

  const clearAll = useCallback(() => {
    setAttachments((prev) => {
      for (const a of prev) {
        if (a.previewUrl) URL.revokeObjectURL(a.previewUrl);
      }
      return [];
    });
  }, []);

  const readyIds = attachments.filter((a) => a.status === 'ready' && a.mediaId).map((a) => a.mediaId!);
  const allReady = attachments.length === 0 || attachments.every((a) => a.status === 'ready' || a.status === 'error');

  return { attachments, uploadFiles, removeAttachment, clearAll, readyIds, allReady };
}

export type ChatV2AttachmentsReturn = ReturnType<typeof useChatV2Attachments>;
