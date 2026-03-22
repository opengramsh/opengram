'use client';

import { useEffect, useState } from 'react';
import { Download, X } from 'lucide-react';
import { Streamdown } from 'streamdown';

import { downloadFile } from '@/app/chats/[chatId]/_lib/download-file';
import { getPreviewKind } from '@/app/chats/[chatId]/_lib/file-preview-utils';
import { useStreamdownPlugins } from '@/src/components/ai-elements/streamdown-plugins';
import { apiFetch, buildFileUrl } from '@/src/lib/api-fetch';
import type { MediaItem } from '@/app/chats/[chatId]/_lib/types';
import { Button } from '@/src/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from '@/src/components/ui/dialog';
import { Skeleton } from '@/src/components/ui/skeleton';

type FilePreviewSectionProps = {
  previewFile?: MediaItem;
  setPreviewFileId: (id: string | null) => void;
};

export function FilePreviewSection({ previewFile, setPreviewFileId }: FilePreviewSectionProps) {
  const isOpen = Boolean(previewFile);

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) setPreviewFileId(null);
      }}
    >
      <DialogContent
        showCloseButton={false}
        className="inset-0 flex h-[100dvh] w-full max-w-none translate-x-0 translate-y-0 flex-col gap-0 rounded-none border border-white/20 bg-black/90 p-3 sm:inset-auto sm:top-1/2 sm:left-1/2 sm:h-[90dvh] sm:w-[90vw] sm:max-w-4xl sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl"
      >
        <DialogTitle className="sr-only">
          {previewFile?.filename ?? 'File preview'}
        </DialogTitle>

        {previewFile && (
          <>
            {/* Header */}
            <div className="mb-3 flex shrink-0 items-center justify-between gap-2">
              <p className="min-w-0 truncate text-sm text-white">
                {previewFile.filename || 'File preview'}
              </p>
              <div className="flex shrink-0 items-center gap-1">
                <Button
                  variant="ghost"
                  size="icon"
                  className="text-white/80 hover:text-white"
                  aria-label={`Download ${previewFile.filename || 'file'}`}
                  onClick={() => {
                    void downloadFile(buildFileUrl(previewFile.id), previewFile.filename || 'file', {
                      beforeOpen: () => setPreviewFileId(null),
                    });
                  }}
                >
                  <Download size={16} />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="text-white/80 hover:text-white"
                  aria-label="Close preview"
                  onClick={() => setPreviewFileId(null)}
                >
                  <X size={16} />
                </Button>
              </div>
            </div>

            {/* Content */}
            <div className="relative min-h-0 flex-1 overflow-hidden rounded-2xl border border-white/20 bg-black/40">
              <FilePreviewContent item={previewFile} />
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function FilePreviewContent({ item }: { item: MediaItem }) {
  const kind = getPreviewKind(item.content_type, item.filename);

  if (kind === 'pdf') return <PdfPreview item={item} />;
  if (kind === 'markdown') return <MarkdownPreview item={item} />;
  return <TextPreview item={item} />;
}

// ---------------------------------------------------------------------------
// PDF
// ---------------------------------------------------------------------------

function PdfPreview({ item }: { item: MediaItem }) {
  return (
    <iframe
      src={buildFileUrl(item.id)}
      title={item.filename || 'PDF preview'}
      className="h-full w-full border-0"
    />
  );
}

// ---------------------------------------------------------------------------
// Text fetch hook
// ---------------------------------------------------------------------------

type FetchState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; text: string };

function useTextContent(itemId: string): FetchState {
  const [state, setState] = useState<FetchState>({ status: 'loading' });
  const [prevItemId, setPrevItemId] = useState(itemId);

  // Reset to loading when itemId changes (React-approved derived state pattern)
  if (prevItemId !== itemId) {
    setPrevItemId(itemId);
    setState({ status: 'loading' });
  }

  useEffect(() => {
    let cancelled = false;

    apiFetch(`/api/v1/files/${itemId}`)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.text();
      })
      .then((text) => {
        if (!cancelled) setState({ status: 'ready', text });
      })
      .catch(() => {
        if (!cancelled) setState({ status: 'error', message: 'Failed to load file content.' });
      });

    return () => {
      cancelled = true;
    };
  }, [itemId]);

  return state;
}

// ---------------------------------------------------------------------------
// Text
// ---------------------------------------------------------------------------

function TextPreview({ item }: { item: MediaItem }) {
  const state = useTextContent(item.id);

  if (state.status === 'loading') {
    return <Skeleton className="h-full w-full rounded-none" />;
  }

  if (state.status === 'error') {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-sm text-red-400">{state.message}</p>
      </div>
    );
  }

  return (
    <pre className="h-full overflow-auto p-4 font-mono text-xs text-white/90 whitespace-pre-wrap break-words">
      {state.text}
    </pre>
  );
}

function MarkdownPreview({ item }: { item: MediaItem }) {
  const state = useTextContent(item.id);
  const plugins = useStreamdownPlugins();

  if (state.status === 'loading') {
    return <Skeleton className="h-full w-full rounded-none" />;
  }

  if (state.status === 'error') {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-sm text-red-400">{state.message}</p>
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto p-4 text-sm text-white/90">
      <Streamdown
        mode="static"
        plugins={plugins}
        className="w-full [&>*:first-child]:mt-0 [&>*:last-child]:mb-0 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5"
      >
        {state.text}
      </Streamdown>
    </div>
  );
}
