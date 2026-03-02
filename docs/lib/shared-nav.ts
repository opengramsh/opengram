import type { LinkItemType } from 'fumadocs-ui/layouts/shared';

export const navTitle = 'Opengram';

export const navLinks: LinkItemType[] = [
  {
    text: 'Docs',
    url: '/docs',
    active: 'nested-url',
  },
  {
    text: 'API Reference',
    url: '/api-reference',
    active: 'nested-url',
  },
  {
    text: 'GitHub',
    url: 'https://github.com/opengram/opengram',
  },
];
