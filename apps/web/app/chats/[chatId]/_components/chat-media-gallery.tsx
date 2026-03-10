import { useCallback, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { Download, Eye } from 'lucide-react';

import {
  AudioPlayer,
  AudioPlayerElement,
  AudioPlayerControlBar,
  AudioPlayerPlayButton,
  AudioPlayerTimeRange,
  AudioPlayerTimeDisplay,
  AudioPlayerDurationDisplay,
} from '@/src/components/ai-elements/audio-player';
import { buildFileUrl } from '@/src/lib/api-fetch';
import { downloadFile } from '@/app/chats/[chatId]/_lib/download-file';
import { formatBytes } from '@/app/chats/[chatId]/_lib/chat-utils';
import { isPreviewable } from '@/app/chats/[chatId]/_lib/file-preview-utils';
import type { MediaFilter, MediaItem } from '@/app/chats/[chatId]/_lib/types';
import { Badge } from '@/src/components/ui/badge';
import { Button } from '@/src/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from '@/src/components/ui/dialog';
import {
  Drawer,
  DrawerContent,
  DrawerTitle,
} from '@/src/components/ui/drawer';

type ChatMediaGalleryProps = {
  isMediaGalleryOpen: boolean;
  setIsMediaGalleryOpen: (value: boolean) => void;
  mediaFilter: MediaFilter;
  setMediaFilter: (value: MediaFilter) => void;
  filteredGalleryMedia: MediaItem[];
  galleryImageMedia: MediaItem[];
  galleryListMedia: MediaItem[];
  viewerMedia?: MediaItem;
  setViewerMediaId: (id: string | null) => void;
  setPreviewFileId: (id: string | null) => void;
};

export function ChatMediaGallery({
  isMediaGalleryOpen,
  setIsMediaGalleryOpen,
  mediaFilter,
  setMediaFilter,
  filteredGalleryMedia,
  galleryImageMedia,
  galleryListMedia,
  viewerMedia,
  setViewerMediaId,
  setPreviewFileId,
}: ChatMediaGalleryProps) {
  const closeMediaOverlays = useCallback(() => {
    setViewerMediaId(null);
    setPreviewFileId(null);
    setIsMediaGalleryOpen(false);
  }, [setIsMediaGalleryOpen, setPreviewFileId, setViewerMediaId]);

  return (
    <>
      <Drawer open={isMediaGalleryOpen} onOpenChange={setIsMediaGalleryOpen}>
        <DrawerContent className="liquid-glass max-h-[78dvh] overflow-hidden border-x border-t border-border px-4 pb-4 pt-3">
          <div className="flex items-center justify-between pb-2">
            <DrawerTitle className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Media gallery</DrawerTitle>
          </div>
          <div className="mb-3 flex gap-2 overflow-x-auto pb-1">
            {[
              { id: 'all', label: 'All' },
              { id: 'image', label: 'Images' },
              { id: 'audio', label: 'Audio' },
              { id: 'file', label: 'Files' },
            ].map((filter) => (
              <Badge
                key={filter.id}
                variant="filter"
                data-active={mediaFilter === filter.id}
                role="button"
                tabIndex={0}
                className="cursor-pointer"
                onClick={() => setMediaFilter(filter.id as MediaFilter)}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setMediaFilter(filter.id as MediaFilter); } }}
              >
                {filter.label}
              </Badge>
            ))}
          </div>
          <div className="max-h-[58dvh] overflow-y-auto">
            {filteredGalleryMedia.length === 0 && (
              <p className="py-4 text-sm text-muted-foreground">No media for this filter.</p>
            )}

            {galleryImageMedia.length > 0 && (
              <div className="mb-3">
                <div className="grid grid-cols-3 gap-2">
                  {galleryImageMedia.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      className="cursor-pointer"
                      aria-label={`View image ${item.filename || item.id}`}
                      onClick={() => setViewerMediaId(item.id)}
                    >
                      <img
                        src={buildFileUrl(item.id, 'thumbnail')}
                        alt={item.filename || 'Image attachment'}
                        width={240}
                        height={240}
                        className="h-24 w-full rounded-lg border border-border/70 object-cover"
                      />
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {galleryListMedia.map((item) => {
                const canPreview = item.kind === 'file' && isPreviewable(item.content_type, item.byte_size || 0);
                return (
                <div
                  key={item.id}
                  role={canPreview ? 'button' : undefined}
                  tabIndex={canPreview ? 0 : undefined}
                  className={`rounded-xl border border-border bg-card p-2${canPreview ? ' cursor-pointer' : ''}`}
                  onClick={canPreview ? () => setPreviewFileId(item.id) : undefined}
                  onKeyDown={canPreview ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setPreviewFileId(item.id); } } : undefined}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm text-foreground">{item.filename || 'Attachment'}</p>
                      <p className="text-xs text-muted-foreground">
                        {item.kind === 'audio' ? 'Audio' : 'File'} &bull; {formatBytes(item.byte_size || 0)}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {canPreview && (
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`Preview ${item.filename || 'attachment'}`}
                          onClick={(e) => { e.stopPropagation(); setPreviewFileId(item.id); }}
                        >
                          <Eye size={16} />
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Download ${item.filename || 'attachment'}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          void downloadFile(buildFileUrl(item.id), item.filename || 'attachment', {
                            beforeOpen: closeMediaOverlays,
                          });
                        }}
                      >
                        <Download size={16} />
                      </Button>
                    </div>
                  </div>
                  {item.kind === 'audio' && (
                    <div className="mt-2">
                      <AudioPlayer className="rounded-xl border border-border/70 bg-card/40">
                        <AudioPlayerElement src={buildFileUrl(item.id)} />
                        <AudioPlayerControlBar>
                          <AudioPlayerPlayButton />
                          <AudioPlayerTimeDisplay />
                          <AudioPlayerTimeRange />
                          <AudioPlayerDurationDisplay />
                        </AudioPlayerControlBar>
                      </AudioPlayer>
                    </div>
                  )}
                </div>
                );
              })}
            </div>
          </div>
        </DrawerContent>
      </Drawer>

      <ImageViewerDialog
        viewerMedia={viewerMedia}
        setViewerMediaId={setViewerMediaId}
        onBeforeDownload={closeMediaOverlays}
      />
    </>
  );
}

