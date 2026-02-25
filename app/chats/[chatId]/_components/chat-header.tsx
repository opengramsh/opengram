'use client';

import { ArrowLeft, SquarePen } from 'lucide-react';
import { Facehash } from 'facehash';
import { useNavigate } from 'react-router';

import type { Agent, Chat } from '@/app/chats/[chatId]/_lib/types';
import { Button } from '@/src/components/ui/button';
import { FACEHASH_COLORS } from '@/src/lib/utils';

function Spinner() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 14 14"
      fill="none"
      style={{ animation: 'spin 0.8s linear infinite' }}
    >
      <circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="2" opacity="0.25" />
      <path d="M12.5 7a5.5 5.5 0 0 0-5.5-5.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

type ChatHeaderProps = {
  chat: Chat | null;
  primaryAgent?: Agent;
  isStreaming?: boolean;
  typingTitle?: string | null;
  goBack: () => void;
  onTitleClick: () => void;
};

export function ChatHeader({
  chat,
  primaryAgent,
  isStreaming,
  typingTitle,
  goBack,
  onTitleClick,
}: ChatHeaderProps) {
  const navigate = useNavigate();

  return (
    <header className="facehash-hover-group sticky top-0 z-30 h-[61px] border-b border-border/70 bg-background/95 px-3 py-3 backdrop-blur-md">
      <div className="flex items-center gap-3">
        <Button
          variant="outline"
          size="icon"
          aria-label="Back"
          onClick={goBack}
          className="md:hidden"
        >
          <ArrowLeft size={16} />
        </Button>

        <button type="button" onClick={onTitleClick} className="shrink-0 cursor-pointer">
          <Facehash
            name={primaryAgent?.name ?? 'Unknown Agent'}
            size={36}
            interactive
            colors={FACEHASH_COLORS}
            intensity3d="dramatic"
            variant="gradient"
            gradientOverlayClass="facehash-gradient"
            className="rounded-full text-black"
            enableBlink={isStreaming}
            onRenderMouth={isStreaming ? () => <Spinner /> : undefined}
          />
        </button>

        <button
          type="button"
          className="min-w-0 flex-1 cursor-pointer text-left"
          onClick={onTitleClick}
        >
          <p className="truncate text-sm font-semibold leading-5 text-foreground">
            {typingTitle != null ? (
              <>{typingTitle}<span className="animate-pulse opacity-70">|</span></>
            ) : (
              chat?.title || 'Chat'
            )}
          </p>
          <p className="truncate text-[11px] font-semibold tracking-wide text-primary/60">
            {primaryAgent?.name ?? 'Unknown Agent'}{isStreaming ? ' · typing...' : ''}
          </p>
        </button>

        <Button
          variant="outline"
          size="icon"
          aria-label="New chat"
          onClick={() => {
            const params = new URLSearchParams();
            if (chat?.agent_ids[0]) params.set('agentId', chat.agent_ids[0]);
            if (chat?.model_id) params.set('modelId', chat.model_id);
            navigate(`/chats/new?${params.toString()}`);
          }}
        >
          <SquarePen size={16} />
        </Button>
      </div>
    </header>
  );
}
