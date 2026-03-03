import { DocsLayout } from 'fumadocs-ui/layouts/docs';
import { apiSource } from '@/lib/source';
import { navTitle, apiNavLinks } from '@/lib/shared-nav';
import type { ReactNode } from 'react';

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <DocsLayout
      tree={apiSource.getPageTree()}
      nav={{ title: navTitle }}
      links={apiNavLinks}
    >
      {children}
    </DocsLayout>
  );
}
