import { InlineAudioPlayer } from '@/app/chats/[chatId]/_components/inline-audio-player';
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
                        src={`/api/v1/files/${item.id}/thumbnail`}
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

            <div className="space-y-2">
              {galleryListMedia.map((item) => (
                <div key={item.id} className="rounded-xl border border-border bg-card p-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm text-foreground">{item.filename || 'Attachment'}</p>
                      <p className="text-xs text-muted-foreground">
                        {item.kind === 'audio' ? 'Audio' : 'File'} &bull; {formatBytes(item.byte_size || 0)}
                      </p>
                    </div>
                    {item.kind === 'file' && isPreviewable(item.content_type, item.byte_size || 0) && (
                      <Button
                        variant="link"
                        size="sm"
                        onClick={() => setPreviewFileId(item.id)}
                      >
                        Preview
                      </Button>
                    )}
                    <Button variant="link" size="sm" asChild>
                      <a
                        href={`/api/v1/files/${item.id}`}
                        download
                        aria-label={`Download ${item.filename || 'attachment'}`}
                      >
                        Download
                      </a>
                    </Button>
                  </div>
                  {item.kind === 'audio' && (
                    <div className="mt-2">
                      <InlineAudioPlayer item={item} />
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </DrawerContent>
      </Drawer>

      <Dialog open={viewerMedia?.kind === 'image'} onOpenChange={(isOpen) => { if (!isOpen) setViewerMediaId(null); }}>
        <DialogContent
          showCloseButton={false}
          className="h-[90dvh] max-w-3xl border-white/20 bg-black/90 p-3"
        >
          <DialogTitle className="sr-only">Image viewer</DialogTitle>
          {viewerMedia?.kind === 'image' && (
            <div className="flex h-full flex-col">
              <div className="mb-3 flex items-center justify-between">
                <p className="truncate text-sm text-white">{viewerMedia.filename || 'Image viewer'}</p>
                <div className="flex items-center gap-3">
                  <a
                    href={`/api/v1/files/${viewerMedia.id}`}
                    download
                    aria-label={`Download ${viewerMedia.filename || 'image'}`}
                    className="text-xs text-white/90"
                  >
                    Download
                  </a>
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
              <div className="relative min-h-0 flex-1 overflow-auto rounded-2xl border border-white/20 bg-black/40">
                <img
                  src={`/api/v1/files/${viewerMedia.id}`}
                  alt={viewerMedia.filename || 'Image viewer'}
                  className="absolute inset-0 h-full w-full object-contain"
                />
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
