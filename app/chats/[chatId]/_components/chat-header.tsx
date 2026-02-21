'use client';

import { ArrowLeft, SquarePen } from 'lucide-react';
import { Facehash } from 'facehash';
import { useNavigate } from 'react-router';

import type { Agent, Chat } from '@/app/chats/[chatId]/_lib/types';
import { Button } from '@/src/components/ui/button';

type ChatHeaderProps = {
  chat: Chat | null;
  primaryAgent?: Agent;
  goBack: () => void;
  onTitleClick: () => void;
};

export function ChatHeader({
  chat,
  primaryAgent,
  goBack,
  onTitleClick,
}: ChatHeaderProps) {
  const navigate = useNavigate();

  return (
    <header className="sticky top-0 z-30 h-[61px] border-b border-border/70 bg-background/95 px-3 py-3 backdrop-blur-md">
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

        <button type="button" onClick={onTitleClick} className="shrink-0">
          <Facehash
            name={primaryAgent?.name ?? 'Unknown Agent'}
            size={36}
            interactive={false}
            className="rounded-xl text-black"
          />
        </button>

        <button
          type="button"
          className="min-w-0 flex-1 text-left"
          onClick={onTitleClick}
        >
          <p className="truncate text-sm font-semibold leading-5 text-foreground">
            {chat?.title || 'Chat'}
          </p>
          <p className="truncate text-[11px] font-semibold tracking-wide text-primary/60">
            {primaryAgent?.name ?? 'Unknown Agent'}
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
