import type { LinkItemType } from "fumadocs-ui/layouts/shared";

export const navTitle = "Opengram";

const githubLink: LinkItemType = {
  text: "GitHub",
  url: "https://github.com/opengramsh/opengram",
};

export const docsNavLinks: LinkItemType[] = [
  {
    text: "API Reference",
    url: "/api-reference",
    active: "nested-url",
  },
  githubLink,
];

export const apiNavLinks: LinkItemType[] = [
  {
    text: "Docs",
    url: "/docs",
    active: "nested-url",
  },
  githubLink,
];
