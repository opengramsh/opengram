'use client';

import { type RefObject, useEffect, useRef } from 'react';
import { ArrowUp, Camera, FileText, Images, Mic, Plus, Trash2, X } from 'lucide-react';

import { isTouchDevice } from '@/src/lib/utils';
import { formatDuration } from '@/app/chats/[chatId]/_lib/chat-utils';
import type { Model, PendingAttachment } from '@/app/chats/[chatId]/_lib/types';
import { RecordingWaveform } from '@/app/chats/[chatId]/_components/recording-waveform';
import { Button } from '@/src/components/ui/button';
import {
  Drawer,
  DrawerContent,
  DrawerTitle,
} from '@/src/components/ui/drawer';
import { Textarea } from '@/src/components/ui/textarea';

type ChatComposerProps = {
  composerText: string;
  isSending: boolean;
  isComposerMenuOpen: boolean;
  selectedModelId: string;
  models: Model[];
  setComposerText: (value: string) => void;
  setIsComposerMenuOpen: (value: boolean) => void;
  sendMessage: () => Promise<void>;
  onModelChange: (modelId: string) => Promise<void>;
  handleMicAction: () => Promise<void>;
  stopRecording: () => void;
  cancelRecording: () => void;
  audioLevels: number[];
  isRecording: boolean;
  recordingSeconds: number;
  isUploadingVoiceNote: boolean;
  showMicSettingsPrompt: boolean;
  allAttachmentsReady: boolean;
  uploadComposerFiles: (files: FileList | null, forcedKind?: 'image' | 'file') => Promise<void>;
  pendingAttachments: PendingAttachment[];
  removePendingAttachment: (localId: string) => void;
  cameraInputRef: RefObject<HTMLInputElement | null>;
  photosInputRef: RefObject<HTMLInputElement | null>;
  filesInputRef: RefObject<HTMLInputElement | null>;
  keyboardOffset: number;
};

