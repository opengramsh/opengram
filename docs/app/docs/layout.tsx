import { DocsLayout } from 'fumadocs-ui/layouts/docs';
import { docsSource } from '@/lib/source';
import { navTitle, docsNavLinks } from '@/lib/shared-nav';
import type { ReactNode } from 'react';

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <DocsLayout
      tree={docsSource.getPageTree()}
      nav={{ title: navTitle }}
      links={docsNavLinks}
    >
      {children}
    </DocsLayout>
  );
}
