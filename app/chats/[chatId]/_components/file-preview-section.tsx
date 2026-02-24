'use client';

import { useEffect, useState } from 'react';
import { Download, X } from 'lucide-react';

import { getPreviewKind } from '@/app/chats/[chatId]/_lib/file-preview-utils';
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
                <Button variant="ghost" size="icon" className="text-white/80 hover:text-white" asChild>
                  <a
                    href={buildFileUrl(previewFile.id)}
                    download
                    aria-label={`Download ${previewFile.filename || 'file'}`}
                  >
                    <Download size={16} />
                  </a>
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

  useEffect(() => {
    setState({ status: 'loading' });
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

// ---------------------------------------------------------------------------
// Lightweight markdown renderer (no external deps)
// ---------------------------------------------------------------------------

function renderInline(text: string, key?: number): React.ReactNode {
  // Tokenize bold, italic, inline code
  const parts = text.split(/(\*\*[\s\S]+?\*\*|__[\s\S]+?__|`[^`]+`|\*[\s\S]+?\*|_[\s\S]+?_)/);
  if (parts.length === 1) return text;
  return (
    <span key={key}>
      {parts.map((part, i) => {
        if ((part.startsWith('**') && part.endsWith('**')) || (part.startsWith('__') && part.endsWith('__'))) {
          return <strong key={i}>{part.slice(2, -2)}</strong>;
        }
        if (part.startsWith('`') && part.endsWith('`') && part.length > 2) {
          return <code key={i} className="rounded bg-white/10 px-1 py-0.5 font-mono text-xs">{part.slice(1, -1)}</code>;
        }
        if ((part.startsWith('*') && part.endsWith('*')) || (part.startsWith('_') && part.endsWith('_'))) {
          return <em key={i}>{part.slice(1, -1)}</em>;
        }
        return part;
      })}
    </span>
  );
}

function renderMarkdown(text: string): React.ReactNode[] {
  const lines = text.split('\n');
  const nodes: React.ReactNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Fenced code block
    if (line.startsWith('```')) {
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith('```')) {
        codeLines.push(lines[i]);
        i++;
      }
      nodes.push(
        <pre key={`pre-${i}`} className="mb-3 overflow-auto rounded-lg bg-white/5 p-3">
          <code className="font-mono text-xs text-white/90">{codeLines.join('\n')}</code>
        </pre>,
      );
      i++;
      continue;
    }

    // Headings
    const h3 = line.match(/^### (.+)/);
    const h2 = line.match(/^## (.+)/);
    const h1 = line.match(/^# (.+)/);
    if (h1) { nodes.push(<h1 key={i} className="mb-3 text-base font-semibold text-white">{renderInline(h1[1])}</h1>); i++; continue; }
    if (h2) { nodes.push(<h2 key={i} className="mb-2 mt-4 text-sm font-semibold text-white">{renderInline(h2[1])}</h2>); i++; continue; }
    if (h3) { nodes.push(<h3 key={i} className="mb-1 mt-3 text-sm font-medium text-white">{renderInline(h3[1])}</h3>); i++; continue; }

    // Blockquote
    if (line.startsWith('> ')) {
      nodes.push(
        <blockquote key={i} className="border-l-2 border-white/30 pl-3 text-white/70">
          {renderInline(line.slice(2))}
        </blockquote>,
      );
      i++;
      continue;
    }

    // Horizontal rule
    if (/^[-*_]{3,}$/.test(line.trim())) {
      nodes.push(<hr key={i} className="my-4 border-white/20" />);
      i++;
      continue;
    }

    // Unordered list
    if (/^[-*] /.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^[-*] /.test(lines[i])) {
        items.push(lines[i].replace(/^[-*] /, ''));
        i++;
      }
      nodes.push(
        <ul key={`ul-${i}`} className="mb-3 list-disc pl-5">
          {items.map((item, j) => <li key={j} className="mb-0.5">{renderInline(item)}</li>)}
        </ul>,
      );
      continue;
    }

    // Ordered list
    if (/^\d+\. /.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\d+\. /.test(lines[i])) {
        items.push(lines[i].replace(/^\d+\. /, ''));
        i++;
      }
      nodes.push(
        <ol key={`ol-${i}`} className="mb-3 list-decimal pl-5">
          {items.map((item, j) => <li key={j} className="mb-0.5">{renderInline(item)}</li>)}
        </ol>,
      );
      continue;
    }

    // Blank line
    if (line.trim() === '') { i++; continue; }

    // Paragraph
    nodes.push(<p key={i} className="mb-3 leading-relaxed">{renderInline(line)}</p>);
    i++;
  }

  return nodes;
}

function MarkdownPreview({ item }: { item: MediaItem }) {
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
    <div className="h-full overflow-auto p-4 text-sm text-white/90">
      {renderMarkdown(state.text)}
    </div>
  );
}
