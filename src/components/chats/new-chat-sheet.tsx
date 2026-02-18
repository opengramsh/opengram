'use client';

import { useEffect, useId, useRef } from 'react';
import { Facehash } from 'facehash';

import type { Agent, Model } from '@/src/components/chats/types';

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

const FOCUSABLE_SELECTOR =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

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
  const titleId = useId();
  const descriptionId = useId();
  const previouslyFocusedElementRef = useRef<HTMLElement | null>(null);
  const firstAgentButtonRef = useRef<HTMLButtonElement | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }

    previouslyFocusedElementRef.current = document.activeElement as HTMLElement | null;
    firstAgentButtonRef.current?.focus();
    if (!firstAgentButtonRef.current) {
      dialogRef.current?.focus();
    }

    function onEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        onClose();
        return;
      }

      if (event.key !== 'Tab' || !dialogRef.current) {
        return;
      }

      const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
      if (focusable.length === 0) {
        event.preventDefault();
        dialogRef.current.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const activeElement = document.activeElement as HTMLElement | null;

      if (event.shiftKey && (activeElement === first || activeElement === dialogRef.current)) {
        event.preventDefault();
        last.focus();
        return;
      }

      if (!event.shiftKey && activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    window.addEventListener('keydown', onEscape);
    return () => {
      window.removeEventListener('keydown', onEscape);
      previouslyFocusedElementRef.current?.focus();
    };
  }, [onClose, open]);

  if (!open) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/50" onClick={onClose}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        tabIndex={-1}
        className="liquid-glass absolute inset-x-0 bottom-0 rounded-t-3xl border-x border-t border-border p-4"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 id={titleId} className="text-sm font-semibold text-foreground">
          New Chat
        </h2>
        <p id={descriptionId} className="mt-1 text-xs text-muted-foreground">
          Choose an agent and model, then send your first message.
        </p>
        <div className="mt-4 space-y-3">
          <div>
            <p className="mb-1 text-xs font-medium text-muted-foreground">Agent</p>
            <div className="space-y-2">
              {agents.map((agent, index) => {
                const selected = selectedAgentId === agent.id;
                return (
                  <button
                    key={agent.id}
                    ref={index === 0 ? firstAgentButtonRef : null}
                    type="button"
                    className={`flex w-full items-center gap-3 rounded-xl border px-3 py-2 text-left transition ${
                      selected ? 'border-primary/70 bg-primary/10' : 'border-border bg-card hover:border-primary/40'
                    }`}
                    onClick={() => onSelectAgent(agent.id)}
                  >
                    <Facehash name={agent.id} size={34} interactive={false} className="shrink-0 rounded-lg text-black" />
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium text-foreground">{agent.name}</span>
                      <span className="line-clamp-2 text-xs text-muted-foreground">{agent.description}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-muted-foreground">Model</span>
            <select
              className="h-10 w-full rounded-xl border border-border bg-card px-3 text-sm text-foreground outline-none focus:border-primary/70"
              value={selectedModelId}
              onChange={(event) => onSelectModel(event.target.value)}
            >
              {models.map((model) => (
                <option key={model.id} value={model.id}>
                  {model.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-muted-foreground">First message</span>
            <textarea
              rows={3}
              value={firstMessage}
              onChange={(event) => onChangeFirstMessage(event.target.value)}
              className="w-full rounded-xl border border-border bg-card px-3 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-primary/70"
              placeholder="Start with a message..."
            />
          </label>
          {error && <p className="text-xs text-red-300">{error}</p>}
          <div className="flex gap-2">
            <button
              type="button"
              className="h-10 flex-1 rounded-xl border border-border bg-card text-sm font-medium text-foreground"
              onClick={onClose}
              disabled={isSubmitting}
            >
              Cancel
            </button>
            <button
              type="button"
              className="h-10 flex-1 rounded-xl bg-primary text-sm font-semibold text-primary-foreground disabled:opacity-60"
              onClick={onSubmit}
              disabled={isSubmitting || !canSubmit}
            >
              {isSubmitting ? 'Sending...' : 'Send'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
