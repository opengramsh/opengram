import { type RefObject } from 'react';
import { ChevronRight, File, FileSpreadsheet, FileText, Video } from 'lucide-react';

import { formatBytes, isMessageTyping, messageBubbleClass, messageText } from '@/app/chats/[chatId]/_lib/chat-utils';
import { isPreviewable } from '@/app/chats/[chatId]/_lib/file-preview-utils';
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
  setPreviewFileId: (id: string | null) => void;
};

type FileTypeInfo = {
  Icon: React.ElementType;
  colorClass: string;
  label: string;
};

function getFileTypeInfo(contentType: string, filename: string): FileTypeInfo {
  const ext = filename?.split('.').pop()?.toLowerCase() ?? '';

  if (contentType === 'application/pdf' || ext === 'pdf') {
    return { Icon: FileText, colorClass: 'bg-red-500/20 text-red-400', label: 'PDF' };
  }
  if (
    contentType.includes('word') ||
    contentType === 'application/msword' ||
    ext === 'doc' ||
    ext === 'docx'
  ) {
    return { Icon: FileText, colorClass: 'bg-blue-500/20 text-blue-400', label: ext.toUpperCase() || 'DOC' };
  }
  if (
    contentType.includes('excel') ||
    contentType.includes('spreadsheet') ||
    ext === 'xls' ||
    ext === 'xlsx' ||
    ext === 'csv'
  ) {
    return { Icon: FileSpreadsheet, colorClass: 'bg-green-500/20 text-green-400', label: ext.toUpperCase() || 'XLS' };
  }
  if (contentType.startsWith('text/')) {
    return { Icon: FileText, colorClass: 'bg-slate-500/20 text-slate-400', label: ext.toUpperCase() || 'TXT' };
  }
  if (contentType.startsWith('video/')) {
    return { Icon: Video, colorClass: 'bg-purple-500/20 text-purple-400', label: ext.toUpperCase() || 'VIDEO' };
  }
  return { Icon: File, colorClass: 'bg-slate-500/20 text-slate-400', label: ext.toUpperCase() || 'FILE' };
}

function TypingDots() {
  return (
    <span className="inline-flex items-center gap-1 py-0.5" aria-label="Agent is typing">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="inline-block h-1.5 w-1.5 rounded-full bg-muted-foreground/60"
          style={{ animation: `typing-dot 1.2s ease-in-out ${i * 0.15}s infinite` }}
        />
      ))}
    </span>
  );
}

