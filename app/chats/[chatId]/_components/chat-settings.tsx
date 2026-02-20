'use client';

import type { Chat, Model, TagSuggestion } from '@/app/chats/[chatId]/_lib/types';
import { Badge } from '@/src/components/ui/badge';
import { Button } from '@/src/components/ui/button';
import {
  Drawer,
  DrawerContent,
  DrawerTitle,
} from '@/src/components/ui/drawer';
import { Input } from '@/src/components/ui/input';
import { Label } from '@/src/components/ui/label';

type ChatSettingsProps = {
  isChatSettingsOpen: boolean;
  chat: Chat | null;
  models: Model[];
  customStates: string[];
  isUpdatingChatSettings: boolean;
  tagInput: string;
  tagSuggestions: TagSuggestion[];
  isLoadingTagSuggestions: boolean;
  setIsChatSettingsOpen: (value: boolean) => void;
  patchChatSettings: (payload: { modelId?: string; tags?: string[]; customState?: string; pinned?: boolean }) => Promise<void>;
  setTagInput: (value: string) => void;
  addTagToChat: (rawTag: string) => Promise<void>;
  removeTagFromChat: (tag: string) => Promise<void>;
  archiveCurrentChat: () => Promise<void>;
  unarchiveCurrentChat: () => Promise<void>;
};

export function ChatSettings({
  isChatSettingsOpen,
  chat,
  models,
  customStates,
  isUpdatingChatSettings,
  tagInput,
  tagSuggestions,
  isLoadingTagSuggestions,
  setIsChatSettingsOpen,
  patchChatSettings,
  setTagInput,
  addTagToChat,
  removeTagFromChat,
  archiveCurrentChat,
  unarchiveCurrentChat,
}: ChatSettingsProps) {
  if (!chat) {
    return null;
  }

  return (
    <Drawer open={isChatSettingsOpen} onOpenChange={setIsChatSettingsOpen}>
      <DrawerContent className="liquid-glass max-h-[82dvh] overflow-y-auto border-x border-t border-border px-4 pb-4 pt-3">
        <div className="flex items-center justify-between pb-3">
          <DrawerTitle className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Chat settings</DrawerTitle>
        </div>

        <div className="space-y-3">
          <div>
            <Label className="mb-1 text-xs text-muted-foreground">Model</Label>
            <select
              className="h-10 w-full rounded-xl border border-border bg-card px-3 text-sm text-foreground outline-none focus:border-primary/70 disabled:opacity-60"
              value={chat.model_id}
              disabled={isUpdatingChatSettings}
              onChange={(event) => {
                void patchChatSettings({ modelId: event.target.value });
              }}
            >
              {models.map((model) => (
                <option key={model.id} value={model.id}>
                  {model.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <Label className="mb-1 text-xs text-muted-foreground">Tags</Label>
            <div className="mb-2 flex flex-wrap gap-1">
              {chat.tags.map((tag) => (
                <Badge
                  key={tag}
                  variant="outline"
                  className="cursor-pointer disabled:opacity-60"
                  role="button"
                  tabIndex={0}
                  onClick={() => { if (!isUpdatingChatSettings) void removeTagFromChat(tag); }}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (!isUpdatingChatSettings) void removeTagFromChat(tag); } }}
                >
                  {tag} &times;
                </Badge>
              ))}
              {chat.tags.length === 0 && <p className="text-xs text-muted-foreground">No tags yet.</p>}
            </div>
            <Input
              value={tagInput}
              onChange={(event) => setTagInput(event.target.value)}
              placeholder="Add tag and press Enter"
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ',') {
                  event.preventDefault();
                  void addTagToChat(tagInput);
                }
              }}
            />
            {isLoadingTagSuggestions && <p className="pt-1 text-xs text-muted-foreground">Loading suggestions...</p>}
            {tagSuggestions.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1">
                {tagSuggestions.map((suggestion) => (
                  <Badge
                    key={suggestion.name}
                    variant="outline"
                    className="cursor-pointer text-muted-foreground hover:text-foreground"
                    role="button"
                    tabIndex={0}
                    onClick={() => void addTagToChat(suggestion.name)}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); void addTagToChat(suggestion.name); } }}
                  >
                    {suggestion.name}
                  </Badge>
                ))}
              </div>
            )}
          </div>

          {customStates.length > 0 && (
            <div>
              <Label className="mb-1 text-xs text-muted-foreground">State</Label>
              <select
                className="h-10 w-full rounded-xl border border-border bg-card px-3 text-sm text-foreground outline-none focus:border-primary/70 disabled:opacity-60"
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

          <div className="grid grid-cols-2 gap-2 pt-1">
            <Button
              variant="outline"
              disabled={isUpdatingChatSettings}
              onClick={() => {
                void patchChatSettings({ pinned: !chat.pinned });
              }}
            >
              {chat.pinned ? 'Unpin' : 'Pin'}
            </Button>
            <Button
              variant="outline"
              disabled={isUpdatingChatSettings}
              onClick={() => {
                if (chat.is_archived) {
                  void unarchiveCurrentChat();
                } else {
                  void archiveCurrentChat();
                }
              }}
            >
              {chat.is_archived ? 'Unarchive' : 'Archive'}
            </Button>
          </div>
        </div>
      </DrawerContent>
    </Drawer>
  );
}
