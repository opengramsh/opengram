'use client';

import { type RefObject, useState } from 'react';
import { Camera, FileText, Images, Mic, Plus, Send, Square, X } from 'lucide-react';

import { formatDuration } from '@/app/chats/[chatId]/_lib/chat-utils';
import type { MediaItem, Model } from '@/app/chats/[chatId]/_lib/types';
import { Button } from '@/src/components/ui/button';
import {
  Drawer,
  DrawerContent,
  DrawerTitle,
} from '@/src/components/ui/drawer';
import { Textarea } from '@/src/components/ui/textarea';

type ChatComposerProps = {
  keyboardOffset: number;
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
  isRecording: boolean;
  recordingSeconds: number;
  isUploadingVoiceNote: boolean;
  showMicSettingsPrompt: boolean;
  isUploadingAttachment: boolean;
  uploadComposerFiles: (files: FileList | null, forcedKind?: 'image' | 'file') => Promise<void>;
  pendingAttachments: MediaItem[];
  removePendingAttachment: (mediaId: string) => void;
  cameraInputRef: RefObject<HTMLInputElement | null>;
  photosInputRef: RefObject<HTMLInputElement | null>;
  filesInputRef: RefObject<HTMLInputElement | null>;
  onCameraCapture: () => void;
};

export function ChatComposer({
  keyboardOffset,
  composerText,
  isSending,
  isComposerMenuOpen,
  selectedModelId,
  models,
  setComposerText,
  setIsComposerMenuOpen,
  sendMessage,
  onModelChange,
  handleMicAction,
  isRecording,
  recordingSeconds,
  isUploadingVoiceNote,
  showMicSettingsPrompt,
  isUploadingAttachment,
  uploadComposerFiles,
  pendingAttachments,
  removePendingAttachment,
  cameraInputRef,
  photosInputRef,
  filesInputRef,
  onCameraCapture,
}: ChatComposerProps) {
  // const [isModelPickerOpen, setIsModelPickerOpen] = useState(false);
  // const currentModel = models.find((m) => m.id === selectedModelId);

  return (
    <>
      <footer
        className="liquid-glass fixed inset-x-0 bottom-0 z-40 w-full px-3 pt-3"
        style={{ paddingBottom: `calc(12px + env(safe-area-inset-bottom, 0px) + ${keyboardOffset}px)` }}
      >
        {pendingAttachments.length > 0 && (
          <div className="mb-2 overflow-x-auto">
            <div className="flex gap-2 pb-1">
              {pendingAttachments.map((att) => (
                <div key={att.id} className="relative shrink-0">
                  {att.kind === 'image' ? (
                    <img
                      src={`/api/v1/files/${att.id}`}
                      alt={att.filename}
                      className="h-16 w-16 rounded-xl object-cover border border-border"
                    />
                  ) : (
                    <div className="flex h-16 w-32 items-center justify-center rounded-xl border border-border bg-muted/60 px-2">
                      <FileText size={16} className="shrink-0 text-muted-foreground" />
                      <span className="ml-1.5 truncate text-xs text-foreground">{att.filename}</span>
                    </div>
                  )}
                  <Button
                    variant="outline"
                    size="icon"
                    className="absolute -right-1.5 -top-1.5 h-5 w-5 rounded-full border-border bg-background p-0"
                    onClick={() => removePendingAttachment(att.id)}
                  >
                    <X size={10} />
                  </Button>
                </div>
              ))}
            </div>
          </div>
        )}
        <div className="flex items-end gap-2">
          <Button
            variant="outline"
            size="icon-xl"
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
            className="max-h-36 min-h-11 flex-1 resize-none rounded-2xl px-3 py-2.5"
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey && (composerText.trim() || pendingAttachments.length > 0)) {
                event.preventDefault();
                void sendMessage();
              }
            }}
          />

          <Button
            size="icon-xl"
            aria-label="Send message"
            onClick={() => void sendMessage()}
            disabled={isSending || (!composerText.trim() && pendingAttachments.length === 0)}
          >
            <Send size={16} />
          </Button>

          <Button
            variant="outline"
            size="icon-xl"
            aria-label="Record voice note"
            className={isRecording ? 'border-red-300 bg-red-500/20 text-red-50' : ''}
            onClick={() => void handleMicAction()}
            disabled={isUploadingVoiceNote}
          >
            {isRecording ? <Square size={16} /> : <Mic size={16} />}
          </Button>
        </div>
        {isRecording && <p className="px-1 pt-1 text-[11px] text-red-200">Recording {formatDuration(recordingSeconds)}</p>}
        {isUploadingVoiceNote && <p className="px-1 pt-1 text-[11px] text-muted-foreground">Uploading voice note...</p>}
        {showMicSettingsPrompt && (
          <div className="mt-1 rounded-lg border border-amber-400/40 bg-amber-500/10 px-2 py-1.5 text-[11px] text-amber-100">
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
        <input
          ref={cameraInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
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
          onChange={(event) => {
            void uploadComposerFiles(event.currentTarget.files).finally(() => {
              event.currentTarget.value = '';
            });
          }}
        />
      </footer>

      {/* Composer Menu */}
      <Drawer open={isComposerMenuOpen} onOpenChange={setIsComposerMenuOpen}>
        <DrawerContent className="liquid-glass border-x border-t border-border px-4 pb-5 pt-3">
          <DrawerTitle className="sr-only">Composer menu</DrawerTitle>

          {/* Attachment buttons */}
          <div className="flex gap-3 pt-2">
            <button
              type="button"
              className="flex flex-col items-center justify-center gap-2 rounded-2xl border border-border bg-muted/60 px-5 py-4 transition active:scale-95 disabled:opacity-50"
              disabled={isUploadingAttachment}
              onClick={() => filesInputRef.current?.click()}
            >
              <div className="flex size-10 items-center justify-center rounded-full bg-primary/15">
                <FileText size={20} className="text-primary" />
              </div>
              <span className="text-xs font-medium text-foreground">Files</span>
            </button>

            <button
              type="button"
              className="flex flex-col items-center justify-center gap-2 rounded-2xl border border-border bg-muted/60 px-5 py-4 transition active:scale-95 disabled:opacity-50"
              disabled={isUploadingAttachment}
              onClick={() => {
                setIsComposerMenuOpen(false);
                onCameraCapture();
              }}
            >
              <div className="flex size-10 items-center justify-center rounded-full bg-primary/15">
                <Camera size={20} className="text-primary" />
              </div>
              <span className="text-xs font-medium text-foreground">Camera</span>
            </button>

            <button
              type="button"
              className="flex flex-col items-center justify-center gap-2 rounded-2xl border border-border bg-muted/60 px-5 py-4 transition active:scale-95 disabled:opacity-50"
              disabled={isUploadingAttachment}
              onClick={() => photosInputRef.current?.click()}
            >
              <div className="flex size-10 items-center justify-center rounded-full bg-primary/15">
                <Images size={20} className="text-primary" />
              </div>
              <span className="text-xs font-medium text-foreground">Photos</span>
            </button>
          </div>

          {/* Model selector — commented out while feature is disabled
          <button
            type="button"
            className="mt-3 flex w-full items-center justify-between rounded-2xl border border-border bg-muted/60 px-4 py-3 transition active:scale-[0.98]"
            onClick={() => {
              setIsComposerMenuOpen(false);
              setIsModelPickerOpen(true);
            }}
          >
            <div className="min-w-0">
              <p className="text-[11px] font-medium text-muted-foreground">Model</p>
              <p className="truncate text-sm font-semibold text-foreground">{currentModel?.name ?? 'Unknown'}</p>
            </div>
            <ChevronRight size={16} className="shrink-0 text-muted-foreground" />
          </button>
          */}

          {isUploadingAttachment && <p className="pt-2 text-xs text-muted-foreground">Uploading attachment...</p>}
        </DrawerContent>
      </Drawer>

      {/* Model Picker Drawer — commented out while feature is disabled
      <Drawer open={isModelPickerOpen} onOpenChange={setIsModelPickerOpen}>
        <DrawerContent className="liquid-glass border-x border-t border-border px-4 pb-5 pt-3">
          <DrawerTitle className="pb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Choose model</DrawerTitle>
          <div className="space-y-1">
            {models.map((model) => {
              const isActive = model.id === selectedModelId;
              return (
                <button
                  key={model.id}
                  type="button"
                  className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition ${
                    isActive ? 'bg-primary/15 text-foreground' : 'text-foreground hover:bg-muted/60'
                  }`}
                  onClick={() => {
                    void onModelChange(model.id);
                    setIsModelPickerOpen(false);
                  }}
                >
                  <div className="min-w-0 flex-1">
                    <p className={`text-sm ${isActive ? 'font-semibold' : 'font-medium'}`}>{model.name}</p>
                    {model.description && (
                      <p className="truncate text-xs text-muted-foreground">{model.description}</p>
                    )}
                  </div>
                  {isActive && <div className="size-2 shrink-0 rounded-full bg-primary" />}
                </button>
              );
            })}
          </div>
        </DrawerContent>
      </Drawer>
      */}
    </>
  );
}
