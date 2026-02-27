import { useEffect, useState } from 'react';

import { apiFetch } from '@/src/lib/api-fetch';
import { HamburgerMenu } from '@/src/components/navigation/hamburger-menu';
import { Card, CardContent, CardHeader, CardTitle } from '@/src/components/ui/card';

type ConfigViewerResponse = {
  appName: string;
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
        const response = await apiFetch('/api/v1/config', { cache: 'no-store' });
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
    <div className="min-h-screen w-full bg-background pb-10">
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
            <Card>
              <CardHeader className="p-0">
                <CardTitle className="text-sm">General</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <dl className="grid gap-2 text-xs text-muted-foreground">
                  <div className="flex justify-between gap-2">
                    <dt>Default model for new chats</dt>
                    <dd className="text-foreground">{config.defaultModelIdForNewChats}</dd>
                  </div>
                </dl>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="p-0">
                <CardTitle className="text-sm">Agents ({config.agents.length})</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <ul className="space-y-2 text-xs">
                  {config.agents.map((agent) => (
                    <li key={agent.id} className="rounded-xl border border-border/70 bg-background/70 px-3 py-2">
                      <p className="font-medium text-foreground">{agent.name}</p>
                      <p className="text-muted-foreground">{agent.id}</p>
                      <p className="mt-1 text-muted-foreground">{agent.description}</p>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="p-0">
                <CardTitle className="text-sm">Models ({config.models.length})</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <ul className="space-y-2 text-xs">
                  {config.models.map((model) => (
                    <li key={model.id} className="rounded-xl border border-border/70 bg-background/70 px-3 py-2">
                      <p className="font-medium text-foreground">{model.name}</p>
                      <p className="text-muted-foreground">{model.id}</p>
                      <p className="mt-1 text-muted-foreground">{model.description}</p>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="p-0">
                <CardTitle className="text-sm">Raw config payload</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <pre className="max-h-96 overflow-auto rounded-xl border border-border/70 bg-background/70 p-3 text-[11px] text-muted-foreground">
                  {JSON.stringify(config, null, 2)}
                </pre>
              </CardContent>
            </Card>
          </>
        )}
      </main>
    </div>
  );
}
