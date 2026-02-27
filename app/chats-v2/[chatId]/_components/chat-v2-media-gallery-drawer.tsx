import { useState } from 'react';
import { Download, X } from 'lucide-react';

import { Button } from '@/src/components/ui/button';
import { Badge } from '@/src/components/ui/badge';
import { Drawer, DrawerContent } from '@/src/components/ui/drawer';
import { Dialog, DialogContent } from '@/src/components/ui/dialog';
import { buildFileUrl } from '@/src/lib/api-fetch';
import { cn } from '@/src/lib/utils';
import { formatBytes } from '../_lib/chat-utils';
import type { MediaFilter } from '../_lib/types';
import { useChatV2Context } from './chat-v2-provider';

const FILTER_TABS: { label: string; value: MediaFilter }[] = [
  { label: 'All', value: 'all' },
  { label: 'Images', value: 'image' },
  { label: 'Audio', value: 'audio' },
  { label: 'Files', value: 'file' },
];

export function ChatV2MediaGalleryDrawer() {
  const { data } = useChatV2Context();
  const {
    isMediaGalleryOpen, setIsMediaGalleryOpen,
    mediaFilter, setMediaFilter,
    filteredGalleryMedia, galleryImageMedia, galleryListMedia,
    viewerMedia, setViewerMediaId,
  } = data;

  return (
    <>
      <Drawer open={isMediaGalleryOpen} onOpenChange={setIsMediaGalleryOpen}>
        <DrawerContent className="max-h-[78dvh] overflow-y-auto pb-safe">
          <div className="p-4">
            <h3 className="mb-3 text-sm font-semibold">Media Gallery</h3>

            {/* Filter tabs */}
            <div className="mb-3 flex gap-1.5">
              {FILTER_TABS.map((tab) => (
                <Badge
                  key={tab.value}
                  variant={mediaFilter === tab.value ? 'default' : 'secondary'}
                  className="cursor-pointer"
                  onClick={() => setMediaFilter(tab.value)}
                >
                  {tab.label}
                </Badge>
              ))}
            </div>

            {filteredGalleryMedia.length === 0 && (
              <p className="text-center text-xs text-muted-foreground py-8">No media yet.</p>
            )}

            {/* Image grid */}
            {galleryImageMedia.length > 0 && (
              <div className="grid grid-cols-3 gap-2 mb-3">
                {galleryImageMedia.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className="aspect-square overflow-hidden rounded-lg"
                    onClick={() => setViewerMediaId(item.id)}
                  >
                    <img
                      src={buildFileUrl(item.id, 'thumbnail')}
                      alt={item.filename}
                      className="h-full w-full object-cover"
                      loading="lazy"
                    />
                  </button>
                ))}
              </div>
            )}

            {/* Audio + File list */}
            {galleryListMedia.length > 0 && (
              <div className="space-y-2">
                {galleryListMedia.map((item) => (
                  <div key={item.id} className="flex items-center gap-2 rounded-lg border border-border/50 bg-muted/50 p-2">
                    {item.kind === 'audio' ? (
                      <audio controls className="h-8 flex-1" preload="metadata">
                        <source src={buildFileUrl(item.id)} type={item.content_type} />
                      </audio>
                    ) : (
                      <a
                        href={buildFileUrl(item.id)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex flex-1 items-center gap-2 text-xs hover:underline"
                      >
                        <span className="truncate">{item.filename}</span>
                        <span className="shrink-0 text-muted-foreground">{formatBytes(item.byte_size)}</span>
                      </a>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </DrawerContent>
      </Drawer>

      {/* Image viewer dialog */}
      <Dialog open={!!viewerMedia} onOpenChange={(open) => { if (!open) setViewerMediaId(null); }}>
        <DialogContent className="max-w-[95vw] max-h-[95dvh] p-0 bg-black/95 border-none overflow-hidden">
          {viewerMedia && (
            <div className="relative flex items-center justify-center h-full">
              <img
                src={buildFileUrl(viewerMedia.id)}
                alt={viewerMedia.filename}
                className="max-w-full max-h-[90dvh] object-contain"
              />
              <div className="absolute top-2 right-2 flex gap-2">
                <a href={buildFileUrl(viewerMedia.id)} download={viewerMedia.filename}>
                  <Button variant="ghost" size="icon-sm" className="text-white hover:bg-white/20">
                    <Download size={18} />
                  </Button>
                </a>
                <Button variant="ghost" size="icon-sm" className="text-white hover:bg-white/20" onClick={() => setViewerMediaId(null)}>
                  <X size={18} />
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
