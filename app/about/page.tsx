'use client';

import { HamburgerMenu } from '@/src/components/navigation/hamburger-menu';
import { Card, CardContent, CardHeader, CardTitle } from '@/src/components/ui/card';

export default function AboutPage() {
  return (
    <div className="min-h-screen w-full bg-background pb-10">
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
        <Card>
          <CardHeader className="p-0">
            <CardTitle className="text-sm">OpenGram</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <p className="text-sm text-muted-foreground">
              Mobile-first chat and task review UI for runtime-agnostic AI agent backends.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="p-0">
            <CardTitle className="text-sm">Documentation</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <ul className="space-y-2 text-sm text-muted-foreground">
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
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
