import { RootProvider } from 'fumadocs-ui/provider/next';
import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: {
    template: '%s | Opengram Docs',
    default: 'Opengram Docs',
  },
  description:
    'Documentation for Opengram — the open-source, self-hostable chat platform for AI agent workflows.',
  icons: {
    icon: [{ url: 'https://opengram.sh/favicon.svg', type: 'image/svg+xml' }],
    shortcut: ['https://opengram.sh/favicon.svg'],
  },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <RootProvider
          search={{
            options: {
              api: '/docs/api/search',
            },
          }}
        >
          {children}
        </RootProvider>
      </body>
    </html>
  );
}
