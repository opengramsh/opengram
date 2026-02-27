import { ArrowLeft, EllipsisVertical, ImageIcon, Settings, BookmarkCheck } from 'lucide-react';
import { Facehash } from 'facehash';

import { Button } from '@/src/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/src/components/ui/dropdown-menu';
import { FACEHASH_COLORS } from '@/src/lib/utils';
import { useChatV2Context } from './chat-v2-provider';

export function ChatV2Header() {
  const { data, send } = useChatV2Context();
  const { chat, primaryAgent, typingTitle, goBack } = data;
  const isStreaming = send.isStreaming || data.pendingReply;

  const displayTitle = typingTitle ?? chat?.title ?? 'Chat';
  const subtitle = primaryAgent?.name ?? '';

  if (!chat && data.loading) {
    return (
      <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-border/50 bg-background/95 px-3 backdrop-blur-md">
        <div className="h-8 w-8 animate-pulse rounded-full bg-muted" />
        <div className="flex flex-1 flex-col gap-1">
          <div className="h-4 w-32 animate-pulse rounded bg-muted" />
          <div className="h-3 w-20 animate-pulse rounded bg-muted" />
        </div>
      </header>
    );
  }

  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-border/50 bg-background/95 px-3 backdrop-blur-md">
      {/* Back button (mobile only) */}
      <Button
        variant="ghost"
        size="icon-sm"
        className="md:hidden"
        onClick={goBack}
      >
        <ArrowLeft size={20} />
      </Button>

      {/* Agent avatar */}
      <div className="relative h-8 w-8 shrink-0">
        <Facehash
          name={primaryAgent?.id ?? chat?.id ?? ''}
          size={32}
          colors={FACEHASH_COLORS}
        />
        {isStreaming && (
          <span className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-emerald-400 ring-2 ring-background animate-pulse" />
        )}
      </div>

      {/* Title area */}
      <div className="flex flex-1 flex-col overflow-hidden">
        <span className="truncate text-sm font-medium leading-tight">
          {displayTitle}
          {typingTitle !== null && (
            <span className="ml-0.5 inline-block h-3 w-[2px] animate-pulse bg-foreground" />
          )}
        </span>
        {subtitle && (
          <span className="truncate text-xs text-muted-foreground leading-tight">
            {subtitle}
            {isStreaming && <span className="ml-1 text-emerald-400">· typing...</span>}
          </span>
        )}
      </div>

      {/* Menu */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-sm">
            <EllipsisVertical size={18} />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => data.setIsChatSettingsOpen(true)}>
            <Settings size={14} className="mr-2" />
            Settings
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => data.setIsMediaGalleryOpen(true)}>
            <ImageIcon size={14} className="mr-2" />
            Media gallery
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => data.markRead()}>
            <BookmarkCheck size={14} className="mr-2" />
            Mark read
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </header>
  );
}
