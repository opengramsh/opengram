'use client';

import { Facehash } from 'facehash';

import type { Agent, Model } from '@/src/components/chats/types';
import { FACEHASH_COLORS } from '@/src/lib/utils';
import { Button } from '@/src/components/ui/button';
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerTitle,
} from '@/src/components/ui/drawer';
import { Label } from '@/src/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/src/components/ui/select';
import { Textarea } from '@/src/components/ui/textarea';

type NewChatSheetProps = {
  open: boolean;
  agents: Agent[];
  models: Model[];
  selectedAgentId: string;
  selectedModelId: string;
  firstMessage: string;
  error: string | null;
  isSubmitting: boolean;
  canSubmit: boolean;
  onClose: () => void;
  onSelectAgent: (agentId: string) => void;
  onSelectModel: (modelId: string) => void;
  onChangeFirstMessage: (value: string) => void;
  onSubmit: () => void;
};

export function NewChatSheet({
  open,
  agents,
  models,
  selectedAgentId,
  selectedModelId,
  firstMessage,
  error,
  isSubmitting,
  canSubmit,
  onClose,
  onSelectAgent,
  onSelectModel,
  onChangeFirstMessage,
  onSubmit,
}: NewChatSheetProps) {
  return (
    <Drawer open={open} onOpenChange={(isOpen) => { if (!isOpen) onClose(); }}>
      <DrawerContent className="liquid-glass border-x border-t border-border px-4 pb-4 pt-3">
        <DrawerTitle className="text-sm">New Chat</DrawerTitle>
        <DrawerDescription className="text-xs text-muted-foreground">
          Choose an agent and model, then send your first message.
        </DrawerDescription>
        <div className="mt-4 space-y-3">
          <div>
            <Label className="mb-1 text-xs text-muted-foreground">Agent</Label>
            <div className="space-y-2">
              {agents.map((agent) => {
                const selected = selectedAgentId === agent.id;
                return (
                  <button
                    key={agent.id}
                    type="button"
                    className={`flex w-full items-center gap-3 rounded-xl border px-3 py-2 text-left transition ${
                      selected ? 'border-primary/70 bg-primary/10' : 'border-border bg-card hover:border-primary/40'
                    }`}
                    onClick={() => onSelectAgent(agent.id)}
                  >
                    <Facehash name={agent.id} size={34} interactive colors={FACEHASH_COLORS} intensity3d="dramatic" variant="gradient" gradientOverlayClass="facehash-gradient" className="shrink-0 rounded-lg text-black" />
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium text-foreground">{agent.name}</span>
                      <span className="line-clamp-2 text-xs text-muted-foreground">{agent.description}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
          <div>
            <Label className="mb-1 text-xs text-muted-foreground">Model</Label>
            <Select value={selectedModelId} onValueChange={onSelectModel}>
              <SelectTrigger className="h-10 rounded-xl">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {models.map((model) => (
                  <SelectItem key={model.id} value={model.id}>
                    {model.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="mb-1 text-xs text-muted-foreground">First message</Label>
            <Textarea
              rows={3}
              value={firstMessage}
              onChange={(event) => onChangeFirstMessage(event.target.value)}
              className="min-h-0"
              placeholder="Start with a message..."
            />
          </div>
          {error && <p className="text-xs text-red-300">{error}</p>}
          <div className="flex gap-2">
            <Button
              variant="outline"
              className="h-10 flex-1"
              onClick={onClose}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button
              className="h-10 flex-1 font-semibold"
              onClick={onSubmit}
              disabled={isSubmitting || !canSubmit}
            >
              {isSubmitting ? 'Sending...' : 'Send'}
            </Button>
          </div>
        </div>
      </DrawerContent>
    </Drawer>
  );
}
