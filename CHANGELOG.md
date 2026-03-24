# Changelog

## 0.2.1 (2026-03-24)

### Features

- **cli:** allow custom model ID in auto-rename setup (ae4081f)
- **cli:** upgrade OpenClaw plugin alongside main package (8d0b864)
- **release:** add option to keep current version (972aef2)

### Bug Fixes

- **cli:** add details to auto-rename step in init wizard (b3f7c1d)
- **docs:** fix broken logo path in README (e1fe88c)
- **docs:** use dynamic npm badge for release version in README (621f009)
- **web:** fix Streamdown code block buttons not clickable (f213acc)
- **auto-rename:** update default model options for OpenAI, Google, and OpenRouter (b49ee71)
- **openclaw-plugin:** detect implicit "main" agent from agents.defaults (38e4a15)
- **release:** use interactive stdio for npm publish (030fa45)
- **release:** skip git tag when it already exists (391d569)
- improve release script error handling and auth flows (89348d5)

### Refactoring

- **cli:** replace p.note() boxes with p.log.info() for prompt descriptions (5c53592)

### Documentation

- mention OpenClaw plugin as agent configuration method (47af9e3)
- add Configuring Agents page (a99e1fd)
- add macOS App page (ced420a)
- add Mobile App (PWA) installation guide (4346b08)
- **openclaw-plugin:** add "Reimporting your OpenClaw agents" section (1e85f85)

### Tests

- **openclaw-plugin:** add fixture-based test for implicit agent detection (550e3c0)

### Chores

- **macos:** update Sparkle appcast for v0.2.0 (a3bdd5a)

### Other Changes

- v0.2.0 (ce896d7)
- v0.2.0 (4d0bc16)


## 0.2.0 (2026-03-22)

### Features

- **release:** add option to keep current version (972aef2)

### Bug Fixes

- **release:** skip git tag when it already exists (391d569)
- improve release script error handling and auth flows (89348d5)

### Other Changes

- v0.2.0 (4d0bc16)


## 0.2.0 (2026-03-22)

### Features

- **release:** add option to keep current version (972aef2)

### Bug Fixes

- improve release script error handling and auth flows (89348d5)


## 0.2.0 (2026-03-22)

### Features

- add interactive release orchestration script (faf417e)
- **web:** add WhatsApp-style scroll-to-bottom button and fix chat scroll behavior (3e863d1)
- **web:** support pasting images from clipboard into chat composer (a5f642d)
- **web:** show agent name in macOS native notifications (b2425f6)
- **web:** add drag-and-drop file upload to chat pages (9246afc)
- **openclaw-plugin:** inject message history on fresh agent sessions (9020fae)

### Bug Fixes

- **web:** prevent chat from scrolling to bottom on keyboard open/typing (93d92da)
- **web:** prevent chat messages from rendering behind iOS keyboard (3082c85)
- **web:** preserve explicit chat titles from auto-rename (aa192e4)
- **openclaw-plugin:** re-inject history on dispatch retry after skip (6ebdafa)
- **web:** use Streamdown for markdown file preview instead of custom renderer (1ef2062)
- **web:** skip web push registration in macOS native app (cea6701)
- **web:** back button navigates to inbox instead of previous chat (5792ced)
- **openclaw-plugin:** always require agentId when creating chats (08f2e11)

### Other Changes

- install local OpenClaw plugin during local service update (a8a6621)

### Other Changes

- add macos app (+ some matching changes in web app) (dc1d464)
- Update configs for monorepo workspace structure (5203eb9)
- Restructure repo as npm workspaces monorepo (ee77685)
