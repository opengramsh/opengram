'use client';

import { type RefObject } from 'react';
import { Archive, BellOff, Bell, ChevronRight, GalleryVerticalEnd } from 'lucide-react';

import type { Chat } from '@/app/chats/[chatId]/_lib/types';
import { Input } from '@/src/components/ui/input';
import {
  Drawer,
  DrawerContent,
  DrawerTitle,
} from '@/src/components/ui/drawer';

type ChatMenuProps = {
  isOpen: boolean;
  setIsOpen: (value: boolean) => void;
  chat: Chat | null;
  customStates: string[];
  isUpdatingChatSettings: boolean;
  titleInput: string;
  titleInputRef: RefObject<HTMLInputElement | null>;
  setTitleInput: (value: string) => void;
  saveTitle: () => Promise<void>;
  patchChatSettings: (payload: { customState?: string; notificationsMuted?: boolean }) => Promise<void>;
  archiveCurrentChat: () => Promise<void>;
  unarchiveCurrentChat: () => Promise<void>;
  setIsMediaGalleryOpen: (value: boolean) => void;
};

export function ChatMenu({
  isOpen,
  setIsOpen,
  chat,
  customStates,
  isUpdatingChatSettings,
  titleInput,
  titleInputRef,
  setTitleInput,
  saveTitle,
  patchChatSettings,
  archiveCurrentChat,
  unarchiveCurrentChat,
  setIsMediaGalleryOpen,
}: ChatMenuProps) {
  if (!chat) return null;

  return (
    <Drawer open={isOpen} onOpenChange={setIsOpen}>
      <DrawerContent className="liquid-glass max-h-[82dvh] overflow-y-auto border-x border-t border-border px-4 pb-5 pt-3">
        <DrawerTitle className="sr-only">Chat menu</DrawerTitle>

        <div className="space-y-1 pt-1">
          {/* Chat name (editable) */}
          <div className="rounded-2xl border border-border bg-muted/40 px-4 py-3">
            <p className="pb-1 text-[11px] font-medium text-muted-foreground">Chat name</p>
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
              }}
              className="h-8 border-none bg-transparent p-0 text-sm font-semibold text-foreground shadow-none focus-visible:ring-0"
              aria-label="Chat name"
            />
          </div>

          {/* Status (custom_state) */}
          {customStates.length > 0 && (
            <div className="rounded-2xl border border-border bg-muted/40 px-4 py-3">
              <p className="pb-1 text-[11px] font-medium text-muted-foreground">Status</p>
              <select
                className="h-8 w-full rounded-lg border-none bg-transparent p-0 text-sm font-semibold text-foreground outline-none disabled:opacity-60"
                value={chat.custom_state ?? customStates[0] ?? ''}
                disabled={isUpdatingChatSettings}
                onChange={(event) => {
                  void patchChatSettings({ customState: event.target.value });
                }}
              >
                {customStates.map((state) => (
                  <option key={state} value={state}>
                    {state}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Media */}
          <button
            type="button"
            className="flex w-full items-center gap-3 rounded-2xl border border-border bg-muted/40 px-4 py-3.5 text-left transition active:scale-[0.98]"
            onClick={() => {
              setIsOpen(false);
              setIsMediaGalleryOpen(true);
            }}
          >
            <GalleryVerticalEnd size={18} className="shrink-0 text-muted-foreground" />
            <span className="flex-1 text-sm font-medium text-foreground">Media</span>
            <ChevronRight size={16} className="shrink-0 text-muted-foreground" />
          </button>

          {/* Mute / Unmute */}
          <button
            type="button"
            className="flex w-full items-center gap-3 rounded-2xl border border-border bg-muted/40 px-4 py-3.5 text-left transition active:scale-[0.98] disabled:opacity-50"
            disabled={isUpdatingChatSettings}
            onClick={() => {
              void patchChatSettings({ notificationsMuted: !chat.notifications_muted });
            }}
          >
            {chat.notifications_muted ? (
              <Bell size={18} className="shrink-0 text-muted-foreground" />
            ) : (
              <BellOff size={18} className="shrink-0 text-muted-foreground" />
            )}
            <span className="flex-1 text-sm font-medium text-foreground">
              {chat.notifications_muted ? 'Unmute notifications' : 'Mute notifications'}
            </span>
          </button>

          {/* Archive */}
          <button
            type="button"
            className="flex w-full items-center gap-3 rounded-2xl border border-border bg-muted/40 px-4 py-3.5 text-left transition active:scale-[0.98] disabled:opacity-50"
            disabled={isUpdatingChatSettings}
            onClick={() => {
              setIsOpen(false);
              if (chat.is_archived) {
                void unarchiveCurrentChat();
              } else {
                void archiveCurrentChat();
              }
            }}
          >
            <Archive size={18} className="shrink-0 text-red-400" />
            <span className="flex-1 text-sm font-medium text-red-400">
              {chat.is_archived ? 'Unarchive chat' : 'Archive chat'}
            </span>
          </button>
        </div>
      </DrawerContent>
    </Drawer>
  );
}
