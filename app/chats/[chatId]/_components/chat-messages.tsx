import { type RefObject } from 'react';
import type { StickToBottomContext } from 'use-stick-to-bottom';
import { ChevronRight, File, FileSpreadsheet, FileText, Video } from 'lucide-react';

import { buildFileUrl } from '@/src/lib/api-fetch';
import { downloadFile } from '@/app/chats/[chatId]/_lib/download-file';
import { formatBytes, isMessageTyping, messageBubbleClass, messageText } from '@/app/chats/[chatId]/_lib/chat-utils';
import { isPreviewable } from '@/app/chats/[chatId]/_lib/file-preview-utils';
import type { MediaItem, Message } from '@/app/chats/[chatId]/_lib/types';
import { VoiceMessagePlayer } from '@/app/chats/[chatId]/_components/voice-message-player';
import { MessageResponse } from '@/src/components/ai-elements/message';
import { Tool, ToolHeader, ToolContent } from '@/src/components/ai-elements/tool';
import {
  AudioPlayer,
  AudioPlayerElement,
  AudioPlayerControlBar,
  AudioPlayerPlayButton,
  AudioPlayerTimeRange,
  AudioPlayerTimeDisplay,
  AudioPlayerDurationDisplay,
} from '@/src/components/ai-elements/audio-player';
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from '@/src/components/ai-elements/conversation';

type ChatMessagesProps = {
  feedRef: RefObject<StickToBottomContext | null>;
  loading: boolean;
  messagesLoading: boolean;
  error: string | null;
  messages: Message[];
  inlineMessageMedia: Map<string, MediaItem[]>;
  pendingReply: boolean;
  setViewerMediaId: (id: string) => void;
  setPreviewFileId: (id: string | null) => void;
  scrollToMessageId?: string | null;
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
    <button
      type="button"
      aria-label={`Download ${item.filename || 'attachment'}`}
      className="flex w-full cursor-pointer items-center gap-3 rounded-xl bg-black/10 px-3 py-2.5"
      onClick={() => downloadFile(buildFileUrl(item.id), item.filename || 'attachment')}
    >
      {inner}
    </button>
  );
}

function InlineAudioItem({ item }: { item: MediaItem }) {
  return (
    <AudioPlayer className="rounded-xl border border-border/70 bg-card/40">
      <AudioPlayerElement src={buildFileUrl(item.id)} />
      <AudioPlayerControlBar>
        <AudioPlayerPlayButton />
        <AudioPlayerTimeDisplay />
        <AudioPlayerTimeRange />
        <AudioPlayerDurationDisplay />
      </AudioPlayerControlBar>
    </AudioPlayer>
  );
}

function ToolMessage({ text, trace }: { text: string; trace?: Record<string, unknown> | null }) {
  const title = typeof trace?.toolName === 'string' ? trace.toolName : 'Tool';
  return (
    <div className="mx-auto w-full max-w-[92%]">
      <Tool>
        <ToolHeader title={title} type="tool-invocation" state="output-available" />
        <ToolContent>
          <MessageResponse className="text-xs">{text}</MessageResponse>
        </ToolContent>
      </Tool>
    </div>
  );
}

function MessageSkeletons() {
  return (
    <div className="space-y-3 py-4" aria-label="Loading messages">
      {[1, 2, 3].map((i) => (
        <div key={i} className={`flex w-full ${i % 2 === 0 ? 'justify-end' : ''}`}>
          <div className={`h-10 rounded-2xl bg-muted animate-pulse ${i % 2 === 0 ? 'w-2/5' : 'w-3/5'}`} />
        </div>
      ))}
    </div>
  );
}

