import { useState } from 'react';
import { Facehash } from 'facehash';

import { MessageResponse } from '@/src/components/ai-elements/message';
import { buildFileUrl } from '@/src/lib/api-fetch';
import { FACEHASH_COLORS } from '@/src/lib/utils';
import { cn } from '@/src/lib/utils';
import { isMessageTyping, messageText, formatBytes } from '../_lib/chat-utils';
import type { MediaItem, Message } from '../_lib/types';
import { useChatV2Context } from './chat-v2-provider';

export function ChatV2MessageFeed() {
  const { data } = useChatV2Context();
  const { feedRef, loading, messagesLoading, error, messages, inlineMessageMedia, pendingReply, primaryAgent } = data;

  if (loading && !data.chat) {
    return (
      <div ref={feedRef} className="flex flex-1 flex-col gap-3 overflow-y-auto p-4">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className={cn('flex', i % 2 === 0 ? 'justify-end' : 'justify-start')}>
            <div className={cn('h-12 animate-pulse rounded-2xl bg-muted', i % 2 === 0 ? 'w-2/3' : 'w-3/4')} />
          </div>
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div ref={feedRef} className="flex flex-1 items-center justify-center p-4">
        <p className="text-sm text-destructive">{error}</p>
      </div>
    );
  }

  const visibleMessages = messages.filter((m) => {
    if (m.content_final?.trim() || m.content_partial?.trim()) return true;
    if (m.stream_state === 'streaming') return true;
    if (inlineMessageMedia.has(m.id)) return true;
    return false;
  });

  return (
    <div
      ref={feedRef}
      className="flex flex-1 flex-col gap-3 overflow-y-auto p-4"
      style={{ paddingBottom: 'calc(var(--composer-height, 60px) + 8px)' }}
    >
      {messagesLoading && visibleMessages.length === 0 && (
        <div className="flex flex-col gap-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className={cn('flex', i % 2 === 0 ? 'justify-end' : 'justify-start')}>
              <div className={cn('h-10 animate-pulse rounded-2xl bg-muted', i % 2 === 0 ? 'w-2/3' : 'w-3/4')} />
            </div>
          ))}
        </div>
      )}

      {visibleMessages.map((message) => (
        <MessageBubble
          key={message.id}
          message={message}
          media={inlineMessageMedia.get(message.id)}
          agentId={primaryAgent?.id}
        />
      ))}

      {pendingReply && !visibleMessages.some((m) => m.stream_state === 'streaming') && (
        <div className="flex items-start gap-2">
          <div className="h-6 w-6 shrink-0 rounded-full overflow-hidden">
            <Facehash name={primaryAgent?.id ?? ''} size={24} colors={FACEHASH_COLORS} />
          </div>
          <TypingDots />
        </div>
      )}
    </div>
  );
}

function MessageBubble({ message, media, agentId }: { message: Message; media?: MediaItem[]; agentId?: string }) {
  const [showTimestamp, setShowTimestamp] = useState(false);
  const typing = isMessageTyping(message);

  if (message.role === 'user') {
    return (
      <div className="flex flex-col items-end gap-1">
        <div
          className="ml-auto max-w-[86%] rounded-2xl rounded-br-md bg-primary px-3 py-2 text-sm text-primary-foreground"
          onClick={() => setShowTimestamp((p) => !p)}
        >
          <p className="whitespace-pre-wrap break-words">{messageText(message)}</p>
        </div>
        {media && media.length > 0 && <InlineMedia items={media} align="end" />}
        {showTimestamp && <Timestamp date={message.created_at} />}
      </div>
    );
  }

  if (message.role === 'agent') {
    const content = message.stream_state === 'streaming'
      ? (message.content_partial ?? '')
      : (message.content_final ?? '');

    return (
      <div className="flex flex-col items-start gap-1">
        <div className="flex items-start gap-2 max-w-[86%]" onClick={() => setShowTimestamp((p) => !p)}>
          <div className="h-6 w-6 shrink-0 rounded-full overflow-hidden mt-0.5">
            <Facehash name={agentId ?? ''} size={24} colors={FACEHASH_COLORS} />
          </div>
          <div className="min-w-0 overflow-hidden text-sm text-foreground">
            {typing ? (
              <TypingDots />
            ) : (
              <MessageResponse>{content}</MessageResponse>
            )}
          </div>
        </div>
        {media && media.length > 0 && <InlineMedia items={media} align="start" className="ml-8" />}
        {showTimestamp && <Timestamp date={message.created_at} className="ml-8" />}
      </div>
    );
  }

  if (message.role === 'tool') {
    return (
      <div className="mx-auto max-w-[92%] rounded-xl border border-emerald-400/40 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-100">
        <details>
          <summary className="cursor-pointer select-none opacity-80">
            {message.trace?.toolName ? `Tool: ${String(message.trace.toolName)}` : 'Tool call'}
          </summary>
          <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap text-[10px] opacity-70">
            {messageText(message)}
          </pre>
        </details>
      </div>
    );
  }

  // system
  return (
    <div className="mx-auto max-w-[92%] rounded-xl border border-border/70 bg-muted px-3 py-2 text-center text-xs italic text-muted-foreground">
      {messageText(message)}
    </div>
  );
}

function InlineMedia({ items, align, className }: { items: MediaItem[]; align: 'start' | 'end'; className?: string }) {
  const images = items.filter((m) => m.kind === 'image');
  const audioFiles = items.filter((m) => m.kind === 'audio');
  const otherFiles = items.filter((m) => m.kind === 'file');

  return (
    <div className={cn('flex flex-col gap-1.5', align === 'end' ? 'items-end' : 'items-start', className)}>
      {images.length > 0 && (
        <div className={cn('grid gap-1', images.length === 1 ? 'grid-cols-1' : 'grid-cols-2', 'max-w-[260px]')}>
          {images.map((img) => (
            <a key={img.id} href={buildFileUrl(img.id)} target="_blank" rel="noopener noreferrer">
              <img
                src={buildFileUrl(img.id, 'thumbnail')}
                alt={img.filename}
                className="h-auto w-full rounded-lg object-cover"
                loading="lazy"
              />
            </a>
          ))}
        </div>
      )}

      {audioFiles.map((audio) => (
        <audio key={audio.id} controls className="max-w-[260px] h-8" preload="metadata">
          <source src={buildFileUrl(audio.id)} type={audio.content_type} />
        </audio>
      ))}

      {otherFiles.map((file) => (
        <a
          key={file.id}
          href={buildFileUrl(file.id)}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-2 rounded-lg border border-border/50 bg-muted/50 px-2.5 py-1.5 text-xs hover:bg-muted"
        >
          <span className="truncate max-w-[180px]">{file.filename}</span>
          <span className="shrink-0 text-muted-foreground">{formatBytes(file.byte_size)}</span>
        </a>
      ))}
    </div>
  );
}

function TypingDots() {
  return (
    <div className="flex items-center gap-1 py-2 px-1">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="h-1.5 w-1.5 rounded-full bg-muted-foreground animate-bounce"
          style={{ animationDelay: `${i * 150}ms` }}
        />
      ))}
    </div>
  );
}

function Timestamp({ date, className }: { date: string; className?: string }) {
  const formatted = new Date(date).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });

  return (
    <span className={cn('text-[10px] text-muted-foreground', className)}>
      {formatted}
    </span>
  );
}
