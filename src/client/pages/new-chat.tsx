'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { ArrowLeft } from 'lucide-react';
import { toast } from 'sonner';
import { Facehash } from 'facehash';

import { ChatComposer } from '@/app/chats/[chatId]/_components/chat-composer';
import { useChatRecorder } from '@/app/chats/[chatId]/_hooks/use-chat-recorder';
import { apiFetch, setApiSecret } from '@/src/lib/api-fetch';
import { Button } from '@/src/components/ui/button';
import { FACEHASH_COLORS } from '@/src/lib/utils';
import {
  Drawer,
  DrawerContent,
  DrawerTitle,
} from '@/src/components/ui/drawer';

type Agent = { id: string; name: string; description: string; defaultModelId?: string };
type Model = { id: string; name: string; description: string };

const AGENT_DEFAULT_MODEL_ID = '__agent_default__';
// const AGENT_DEFAULT_MODEL: Model = {
//   id: AGENT_DEFAULT_MODEL_ID,
//   name: "Agent's default",
//   description: "Uses the agent's configured model",
// };

export default function NewChatPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const [agents, setAgents] = useState<Agent[]>([]);
  const [rawModels, setRawModels] = useState<Model[]>([]);
  const [selectedAgentId, setSelectedAgentId] = useState(searchParams.get('agentId') ?? '');
  const [selectedModelId, setSelectedModelId] = useState(searchParams.get('modelId') ?? '');
  const [message, setMessage] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [configLoaded, setConfigLoaded] = useState(false);
  const [isAgentPickerOpen, setIsAgentPickerOpen] = useState(false);
  const [isComposerMenuOpen, setIsComposerMenuOpen] = useState(false);
  const [isUploadingAttachment, setIsUploadingAttachment] = useState(false);
  const [pendingAttachments, setPendingAttachments] = useState<{ id: string; kind: string; filename: string }[]>([]);

  const cameraInputRef = useRef<HTMLInputElement | null>(null);
  const photosInputRef = useRef<HTMLInputElement | null>(null);
  const filesInputRef = useRef<HTMLInputElement | null>(null);
  const pendingChatIdRef = useRef<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const response = await apiFetch('/api/v1/config', { cache: 'no-store' });
        if (!response.ok) return;
        const config = (await response.json()) as { agents: Agent[]; models: Model[]; security?: { instanceSecret?: string } };
        setApiSecret(config.security?.instanceSecret ?? null);
        setAgents(config.agents ?? []);
        setRawModels(config.models ?? []);

        // Set defaults from URL params or fallback to first available
        const paramAgentId = searchParams.get('agentId');
        if (paramAgentId && config.agents.some((a: Agent) => a.id === paramAgentId)) {
          setSelectedAgentId(paramAgentId);
        } else if (config.agents.length > 0) {
          setSelectedAgentId(config.agents[0].id);
        }
        // Model selection disabled — auto-resolve to agent default
        // const paramModelId = searchParams.get('modelId');
        // if (paramModelId && config.models.some((m: Model) => m.id === paramModelId)) {
        //   setSelectedModelId(paramModelId);
        // } else {
        //   setSelectedModelId(AGENT_DEFAULT_MODEL_ID);
        // }
        setSelectedModelId(AGENT_DEFAULT_MODEL_ID);
        setConfigLoaded(true);
      } catch {
        // Silently fail
      }
    })();
  }, [searchParams]);

  // Model selection disabled — pass empty array to composer
  // const models = useMemo<Model[]>(
  //   () => [AGENT_DEFAULT_MODEL, ...rawModels],
  //   [rawModels],
  // );

  const selectedAgent = useMemo(
    () => agents.find((a) => a.id === selectedAgentId),
    [agents, selectedAgentId],
  );

  const resolveModelId = useCallback(() => {
    return selectedModelId === AGENT_DEFAULT_MODEL_ID
      ? (selectedAgent?.defaultModelId ?? rawModels[0]?.id ?? '')
      : selectedModelId;
  }, [selectedModelId, selectedAgent, rawModels]);

  const ensureChatId = useCallback(async (): Promise<string | null> => {
    if (pendingChatIdRef.current) return pendingChatIdRef.current;
    if (!selectedAgentId) return null;

    const resolvedModelId = resolveModelId();
    if (!resolvedModelId) return null;

    try {
      const response = await apiFetch('/api/v1/chats', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          agentIds: [selectedAgentId],
          modelId: resolvedModelId,
        }),
      });

      if (!response.ok) return null;

      const chat = (await response.json()) as { id: string };
      pendingChatIdRef.current = chat.id;
      return chat.id;
    } catch {
      return null;
    }
  }, [selectedAgentId, resolveModelId]);

  const createChat = useCallback(async () => {
    const content = message.trim();
    if ((!content && pendingAttachments.length === 0) || !selectedAgentId || !selectedModelId || isCreating) return;

    const resolvedModelId = resolveModelId();
    if (!resolvedModelId) return;

    setIsCreating(true);
    try {
      if (pendingAttachments.length > 0) {
        // A chat was already created during upload; send attachments then text.
        const chatId = pendingChatIdRef.current ?? await (async () => {
          const res = await apiFetch('/api/v1/chats', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ agentIds: [selectedAgentId], modelId: resolvedModelId }),
          });
          if (!res.ok) throw new Error('Failed');
          const c = (await res.json()) as { id: string };
          pendingChatIdRef.current = c.id;
          return c.id;
        })();

        // Single message with all attachments + optional text
        const body: Record<string, unknown> = { role: 'user', senderId: 'user:primary', trace: { mediaIds: pendingAttachments.map((a) => a.id) } };
        if (content) body.content = content;
        const res = await apiFetch(`/api/v1/chats/${chatId}/messages`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        });
        if (!res.ok) throw new Error('Failed');
        navigate(`/chats/${chatId}`, { replace: true });
        return;
      }

      // Text-only path
      const existingChatId = pendingChatIdRef.current;
      if (existingChatId) {
        const response = await apiFetch(`/api/v1/chats/${existingChatId}/messages`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ role: 'user', senderId: 'user:primary', content }),
        });
        if (!response.ok) throw new Error('Failed');
        navigate(`/chats/${existingChatId}`, { replace: true });
        return;
      }

      const response = await apiFetch('/api/v1/chats', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          agentIds: [selectedAgentId],
          modelId: resolvedModelId,
          firstMessage: content,
        }),
      });

      if (!response.ok) throw new Error('Failed');

      const chat = (await response.json()) as { id: string };
      navigate(`/chats/${chat.id}`, { replace: true });
    } catch {
      setIsCreating(false);
    }
  }, [message, pendingAttachments, selectedAgentId, selectedModelId, isCreating, resolveModelId, navigate]);

  const uploadComposerFiles = useCallback(async (fileList: FileList | null, forcedKind?: 'image' | 'file') => {
    if (!fileList || fileList.length === 0 || isUploadingAttachment) return;

    setIsUploadingAttachment(true);
    try {
      const chatId = await ensureChatId();
      if (!chatId) {
        toast.error('Failed to create chat.');
        return;
      }

      const newItems: { id: string; kind: string; filename: string }[] = [];
      for (const file of Array.from(fileList)) {
        const formData = new FormData();
        formData.append('file', file, file.name);
        if (forcedKind) formData.append('kind', forcedKind);

        const uploadResponse = await apiFetch(`/api/v1/chats/${chatId}/media`, { method: 'POST', body: formData });
        if (!uploadResponse.ok) throw new Error('Failed to upload media');

        newItems.push((await uploadResponse.json()) as { id: string; kind: string; filename: string });
      }

      setPendingAttachments((prev) => [...prev, ...newItems]);
      setIsComposerMenuOpen(false);
    } catch {
      toast.error('Failed to upload attachment.');
    } finally {
      setIsUploadingAttachment(false);
    }
  }, [ensureChatId, isUploadingAttachment]);

  const removePendingAttachment = useCallback((mediaId: string) => {
    setPendingAttachments((prev) => prev.filter((m) => m.id !== mediaId));
  }, []);

  const recorder = useChatRecorder({
    getChatId: ensureChatId,
    setError: (msg) => { if (msg) toast.error(msg); },
    onVoiceNoteUploaded: (chatId) => navigate(`/chats/${chatId}`, { replace: true }),
  });

  return (
    <div className="flex h-[100dvh] w-full flex-col bg-background">
      {/* Header */}
      <header className="sticky top-0 z-30 h-[61px] border-b border-border/70 bg-background/95 px-3 py-3 backdrop-blur-md">
        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            size="icon"
            aria-label="Back"
            className="md:hidden shrink-0"
            onClick={() => {
              if (window.history.length > 1) navigate(-1);
              else navigate('/');
            }}
          >
            <ArrowLeft size={16} />
          </Button>

          {/* Agent selector */}
          <button
            type="button"
            className="flex min-w-0 flex-1 cursor-pointer items-center gap-2.5"
            onClick={() => setIsAgentPickerOpen(true)}
          >
            {selectedAgent && (
              <Facehash
                name={selectedAgent.name}
                size={36}
                interactive
                colors={FACEHASH_COLORS}
                intensity3d="dramatic"
                variant="gradient"
                gradientOverlayClass="facehash-gradient"
                className="shrink-0 rounded-xl text-black"
              />
            )}
            <div className="min-w-0 text-left">
              <p className="truncate text-sm font-semibold text-foreground">
                {selectedAgent?.name ?? 'Choose agent'}
              </p>
              <p className="truncate text-[11px] text-muted-foreground">Tap to change agent</p>
            </div>
          </button>
        </div>
      </header>

      {/* Empty message area */}
      <main className="flex flex-1 items-center justify-center px-4">
        {configLoaded ? (
          <p className="text-center text-sm text-muted-foreground">
            Send a message to start a new chat
            {selectedAgent ? ` with ${selectedAgent.name}` : ''}.
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">Loading...</p>
        )}
      </main>

      <ChatComposer
        keyboardOffset={0}
        composerText={message}
        setComposerText={setMessage}
        isSending={isCreating}
        sendMessage={createChat}
        selectedModelId={selectedModelId}
        models={[]}
        onModelChange={async () => {}}
        isComposerMenuOpen={isComposerMenuOpen}
        setIsComposerMenuOpen={setIsComposerMenuOpen}
        handleMicAction={recorder.handleMicAction}
        isRecording={recorder.isRecording}
        recordingSeconds={recorder.recordingSeconds}
        isUploadingVoiceNote={recorder.isUploadingVoiceNote}
        showMicSettingsPrompt={recorder.showMicSettingsPrompt}
        isUploadingAttachment={isUploadingAttachment}
        uploadComposerFiles={uploadComposerFiles}
        pendingAttachments={pendingAttachments}
        removePendingAttachment={removePendingAttachment}
        cameraInputRef={cameraInputRef}
        photosInputRef={photosInputRef}
        filesInputRef={filesInputRef}
        onCameraCapture={() => cameraInputRef.current?.click()}
      />

      {/* Agent Picker */}
      <Drawer open={isAgentPickerOpen} onOpenChange={setIsAgentPickerOpen}>
        <DrawerContent className="liquid-glass border-x border-t border-border px-4 pb-5 pt-3">
          <DrawerTitle className="pb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Choose agent</DrawerTitle>
          <div className="space-y-1">
            {agents.map((agent) => {
              const isActive = agent.id === selectedAgentId;
              return (
                <button
                  key={agent.id}
                  type="button"
                  className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition ${
                    isActive ? 'bg-primary/15' : 'hover:bg-muted/60'
                  }`}
                  onClick={() => {
                    setSelectedAgentId(agent.id);
                    setIsAgentPickerOpen(false);
                  }}
                >
                  <Facehash
                    name={agent.name}
                    size={34}
                    interactive
                    colors={FACEHASH_COLORS}
                    intensity3d="dramatic"
                    variant="gradient"
                    gradientOverlayClass="facehash-gradient"
                    className="shrink-0 rounded-lg text-black"
                  />
                  <div className="min-w-0 flex-1">
                    <p className={`text-sm ${isActive ? 'font-semibold' : 'font-medium'} text-foreground`}>{agent.name}</p>
                    {agent.description && (
                      <p className="truncate text-xs text-muted-foreground">{agent.description}</p>
                    )}
                  </div>
                  {isActive && <div className="size-2 shrink-0 rounded-full bg-primary" />}
                </button>
              );
            })}
          </div>
        </DrawerContent>
      </Drawer>
    </div>
  );
}
