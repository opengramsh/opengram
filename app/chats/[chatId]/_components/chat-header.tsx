'use client';

import { type RefObject } from 'react';
import { ArrowLeft } from 'lucide-react';
import { Facehash } from 'facehash';

import type { Agent, Chat } from '@/app/chats/[chatId]/_lib/types';
import { Button } from '@/src/components/ui/button';
import { Input } from '@/src/components/ui/input';

type ChatHeaderProps = {
  chat: Chat | null;
  primaryAgent?: Agent;
  goBack: () => void;
  isEditingTitle: boolean;
  titleInput: string;
  titleError: string | null;
  titleInputRef: RefObject<HTMLInputElement | null>;
  setTitleInput: (value: string) => void;
  setIsEditingTitle: (value: boolean) => void;
  setTitleError: (value: string | null) => void;
  saveTitle: () => Promise<void>;
};

export function ChatHeader({
  chat,
  primaryAgent,
  goBack,
  isEditingTitle,
  titleInput,
  titleError,
  titleInputRef,
  setTitleInput,
  setIsEditingTitle,
  setTitleError,
  saveTitle,
}: ChatHeaderProps) {
  return (
    <header className="sticky top-0 z-30 border-b border-border/70 bg-background/95 px-3 py-2 backdrop-blur-md">
      <div className="grid grid-cols-[40px_1fr_auto] items-center gap-2">
        <Button
          variant="outline"
          size="icon"
          aria-label="Back"
          onClick={goBack}
        >
          <ArrowLeft size={16} />
        </Button>

        <div className="min-w-0 text-center">
          {isEditingTitle ? (
            <Input
              ref={titleInputRef}
              value={titleInput}
              onChange={(event) => setTitleInput(event.target.value)}
              onBlur={() => void saveTitle()}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  void saveTitle();
                }
                if (event.key === 'Escape') {
                  setTitleInput(chat?.title ?? '');
                  setIsEditingTitle(false);
                  setTitleError(null);
                }
              }}
              className="h-8 border-primary/50 text-center font-semibold"
              aria-label="Chat title"
            />
          ) : (
            <button
              type="button"
              className="max-w-full truncate text-sm font-semibold text-foreground"
              onClick={() => {
                setTitleInput(chat?.title ?? '');
                setTitleError(null);
                setIsEditingTitle(true);
              }}
            >
              {chat?.title || 'Chat'}
            </button>
          )}
          {titleError && <p className="truncate pt-0.5 text-[11px] text-red-300">{titleError}</p>}
        </div>

        <div className="flex min-w-0 items-center gap-2 rounded-xl border border-border bg-card px-2 py-1">
          <Facehash
            name={primaryAgent?.name ?? 'Unknown Agent'}
            size={26}
            interactive={false}
            className="rounded-lg text-black"
          />
          <p className="max-w-24 truncate text-xs text-muted-foreground">{primaryAgent?.name ?? 'Unknown Agent'}</p>
        </div>
      </div>
    </header>
  );
}
