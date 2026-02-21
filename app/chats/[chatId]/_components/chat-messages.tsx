import { type RefObject } from 'react';

import { formatBytes, messageBubbleClass, messageText } from '@/app/chats/[chatId]/_lib/chat-utils';
import type { MediaItem, Message } from '@/app/chats/[chatId]/_lib/types';
import { InlineAudioPlayer } from '@/app/chats/[chatId]/_components/inline-audio-player';

type ChatMessagesProps = {
  feedRef: RefObject<HTMLDivElement | null>;
  loading: boolean;
  error: string | null;
  messages: Message[];
  inlineMessageMedia: Map<string, MediaItem[]>;
  keyboardOffset: number;
  setViewerMediaId: (id: string) => void;
};

export function ChatMessages({
  feedRef,
  loading,
  error,
  messages,
  inlineMessageMedia,
  keyboardOffset,
  setViewerMediaId,
}: ChatMessagesProps) {
  return (
    <main
      ref={feedRef}
      className="flex-1 overflow-y-auto px-3 pt-3"
      style={{ paddingBottom: `calc(170px + env(safe-area-inset-bottom, 0px) + ${keyboardOffset}px)` }}
    >
      {loading && <p className="px-2 py-6 text-sm text-muted-foreground">Loading chat...</p>}
      {!loading && error && <p className="px-2 py-6 text-sm text-red-300">{error}</p>}

      {!loading && !error && messages.length === 0 && (
        <p className="px-2 py-6 text-sm text-muted-foreground">No messages yet.</p>
      )}

      {!loading &&
        !error &&
        messages.map((message) => {
          const attachments = inlineMessageMedia.get(message.id) ?? [];
          const imageItems = attachments.filter((item) => item.kind === 'image');
          const audioItems = attachments.filter((item) => item.kind === 'audio');
          const fileItems = attachments.filter((item) => item.kind === 'file');

          return (
            <div key={message.id} className="mb-2 flex w-full">
              <div className={messageBubbleClass(message.role)}>
                {messageText(message)}
                {imageItems.length > 0 && (
                  <div className="grid grid-cols-2 gap-2 pt-2">
                    {imageItems.map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        className="block overflow-hidden rounded-lg border border-border/70"
                        aria-label={`Open image ${item.filename || item.id}`}
                        onClick={() => setViewerMediaId(item.id)}
                      >
                        <img
                          src={`/api/v1/files/${item.id}/thumbnail`}
                          alt={item.filename || 'Image attachment'}
                          width={220}
                          height={160}
                          className="h-28 w-full object-cover"
                        />
                      </button>
                    ))}
                  </div>
                )}
                {audioItems.length > 0 && (
                  <div className="space-y-2 pt-2">
                    {audioItems.map((item) => (
                      <InlineAudioPlayer key={item.id} item={item} />
                    ))}
                  </div>
                )}
                {fileItems.length > 0 && (
                  <div className="space-y-2 pt-2">
                    {fileItems.map((item) => (
                      <a
                        key={item.id}
                        href={`/api/v1/files/${item.id}`}
                        download
                        aria-label={`Download ${item.filename || 'attachment'}`}
                        className="block rounded-lg border border-border/70 bg-muted/30 px-2 py-1.5"
                      >
                        <p className="truncate text-xs text-foreground">{item.filename || 'Attachment'}</p>
                        <p className="text-[11px] text-muted-foreground">{formatBytes(item.byte_size || 0)}</p>
                      </a>
                    ))}
                  </div>
                )}
              </div>
            </div>
          );
        })}
    </main>
  );
}
