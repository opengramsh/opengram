'use client';

import { useEffect, useState } from 'react';

import { HamburgerMenu } from '@/src/components/navigation/hamburger-menu';

type SettingsResponse = {
  appName: string;
  push?: {
    enabled?: boolean;
    subject?: string;
  };
  security?: {
    instanceSecretEnabled?: boolean;
  };
};

export default function SettingsPage() {
  const [config, setConfig] = useState<SettingsResponse | null>(null);

  useEffect(() => {
    async function loadConfig() {
      const response = await fetch('/api/v1/config', { cache: 'no-store' });
      if (!response.ok) {
        return;
      }
      setConfig((await response.json()) as SettingsResponse);
    }

    loadConfig().catch(() => undefined);
  }, []);

  return (
    <div className="mx-auto min-h-screen w-full max-w-3xl bg-background pb-10">
      <header className="sticky top-0 z-20 border-b border-border/70 bg-background/95 px-4 py-3 backdrop-blur-md">
        <div className="grid grid-cols-[36px_1fr_36px] items-center">
          <HamburgerMenu />
          <div className="text-center">
            <h1 className="text-sm font-semibold tracking-wide text-foreground">Settings</h1>
            <p className="text-xs text-muted-foreground">Instance and app controls</p>
          </div>
          <div />
        </div>
      </header>

      <main className="space-y-4 px-4 py-4">
        <section className="rounded-2xl border border-border bg-card p-4">
          <h2 className="text-sm font-semibold text-foreground">Push notifications</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            {config?.push?.enabled ? 'Enabled in config.' : 'Disabled in config.'}
          </p>
          {config?.push?.subject && <p className="mt-1 text-xs text-muted-foreground">Subject: {config.push.subject}</p>}
        </section>

        <section className="rounded-2xl border border-border bg-card p-4">
          <h2 className="text-sm font-semibold text-foreground">Write security</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            {config?.security?.instanceSecretEnabled
              ? 'Instance secret enforcement is enabled.'
              : 'Instance secret enforcement is disabled.'}
          </p>
        </section>

        <section className="rounded-2xl border border-border bg-card p-4">
          <h2 className="text-sm font-semibold text-foreground">App info</h2>
          <p className="mt-2 text-sm text-muted-foreground">App name: {config?.appName ?? 'OpenGram'}</p>
        </section>
      </main>
    </div>
  );
}