const DISMISS_THRESHOLD = 100;

function ImageViewerDialog({
  viewerMedia,
  setViewerMediaId,
  onBeforeDownload,
}: {
  viewerMedia?: MediaItem;
  setViewerMediaId: (id: string | null) => void;
  onBeforeDownload: () => void;
}) {
  const [dragY, setDragY] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const pointerIdRef = useRef<number | null>(null);
  const startYRef = useRef(0);
  const startXRef = useRef(0);
  const lockedRef = useRef<'vertical' | null>(null);

  const resetDrag = useCallback(() => {
    setDragY(0);
    setIsDragging(false);
    pointerIdRef.current = null;
    lockedRef.current = null;
  }, []);

  const handlePointerDown = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    pointerIdRef.current = e.pointerId;
    startYRef.current = e.clientY;
    startXRef.current = e.clientX;
    lockedRef.current = null;
    setIsDragging(false);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }, []);

  const handlePointerMove = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    if (pointerIdRef.current !== e.pointerId) return;
    const dy = e.clientY - startYRef.current;
    const dx = e.clientX - startXRef.current;

    if (!lockedRef.current) {
      if (Math.abs(dy) > 8 && Math.abs(dy) > Math.abs(dx)) {
        lockedRef.current = 'vertical';
        setIsDragging(true);
      } else {
        return;
      }
    }

    // Only allow dragging down (positive dy)
    setDragY(Math.max(0, dy));
  }, []);

  const handlePointerUp = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    if (pointerIdRef.current !== e.pointerId) return;
    if (dragY > DISMISS_THRESHOLD) {
      setViewerMediaId(null);
    }
    resetDrag();
  }, [dragY, resetDrag, setViewerMediaId]);

  const isOpen = viewerMedia?.kind === 'image';
  const opacity = isDragging ? Math.max(0.2, 1 - dragY / 400) : 1;

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) {
          resetDrag();
          setViewerMediaId(null);
        }
      }}
    >
      <DialogContent
        showCloseButton={false}
        className="h-[90dvh] max-w-3xl border-white/20 bg-black/90 p-3"
        style={{
          transform: dragY > 0 ? `translateY(${dragY}px)` : undefined,
          opacity,
          transition: isDragging ? 'none' : 'transform 0.2s ease-out, opacity 0.2s ease-out',
        }}
      >
        <DialogTitle className="sr-only">Image viewer</DialogTitle>
        {viewerMedia?.kind === 'image' && (
          <div className="flex h-full flex-col">
            <div className="mb-3 flex items-center justify-between">
              <p className="truncate text-sm text-white">{viewerMedia.filename || 'Image viewer'}</p>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  aria-label={`Download ${viewerMedia.filename || 'image'}`}
                  className="cursor-pointer text-xs text-white/90"
                  onClick={() => {
                    void downloadFile(buildFileUrl(viewerMedia.id), viewerMedia.filename || 'image', {
                      beforeOpen: onBeforeDownload,
                    });
                  }}
                >
                  Download
                </button>
                <Button
                  variant="ghost"
                  size="xs"
                  className="text-white/80 hover:text-white"
                  onClick={() => setViewerMediaId(null)}
                >
                  Close
                </Button>
              </div>
            </div>
            <div
              className="relative min-h-0 flex-1 overflow-auto rounded-2xl border border-white/20 bg-black/40 touch-none"
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerCancel={handlePointerUp}
            >
              <img
                src={buildFileUrl(viewerMedia.id)}
                alt={viewerMedia.filename || 'Image viewer'}
                className="absolute inset-0 h-full w-full object-contain select-none"
                draggable={false}
              />
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