function FileAttachmentCard({
  item,
  role,
  setPreviewFileId,
}: {
  item: MediaItem;
  role: Message['role'];
  setPreviewFileId: (id: string | null) => void;
}) {
  const { Icon, colorClass, label } = getFileTypeInfo(item.content_type, item.filename);
  const isUserBubble = role === 'user';
  const canPreview = isPreviewable(item.content_type, item.byte_size || 0);

  const inner = (
    <>
      <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${isUserBubble ? 'bg-white/20 text-white' : colorClass}`}>
        <Icon size={20} />
      </div>
      <div className="min-w-0 flex-1">
        <p className={`truncate text-sm font-medium ${isUserBubble ? 'text-white' : ''}`}>{item.filename || 'Attachment'}</p>
        <p className={`text-xs ${isUserBubble ? 'text-white/60' : 'text-muted-foreground/70'}`}>
          {formatBytes(item.byte_size || 0)} &bull; {label}
        </p>
      </div>
      <ChevronRight size={16} className={`shrink-0 ${isUserBubble ? 'text-white/50' : 'text-muted-foreground/50'}`} />
    </>
  );

  if (canPreview) {
    return (
      <button
        type="button"
        aria-label={`Preview ${item.filename || 'attachment'}`}
        className="flex w-full cursor-pointer items-center gap-3 rounded-xl bg-black/10 px-3 py-2.5"
        onClick={() => setPreviewFileId(item.id)}
      >
        {inner}
      </button>
    );
  }

  return (
    <a
      href={`/api/v1/files/${item.id}`}
      download
      aria-label={`Download ${item.filename || 'attachment'}`}
      className="flex items-center gap-3 rounded-xl bg-black/10 px-3 py-2.5"
    >
      {inner}
    </a>
  );
}

export function ChatMessages({
  feedRef,
  loading,
  error,
  messages,
  inlineMessageMedia,
  keyboardOffset,
  setViewerMediaId,
  setPreviewFileId,
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

          const typing = isMessageTyping(message);
          const text = messageText(message);
          const hasText = !!text.trim();
          const isImageOnly =
            imageItems.length > 0 && !hasText && audioItems.length === 0 && fileItems.length === 0;

          const baseBubbleClass = messageBubbleClass(message.role);
          const bubbleClass = isImageOnly
            ? baseBubbleClass.replace('px-3 py-2', 'p-0 overflow-hidden')
            : baseBubbleClass;

          return (
            <div key={message.id} className="mb-2 flex w-full">
              <div className={bubbleClass}>
                {typing ? <TypingDots /> : hasText && text}

                {/* Images */}
                {imageItems.length > 0 && (
                  isImageOnly ? (
                    imageItems.length === 1 ? (
                      <button
                        type="button"
                        className="block w-full"
                        aria-label={`Open image ${imageItems[0].filename || imageItems[0].id}`}
                        onClick={() => setViewerMediaId(imageItems[0].id)}
                      >
                        <img
                          src={`/api/v1/files/${imageItems[0].id}/thumbnail`}
                          alt={imageItems[0].filename || 'Image attachment'}
                          className="h-auto max-h-52 w-full object-cover"
                        />
                      </button>
                    ) : (
                      <div className="grid grid-cols-2 gap-px">
                        {imageItems.map((item) => (
                          <button
                            key={item.id}
                            type="button"
                            className="block overflow-hidden"
                            aria-label={`Open image ${item.filename || item.id}`}
                            onClick={() => setViewerMediaId(item.id)}
                          >
                            <img
                              src={`/api/v1/files/${item.id}/thumbnail`}
                              alt={item.filename || 'Image attachment'}
                              className="h-36 w-full object-cover"
                            />
                          </button>
                        ))}
                      </div>
                    )
                  ) : (
                    <div className="-mx-3 -mb-2 mt-2 overflow-hidden rounded-b-2xl">
                      {imageItems.length === 1 ? (
                        <button
                          type="button"
                          className="block w-full"
                          aria-label={`Open image ${imageItems[0].filename || imageItems[0].id}`}
                          onClick={() => setViewerMediaId(imageItems[0].id)}
                        >
                          <img
                            src={`/api/v1/files/${imageItems[0].id}/thumbnail`}
                            alt={imageItems[0].filename || 'Image attachment'}
                            className="h-auto max-h-48 w-full object-cover"
                          />
                        </button>
                      ) : (
                        <div className="grid grid-cols-2 gap-px">
                          {imageItems.map((item) => (
                            <button
                              key={item.id}
                              type="button"
                              className="block overflow-hidden"
                              aria-label={`Open image ${item.filename || item.id}`}
                              onClick={() => setViewerMediaId(item.id)}
                            >
                              <img
                                src={`/api/v1/files/${item.id}/thumbnail`}
                                alt={item.filename || 'Image attachment'}
                                className="h-36 w-full object-cover"
                              />
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )
                )}

                {/* Audio */}
                {audioItems.length > 0 && (
                  <div className="space-y-2 pt-2">
                    {audioItems.map((item) => (
                      <InlineAudioPlayer key={item.id} item={item} />
                    ))}
                  </div>
                )}

                {/* Files */}
                {fileItems.length > 0 && (
                  <div className="space-y-2 pt-2">
                    {fileItems.map((item) => (
                      <FileAttachmentCard key={item.id} item={item} role={message.role} setPreviewFileId={setPreviewFileId} />
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