export function ChatMessages({
  feedRef,
  loading,
  messagesLoading,
  error,
  messages,
  inlineMessageMedia,
  pendingReply,
  setViewerMediaId,
  setPreviewFileId,
  scrollToMessageId,
}: ChatMessagesProps) {
  const visibleMessages = messages.filter((message) => {
    const attachments = inlineMessageMedia.get(message.id) ?? [];
    if (attachments.length > 0) {
      return true;
    }
    if (message.stream_state === 'streaming') {
      return true;
    }
    return Boolean(message.content_final?.trim() || message.content_partial?.trim());
  });

  return (
    <Conversation
      contextRef={feedRef}
      className="flex-1"
      style={{ paddingBottom: 'calc(var(--composer-height, 5rem) + var(--keyboard-offset, 0px))' }}
      initial={scrollToMessageId ? false : 'smooth'}
    >
      <ConversationContent>
        {loading && <p className="px-2 py-6 text-sm text-muted-foreground">Loading chat...</p>}
        {!loading && error && <p className="px-2 py-6 text-sm text-red-300">{error}</p>}

        {!loading && !error && messagesLoading && visibleMessages.length === 0 && <MessageSkeletons />}

        {!loading && !error && !messagesLoading && visibleMessages.length === 0 && (
          <p className="px-2 py-6 text-sm text-muted-foreground">No messages yet.</p>
        )}

        {!loading &&
          !error &&
          visibleMessages.map((message) => {
            const attachments = inlineMessageMedia.get(message.id) ?? [];
            const imageItems = attachments.filter((item) => item.kind === 'image');
            const audioItems = attachments.filter((item) => item.kind === 'audio');
            const fileItems = attachments.filter((item) => item.kind === 'file');

            const typing = isMessageTyping(message);
            const text = messageText(message);
            const hasText = !!text.trim();
            const isImageOnly =
              imageItems.length > 0 && !hasText && audioItems.length === 0 && fileItems.length === 0;
            const isAudioOnly =
              audioItems.length > 0 && !hasText && imageItems.length === 0 && fileItems.length === 0;

            // Tool messages use a dedicated collapsible component
            if (message.role === 'tool') {
              return (
                <div key={message.id} id={`msg-${message.id}`} className="mb-2 flex w-full flex-col gap-2">
                  {hasText && <ToolMessage text={text} trace={message.trace} />}
                  {audioItems.length > 0 && (
                    <div className="mx-auto w-full max-w-[92%] space-y-2">
                      {audioItems.map((item) => (
                        <InlineAudioItem key={item.id} item={item} />
                      ))}
                    </div>
                  )}
                  {imageItems.length > 0 && (
                    <div className="mx-auto grid w-full max-w-[92%] grid-cols-2 gap-1">
                      {imageItems.map((item) => (
                        <button
                          key={item.id}
                          type="button"
                          className="block overflow-hidden rounded-lg"
                          aria-label={`Open image ${item.filename || item.id}`}
                          onClick={() => setViewerMediaId(item.id)}
                        >
                          <img
                            src={buildFileUrl(item.id, 'thumbnail')}
                            alt={item.filename || 'Image attachment'}
                            className="h-36 w-full object-cover"
                          />
                        </button>
                      ))}
                    </div>
                  )}
                  {fileItems.length > 0 && (
                    <div className="mx-auto w-full max-w-[92%] space-y-2">
                      {fileItems.map((item) => (
                        <FileAttachmentCard key={item.id} item={item} role={message.role} setPreviewFileId={setPreviewFileId} />
                      ))}
                    </div>
                  )}
                </div>
              );
            }

            const baseBubbleClass = messageBubbleClass(message.role);
            const bubbleClass = isImageOnly
              ? baseBubbleClass.replace('px-3 py-2', 'p-0 overflow-hidden')
              : isAudioOnly
                ? baseBubbleClass.replace('px-3 py-2', 'px-2.5 py-2')
                : baseBubbleClass;

            return (
              <div key={message.id} id={`msg-${message.id}`} className="mb-2 flex w-full">
                <div className={bubbleClass}>
                  {/* TODO: When trace.reasoning is available, render <Reasoning> + <ReasoningTrigger> + <ReasoningContent> above the agent message */}

                  {typing ? (
                    <TypingDots />
                  ) : (
                    hasText && <MessageResponse>{text}</MessageResponse>
                  )}

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
                            src={buildFileUrl(imageItems[0].id, 'thumbnail')}
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
                                src={buildFileUrl(item.id, 'thumbnail')}
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
                              src={buildFileUrl(imageItems[0].id, 'thumbnail')}
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
                                  src={buildFileUrl(item.id, 'thumbnail')}
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

                  {/* Audio — voice message player for audio-only, AudioPlayer otherwise */}
                  {audioItems.length > 0 && (
                    isAudioOnly ? (
                      <div className="space-y-2">
                        {audioItems.map((item) => (
                          <VoiceMessagePlayer key={item.id} item={item} role={message.role} />
                        ))}
                      </div>
                    ) : (
                      <div className="space-y-2 pt-2">
                        {audioItems.map((item) => (
                          <InlineAudioItem key={item.id} item={item} />
                        ))}
                      </div>
                    )
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

        {!loading && !error && pendingReply && !messages.some((m) => m.stream_state === 'streaming') && (
          <div className="mb-2 flex w-full">
            <div className={messageBubbleClass('agent')}>
              <TypingDots />
            </div>
          </div>
        )}
      </ConversationContent>

      <ConversationScrollButton />
    </Conversation>
  );
}
