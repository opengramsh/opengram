'use client';

import { HamburgerMenu } from '@/src/components/navigation/hamburger-menu';

export default function AboutPage() {
  return (
    <div className="mx-auto min-h-screen w-full max-w-3xl bg-background pb-10">
      <header className="sticky top-0 z-20 border-b border-border/70 bg-background/95 px-4 py-3 backdrop-blur-md">
        <div className="grid grid-cols-[36px_1fr_36px] items-center">
          <HamburgerMenu />
          <div className="text-center">
            <h1 className="text-sm font-semibold tracking-wide text-foreground">About</h1>
            <p className="text-xs text-muted-foreground">OpenGram docs and links</p>
          </div>
          <div />
        </div>
      </header>

      <main className="space-y-4 px-4 py-4">
        <section className="rounded-2xl border border-border bg-card p-4">
          <h2 className="text-sm font-semibold text-foreground">OpenGram</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Mobile-first chat and task review UI for runtime-agnostic AI agent backends.
          </p>
        </section>

        <section className="rounded-2xl border border-border bg-card p-4">
          <h2 className="text-sm font-semibold text-foreground">Documentation</h2>
          <ul className="mt-2 space-y-2 text-sm text-muted-foreground">
            <li>
              <a className="text-primary underline-offset-2 hover:underline" href="/api/v1/config">
                Config API
              </a>
            </li>
            <li>
              <a className="text-primary underline-offset-2 hover:underline" href="/api/v1/health">
                Health API
              </a>
            </li>
          </ul>
        </section>
      </main>
    </div>
  );
}
