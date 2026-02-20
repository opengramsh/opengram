'use client';

import { type RefObject } from 'react';
import { Camera, FileText, GalleryVerticalEnd, Images, Mic, Plus, Send, Settings2, Square } from 'lucide-react';

import { formatDuration } from '@/app/chats/[chatId]/_lib/chat-utils';
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
  isRecording: boolean;
  recordingSeconds: number;
  isUploadingVoiceNote: boolean;
  showMicSettingsPrompt: boolean;
  isComposerMenuOpen: boolean;
  isUploadingAttachment: boolean;
  cameraInputRef: RefObject<HTMLInputElement | null>;
  photosInputRef: RefObject<HTMLInputElement | null>;
  filesInputRef: RefObject<HTMLInputElement | null>;
  setComposerText: (value: string) => void;
  setIsComposerMenuOpen: (value: boolean) => void;
  setIsMediaGalleryOpen: (value: boolean) => void;
  setTagInput: (value: string) => void;
  setTagSuggestions: (value: Array<{ name: string; usage_count: number }>) => void;
  setIsChatSettingsOpen: (value: boolean) => void;
  sendMessage: () => Promise<void>;
  handleMicAction: () => Promise<void>;
  uploadComposerFiles: (files: FileList | null, forcedKind?: 'image' | 'file') => Promise<void>;
};

export function ChatComposer({
  keyboardOffset,
  composerText,
  isSending,
  isRecording,
  recordingSeconds,
  isUploadingVoiceNote,
  showMicSettingsPrompt,
  isComposerMenuOpen,
  isUploadingAttachment,
  cameraInputRef,
  photosInputRef,
  filesInputRef,
  setComposerText,
  setIsComposerMenuOpen,
  setIsMediaGalleryOpen,
  setTagInput,
  setTagSuggestions,
  setIsChatSettingsOpen,
  sendMessage,
  handleMicAction,
  uploadComposerFiles,
}: ChatComposerProps) {
  return (
    <>
      <footer
        className="liquid-glass fixed inset-x-0 bottom-0 z-40 w-full px-3 pt-2"
        style={{ paddingBottom: `calc(10px + env(safe-area-inset-bottom, 0px) + ${keyboardOffset}px)` }}
      >
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
            className="max-h-36 min-h-11 flex-1 resize-none rounded-2xl px-3 py-3"
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                void sendMessage();
              }
            }}
          />

          <Button
            size="icon-xl"
            aria-label="Send message"
            onClick={() => void sendMessage()}
            disabled={isSending || !composerText.trim()}
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

      <Drawer open={isComposerMenuOpen} onOpenChange={setIsComposerMenuOpen}>
        <DrawerContent className="liquid-glass border-x border-t border-border px-4 pb-4 pt-3">
          <DrawerTitle className="pb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Composer menu</DrawerTitle>
          <div className="grid grid-cols-1 gap-2">
            <Button
              variant="outline"
              className="justify-start gap-2"
              disabled={isUploadingAttachment}
              onClick={() => cameraInputRef.current?.click()}
            >
              <Camera size={15} /> Attach: Camera
            </Button>
            <Button
              variant="outline"
              className="justify-start gap-2"
              disabled={isUploadingAttachment}
              onClick={() => photosInputRef.current?.click()}
            >
              <Images size={15} /> Attach: Photos
            </Button>
            <Button
              variant="outline"
              className="justify-start gap-2"
              disabled={isUploadingAttachment}
              onClick={() => filesInputRef.current?.click()}
            >
              <FileText size={15} /> Attach: Files
            </Button>
            <Button
              variant="outline"
              className="justify-start gap-2"
              onClick={() => {
                setIsComposerMenuOpen(false);
                setIsMediaGalleryOpen(true);
              }}
            >
              <GalleryVerticalEnd size={15} /> Media gallery
            </Button>
            <Button
              variant="outline"
              className="justify-start gap-2"
              onClick={() => {
                setIsComposerMenuOpen(false);
                setTagInput('');
                setTagSuggestions([]);
                setIsChatSettingsOpen(true);
              }}
            >
              <Settings2 size={15} /> Chat settings
            </Button>
          </div>
          {isUploadingAttachment && <p className="pt-2 text-xs text-muted-foreground">Uploading attachment...</p>}
        </DrawerContent>
      </Drawer>
    </>
  );
}
