import { useCallback, useEffect, useRef, useState } from 'react';
import { FileIcon, ImageIcon, Plus, X } from 'lucide-react';

import {
  PromptInput,
  PromptInputTextarea,
  PromptInputFooter,
  PromptInputButton,
  PromptInputSubmit,
} from '@/src/components/ai-elements/prompt-input';
import { Drawer, DrawerContent } from '@/src/components/ui/drawer';
import { cn } from '@/src/lib/utils';
import { useChatV2Context } from './chat-v2-provider';

export function ChatV2Composer() {
  const { data, send, attachments } = useChatV2Context();
  const { keyboardOffset } = data;

  const [menuOpen, setMenuOpen] = useState(false);
  const composerRef = useRef<HTMLDivElement>(null);
  const photosInputRef = useRef<HTMLInputElement>(null);
  const filesInputRef = useRef<HTMLInputElement>(null);

  const canSend = attachments.readyIds.length > 0 || attachments.allReady;

  const handleSubmit = useCallback(
    async (message: { text: string }) => {
      if (!message.text.trim() && attachments.readyIds.length === 0) return;
      await send.send(message.text);
    },
    [send, attachments.readyIds.length],
  );

  // Track composer height for feed padding
  useEffect(() => {
    const el = composerRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => {
      document.documentElement.style.setProperty('--composer-height', `${el.offsetHeight}px`);
    });
    observer.observe(el);
    return () => {
      observer.disconnect();
      document.documentElement.style.removeProperty('--composer-height');
    };
  }, []);

  return (
    <div
      ref={composerRef}
      className="fixed inset-x-0 bottom-0 z-40 border-t border-border/50 bg-background/95 backdrop-blur-md"
      style={{ paddingBottom: keyboardOffset > 0 ? keyboardOffset : 'env(safe-area-inset-bottom, 0px)' }}
    >
      {/* Pending attachment previews */}
      {attachments.attachments.length > 0 && (
        <div className="flex gap-2 overflow-x-auto px-3 pt-2 pb-1">
          {attachments.attachments.map((att) => (
            <div key={att.localId} className="relative shrink-0">
              {att.previewUrl ? (
                <img src={att.previewUrl} alt={att.filename} className="h-14 w-14 rounded-lg object-cover" />
              ) : (
                <div className="flex h-14 w-14 items-center justify-center rounded-lg bg-muted text-xs text-muted-foreground">
                  <FileIcon size={18} />
                </div>
              )}
              {att.status === 'uploading' && (
                <div className="absolute inset-0 flex items-center justify-center rounded-lg bg-black/40">
                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                </div>
              )}
              <button
                type="button"
                onClick={() => attachments.removeAttachment(att.localId)}
                className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-destructive text-destructive-foreground"
              >
                <X size={12} />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* PromptInput composer */}
      <PromptInput
        onSubmit={(message) => void handleSubmit(message)}
        className={cn('border-0 shadow-none rounded-none')}
      >
        <PromptInputTextarea
          placeholder="Message..."
          disabled={send.isStreaming}
          className="max-h-36 min-h-[40px] py-2.5 text-sm"
        />
        <PromptInputFooter className="px-1 pb-1">
          <PromptInputButton onClick={() => setMenuOpen(true)} tooltip="Attach">
            <Plus className="size-4" />
          </PromptInputButton>
          <PromptInputSubmit
            status={send.status}
            onStop={send.stop}
            disabled={!canSend && !send.isStreaming}
          />
        </PromptInputFooter>
      </PromptInput>

      {/* Hidden file inputs */}
      <input
        ref={photosInputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        tabIndex={-1}
        onChange={(e) => { void attachments.uploadFiles(e.target.files, 'image'); e.target.value = ''; }}
      />
      <input
        ref={filesInputRef}
        type="file"
        multiple
        className="hidden"
        tabIndex={-1}
        onChange={(e) => { void attachments.uploadFiles(e.target.files, 'file'); e.target.value = ''; }}
      />

      {/* Attachment menu drawer */}
      <Drawer open={menuOpen} onOpenChange={setMenuOpen}>
        <DrawerContent className="pb-safe">
          <div className="grid grid-cols-2 gap-3 p-4">
            <MenuButton
              icon={<ImageIcon size={22} />}
              label="Photos"
              onClick={() => { setMenuOpen(false); photosInputRef.current?.click(); }}
            />
            <MenuButton
              icon={<FileIcon size={22} />}
              label="Files"
              onClick={() => { setMenuOpen(false); filesInputRef.current?.click(); }}
            />
          </div>
        </DrawerContent>
      </Drawer>
    </div>
  );
}

function MenuButton({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex flex-col items-center gap-1.5 rounded-xl border border-border/50 bg-muted/50 p-4 text-sm text-foreground hover:bg-muted"
    >
      {icon}
      {label}
    </button>
  );
}
