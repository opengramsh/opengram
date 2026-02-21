'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { ArrowLeft, ChevronDown, Send } from 'lucide-react';
import { Facehash } from 'facehash';

import { Button } from '@/src/components/ui/button';
import { Textarea } from '@/src/components/ui/textarea';
import {
  Drawer,
  DrawerContent,
  DrawerTitle,
} from '@/src/components/ui/drawer';

type Agent = { id: string; name: string; description: string };
type Model = { id: string; name: string; description: string };

export default function NewChatPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const [agents, setAgents] = useState<Agent[]>([]);
  const [models, setModels] = useState<Model[]>([]);
  const [selectedAgentId, setSelectedAgentId] = useState(searchParams.get('agentId') ?? '');
  const [selectedModelId, setSelectedModelId] = useState(searchParams.get('modelId') ?? '');
  const [message, setMessage] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [configLoaded, setConfigLoaded] = useState(false);
  const [isAgentPickerOpen, setIsAgentPickerOpen] = useState(false);
  const [isModelPickerOpen, setIsModelPickerOpen] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const response = await fetch('/api/v1/config', { cache: 'no-store' });
        if (!response.ok) return;
        const config = (await response.json()) as { agents: Agent[]; models: Model[]; defaultModelIdForNewChats?: string };
        setAgents(config.agents ?? []);
        setModels(config.models ?? []);

        // Set defaults from URL params or fallback to first available
        const paramAgentId = searchParams.get('agentId');
        const paramModelId = searchParams.get('modelId');
        if (paramAgentId && config.agents.some((a: Agent) => a.id === paramAgentId)) {
          setSelectedAgentId(paramAgentId);
        } else if (config.agents.length > 0) {
          setSelectedAgentId(config.agents[0].id);
        }
        if (paramModelId && config.models.some((m: Model) => m.id === paramModelId)) {
          setSelectedModelId(paramModelId);
        } else {
          setSelectedModelId(config.defaultModelIdForNewChats || config.models[0]?.id || '');
        }
        setConfigLoaded(true);
      } catch {
        // Silently fail
      }
    })();
  }, [searchParams]);

  const selectedAgent = useMemo(
    () => agents.find((a) => a.id === selectedAgentId),
    [agents, selectedAgentId],
  );

  const selectedModel = useMemo(
    () => models.find((m) => m.id === selectedModelId),
    [models, selectedModelId],
  );

  const createChat = useCallback(async () => {
    const content = message.trim();
    if (!content || !selectedAgentId || !selectedModelId || isCreating) return;

    setIsCreating(true);
    try {
      const response = await fetch('/api/v1/chats', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          agentIds: [selectedAgentId],
          modelId: selectedModelId,
          firstMessage: content,
        }),
      });

      if (!response.ok) throw new Error('Failed');

      const chat = (await response.json()) as { id: string };
      navigate(`/chats/${chat.id}`, { replace: true });
    } catch {
      setIsCreating(false);
    }
  }, [message, selectedAgentId, selectedModelId, isCreating, navigate]);

  return (
    <div className="flex min-h-[100dvh] w-full flex-col bg-background">
      {/* Header */}
      <header className="sticky top-0 z-30 border-b border-border/70 bg-background/95 px-3 py-3 backdrop-blur-md">
        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            size="icon"
            aria-label="Back"
            onClick={() => {
              if (window.history.length > 1) navigate(-1);
              else navigate('/');
            }}
          >
            <ArrowLeft size={16} />
          </Button>

          <div className="flex flex-1 flex-col items-center gap-2">
            {/* Agent selector */}
            <button
              type="button"
              className="flex items-center gap-2.5 rounded-2xl border border-border/70 bg-muted/40 px-3 py-2 transition active:scale-[0.97]"
              onClick={() => setIsAgentPickerOpen(true)}
            >
              {selectedAgent && (
                <Facehash
                  name={selectedAgent.name}
                  size={36}
                  interactive={false}
                  className="shrink-0 rounded-xl text-black"
                />
              )}
              <div className="min-w-0 text-left">
                <p className="text-sm font-semibold text-foreground">
                  {selectedAgent?.name ?? 'Choose agent'}
                </p>
                <p className="truncate text-[11px] text-muted-foreground">Tap to change agent</p>
              </div>
              <ChevronDown size={14} className="shrink-0 text-muted-foreground" />
            </button>

            {/* Model selector */}
            <button
              type="button"
              className="flex items-center gap-1.5 rounded-xl border border-border/60 bg-muted/30 px-2.5 py-1 transition active:scale-[0.97]"
              onClick={() => setIsModelPickerOpen(true)}
            >
              <p className="text-[11px] font-medium text-muted-foreground">
                {selectedModel?.name ?? 'Choose model'}
              </p>
              <ChevronDown size={11} className="text-muted-foreground" />
            </button>
          </div>

          {/* Spacer to balance back button */}
          <div className="size-9" />
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

      {/* Composer */}
      <footer
        className="liquid-glass fixed inset-x-0 bottom-0 z-40 w-full px-3 pt-2"
        style={{ paddingBottom: 'calc(10px + env(safe-area-inset-bottom, 0px))' }}
      >
        <div className="flex items-end gap-2">
          <Textarea
            ref={textareaRef}
            rows={1}
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            placeholder="Message"
            className="max-h-36 min-h-11 flex-1 resize-none rounded-2xl px-3 py-3"
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                void createChat();
              }
            }}
          />
          <Button
            size="icon-xl"
            aria-label="Send message"
            onClick={() => void createChat()}
            disabled={isCreating || !message.trim() || !selectedAgentId || !selectedModelId}
          >
            <Send size={16} />
          </Button>
        </div>
      </footer>

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
                    interactive={false}
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

      {/* Model Picker */}
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
                    isActive ? 'bg-primary/15' : 'hover:bg-muted/60'
                  }`}
                  onClick={() => {
                    setSelectedModelId(model.id);
                    setIsModelPickerOpen(false);
                  }}
                >
                  <div className="min-w-0 flex-1">
                    <p className={`text-sm ${isActive ? 'font-semibold' : 'font-medium'} text-foreground`}>{model.name}</p>
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
    </div>
  );
}