export function ChatComposer({
  composerText,
  isSending,
  isComposerMenuOpen,
  selectedModelId: _selectedModelId,
  models: _models,
  setComposerText,
  setIsComposerMenuOpen,
  sendMessage,
  onModelChange: _onModelChange,
  handleMicAction,
  stopRecording,
  cancelRecording,
  audioLevels,
  isRecording,
  recordingSeconds,
  isUploadingVoiceNote,
  showMicSettingsPrompt,
  allAttachmentsReady,
  uploadComposerFiles,
  pendingAttachments,
  removePendingAttachment,
  cameraInputRef,
  photosInputRef,
  filesInputRef,
  keyboardOffset,
}: ChatComposerProps) {
  const footerRef = useRef<HTMLElement | null>(null);

  /*
   * iOS Form Navigation Bar suppression.
   * The ↑↓ arrows appear when iOS detects multiple tabbable form elements.
   * We set tabindex=-1 on every focusable input outside the composer, and use
   * a MutationObserver to catch elements that mount after the composer (e.g.
   * request widget <select>, dynamically rendered inputs).
   */
  useEffect(() => {
    const FOCUSABLE = 'input, textarea, select, [contenteditable="true"]';
    const managed = new Map<HTMLElement, string | null>();

    const suppress = (el: HTMLElement) => {
      if (el.closest('[data-chat-composer-root="true"]')) return;
      if (managed.has(el)) return;
      managed.set(el, el.getAttribute('tabindex'));
      el.setAttribute('tabindex', '-1');
    };

    // Initial sweep
    for (const el of document.querySelectorAll<HTMLElement>(FOCUSABLE)) {
      suppress(el);
    }

    // Watch for dynamically added inputs
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (!(node instanceof HTMLElement)) continue;
          // Check the node itself
          if (node.matches(FOCUSABLE)) suppress(node);
          // Check descendants
          for (const child of node.querySelectorAll<HTMLElement>(FOCUSABLE)) {
            suppress(child);
          }
        }
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });

    return () => {
      observer.disconnect();
      for (const [element, previousTabIndex] of managed.entries()) {
        if (previousTabIndex === null) {
          element.removeAttribute('tabindex');
        } else {
          element.setAttribute('tabindex', previousTabIndex);
        }
      }
    };
  }, []);

  useEffect(() => {
    const footer = footerRef.current;
    if (!footer) {
      return;
    }

    const root = document.documentElement;
    const updateComposerHeight = () => {
      const composerHeight = Math.max(0, Math.ceil(footer.getBoundingClientRect().height));
      root.style.setProperty('--composer-height', `${composerHeight}px`);
    };

    updateComposerHeight();

    if (typeof ResizeObserver === 'undefined') {
      return () => {
        root.style.removeProperty('--composer-height');
      };
    }

    const observer = new ResizeObserver(() => {
      updateComposerHeight();
    });
    observer.observe(footer);

    return () => {
      observer.disconnect();
      root.style.removeProperty('--composer-height');
    };
  }, []);

  return (
    <>
      <footer
        ref={footerRef}
        data-chat-composer-root="true"
        className="kbd-safe-pb fixed inset-x-0 z-40 w-full border-t border-border/50 bg-background/95 backdrop-blur-md"
        style={{
          bottom: `${keyboardOffset}px`,
        }}
      >
        {!isRecording && pendingAttachments.length > 0 && (
          <div className="flex gap-2 overflow-x-auto px-3 pt-2 pb-1">
            {pendingAttachments.map((att) => (
              <div key={att.localId} className="relative shrink-0">
                {att.kind === 'image' && att.localPreviewUrl ? (
                  <img
                    src={att.localPreviewUrl}
                    alt={att.filename}
                    className="h-14 w-14 rounded-lg object-cover"
                  />
                ) : (
                  <div className="flex h-14 w-14 items-center justify-center rounded-lg bg-muted text-xs text-muted-foreground">
                    <FileText size={18} />
                  </div>
                )}
                {att.status === 'uploading' && (
                  <div className="absolute inset-0 flex items-center justify-center rounded-lg bg-black/40">
                    <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => removePendingAttachment(att.localId)}
                  className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-destructive text-destructive-foreground"
                >
                  <X size={12} />
                </button>
              </div>
            ))}
          </div>
        )}

        {isRecording ? (
          /* Recording mode: [Trash/Cancel] [Waveform + Timer] [Send] */
          <div className="flex items-center gap-2 px-3 py-2">
            <Button
              variant="outline"
              size="icon-lg"
              aria-label="Cancel recording"
              className="border-red-300/50 bg-red-500/20 text-red-400 hover:bg-red-500/30"
              onClick={cancelRecording}
            >
              <Trash2 size={18} />
            </Button>

            <div className="flex flex-1 items-center gap-2.5 overflow-hidden px-1">
              <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-red-500" />
              <RecordingWaveform levels={audioLevels} />
              <span className="shrink-0 text-xs tabular-nums text-red-300">
                {formatDuration(recordingSeconds)}
              </span>
            </div>

            <Button
              size="icon-lg"
              aria-label="Send voice note"
              onClick={stopRecording}
            >
              <ArrowUp size={18} />
            </Button>
          </div>
        ) : isUploadingVoiceNote ? (
          <div className="flex items-center justify-center px-3 py-3">
            <p className="text-[11px] text-muted-foreground">Sending voice note...</p>
          </div>
        ) : (
          /* Normal mode: [+] [Textarea] [Send] [Mic] */
          <div className="flex items-end gap-2 px-3 py-2">
            <Button
              variant="outline"
              size="icon-lg"
              aria-label="Open composer menu"
              onClick={() => setIsComposerMenuOpen(true)}
            >
              <Plus size={18} />
            </Button>

            <Textarea
              rows={1}
              value={composerText}
              onChange={(event) => setComposerText(event.target.value)}
              placeholder="Message"
              autoComplete="off"
              inputMode="text"
              enterKeyHint="send"
              className="max-h-36 min-h-11 flex-1 resize-none rounded-2xl border-0 bg-transparent px-3 py-2.5 text-sm shadow-none focus-visible:ring-0"
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey && !isTouchDevice() && (composerText.trim() || pendingAttachments.length > 0)) {
                  event.preventDefault();
                  void sendMessage();
                }
              }}
            />

            <Button
              size="icon-lg"
              aria-label="Send message"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => void sendMessage()}
              disabled={isSending || !allAttachmentsReady || (!composerText.trim() && pendingAttachments.length === 0)}
            >
              <ArrowUp size={16} />
            </Button>

            <Button
              variant="outline"
              size="icon-lg"
              aria-label="Record voice note"
              onClick={() => void handleMicAction()}
              disabled={isUploadingVoiceNote}
            >
              <Mic size={16} />
            </Button>
          </div>
        )}
        {showMicSettingsPrompt && (
          <div className="mx-3 mb-2 rounded-lg border border-amber-400/40 bg-amber-500/10 px-2 py-1.5 text-[11px] text-amber-100">
            <p>Microphone access is blocked. Enable it in your browser or OS settings for this site.</p>
            <Button
              variant="outline"
              size="xs"
              className="mt-1 border-amber-200/40 text-amber-50"
              onClick={() => void handleMicAction()}
            >
              Retry microphone access
            </Button>
          </div>
        )}
        {/* tabIndex={-1} removes these from iOS form navigation, suppressing the ↑↓✓ accessory bar */}
        <input
          ref={cameraInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          tabIndex={-1}
          onChange={(event) => {
            void uploadComposerFiles(event.currentTarget.files, 'image').finally(() => {
              event.currentTarget.value = '';
            });
          }}
        />
        <input
          ref={photosInputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          tabIndex={-1}
          onChange={(event) => {
            void uploadComposerFiles(event.currentTarget.files, 'image').finally(() => {
              event.currentTarget.value = '';
            });
          }}
        />
        <input
          ref={filesInputRef}
          type="file"
          multiple
          className="hidden"
          tabIndex={-1}
          onChange={(event) => {
            void uploadComposerFiles(event.currentTarget.files).finally(() => {
              event.currentTarget.value = '';
            });
          }}
        />
      </footer>

      {/* Composer Menu */}
      <Drawer open={isComposerMenuOpen} onOpenChange={setIsComposerMenuOpen}>
        <DrawerContent className="pb-safe px-4 pb-5 pt-3">
          <DrawerTitle className="sr-only">Composer menu</DrawerTitle>

          {/* Attachment buttons */}
          <div className="flex gap-3 pt-2">
            <button
              type="button"
              className="flex flex-col items-center justify-center gap-2 rounded-2xl border border-border bg-muted/60 px-5 py-4 transition active:scale-95 disabled:opacity-50"
              onClick={() => { setIsComposerMenuOpen(false); filesInputRef.current?.click(); }}
            >
              <div className="flex size-10 items-center justify-center rounded-full bg-primary/15">
                <FileText size={20} className="text-primary" />
              </div>
              <span className="text-xs font-medium text-foreground">Files</span>
            </button>

            <button
              type="button"
              className="flex flex-col items-center justify-center gap-2 rounded-2xl border border-border bg-muted/60 px-5 py-4 transition active:scale-95 disabled:opacity-50"
              onClick={() => { setIsComposerMenuOpen(false); cameraInputRef.current?.click(); }}
            >
              <div className="flex size-10 items-center justify-center rounded-full bg-primary/15">
                <Camera size={20} className="text-primary" />
              </div>
              <span className="text-xs font-medium text-foreground">Camera</span>
            </button>

            <button
              type="button"
              className="flex flex-col items-center justify-center gap-2 rounded-2xl border border-border bg-muted/60 px-5 py-4 transition active:scale-95 disabled:opacity-50"
              onClick={() => { setIsComposerMenuOpen(false); photosInputRef.current?.click(); }}
            >
              <div className="flex size-10 items-center justify-center rounded-full bg-primary/15">
                <Images size={20} className="text-primary" />
              </div>
              <span className="text-xs font-medium text-foreground">Photos</span>
            </button>
          </div>

          {!allAttachmentsReady && <p className="pt-2 text-xs text-muted-foreground">Uploading attachment…</p>}
        </DrawerContent>
      </Drawer>
    </>
  );
}
