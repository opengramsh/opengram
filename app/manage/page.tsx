'use client';

import { useEffect, useState } from 'react';

import { HamburgerMenu } from '@/src/components/navigation/hamburger-menu';

type ConfigViewerResponse = {
  appName: string;
  defaultCustomState: string;
  customStates: string[];
  defaultModelIdForNewChats: string;
  agents: Array<{ id: string; name: string; description: string }>;
  models: Array<{ id: string; name: string; description: string }>;
  server?: {
    publicBaseUrl?: string;
    port?: number;
    streamTimeoutSeconds?: number;
    idempotencyTtlSeconds?: number;
  };
};

export default function ManagePage() {
  const [config, setConfig] = useState<ConfigViewerResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadConfig() {
      try {
        const response = await fetch('/api/v1/config', { cache: 'no-store' });
        if (!response.ok) {
          throw new Error('Failed to load config');
        }

        const payload = (await response.json()) as ConfigViewerResponse;
        setConfig(payload);
      } catch {
        setError('Failed to load config viewer data.');
      }
    }

    loadConfig().catch(() => setError('Failed to load config viewer data.'));
  }, []);

  return (
    <div className="mx-auto min-h-screen w-full max-w-3xl bg-background pb-10">
      <header className="sticky top-0 z-20 border-b border-border/70 bg-background/95 px-4 py-3 backdrop-blur-md">
        <div className="grid grid-cols-[36px_1fr_36px] items-center">
          <HamburgerMenu />
          <div className="text-center">
            <h1 className="text-sm font-semibold tracking-wide text-foreground">Manage agents/models</h1>
            <p className="text-xs text-muted-foreground">Config viewer</p>
          </div>
          <div />
        </div>
      </header>

      <main className="space-y-4 px-4 py-4">
        {error && <p className="text-sm text-red-300">{error}</p>}
        {!error && !config && <p className="text-sm text-muted-foreground">Loading config...</p>}

        {config && (
          <>
            <section className="rounded-2xl border border-border bg-card p-4">
              <h2 className="text-sm font-semibold text-foreground">General</h2>
              <dl className="mt-3 grid gap-2 text-xs text-muted-foreground">
                <div className="flex justify-between gap-2">
                  <dt>App name</dt>
                  <dd className="text-foreground">{config.appName}</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt>Default model for new chats</dt>
                  <dd className="text-foreground">{config.defaultModelIdForNewChats}</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt>Default custom state</dt>
                  <dd className="text-foreground">{config.defaultCustomState}</dd>
                </div>
              </dl>
            </section>

            <section className="rounded-2xl border border-border bg-card p-4">
              <h2 className="text-sm font-semibold text-foreground">Agents ({config.agents.length})</h2>
              <ul className="mt-3 space-y-2 text-xs">
                {config.agents.map((agent) => (
                  <li key={agent.id} className="rounded-xl border border-border/70 bg-background/70 px-3 py-2">
                    <p className="font-medium text-foreground">{agent.name}</p>
                    <p className="text-muted-foreground">{agent.id}</p>
                    <p className="mt-1 text-muted-foreground">{agent.description}</p>
                  </li>
                ))}
              </ul>
            </section>

            <section className="rounded-2xl border border-border bg-card p-4">
              <h2 className="text-sm font-semibold text-foreground">Models ({config.models.length})</h2>
              <ul className="mt-3 space-y-2 text-xs">
                {config.models.map((model) => (
                  <li key={model.id} className="rounded-xl border border-border/70 bg-background/70 px-3 py-2">
                    <p className="font-medium text-foreground">{model.name}</p>
                    <p className="text-muted-foreground">{model.id}</p>
                    <p className="mt-1 text-muted-foreground">{model.description}</p>
                  </li>
                ))}
              </ul>
            </section>

            <section className="rounded-2xl border border-border bg-card p-4">
              <h2 className="text-sm font-semibold text-foreground">States</h2>
              <p className="mt-2 text-xs text-muted-foreground">{config.customStates.join(' | ')}</p>
            </section>

            <section className="rounded-2xl border border-border bg-card p-4">
              <h2 className="text-sm font-semibold text-foreground">Raw config payload</h2>
              <pre className="mt-2 max-h-96 overflow-auto rounded-xl border border-border/70 bg-background/70 p-3 text-[11px] text-muted-foreground">
                {JSON.stringify(config, null, 2)}
              </pre>
            </section>
          </>
        )}
      </main>
    </div>
  );
}
