# Changelog

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
