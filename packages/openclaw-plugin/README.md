# @opengramsh/openclaw-plugin

OpenClaw channel plugin for [OpenGram](https://github.com/brice-ventures/opengram) — a mobile-first PWA for AI agent chat and task management.

This plugin connects OpenClaw agents to OpenGram, enabling bidirectional messaging, structured requests, media uploads, streaming responses, and full-text search.

## Installation

```bash
npm install @opengramsh/openclaw-plugin
```

Add the plugin to your OpenClaw configuration:

```json
{
  "plugins": ["@opengramsh/openclaw-plugin"],
  "channels": {
    "opengram": {
      "baseUrl": "http://localhost:3000",
      "agents": ["my-agent"]
    }
  }
}
```

## Quick Start

1. **Install** the plugin in your OpenClaw project.
2. **Configure** `channels.opengram.baseUrl` to point at your OpenGram instance.
3. **Link agents** by adding their IDs to `channels.opengram.agents`.
4. **Start OpenClaw** — the plugin connects via SSE and begins listening for user messages.

When a user sends a message in OpenGram, the plugin dispatches it to the appropriate OpenClaw agent. Agent replies are streamed back to OpenGram in real-time.

## Configuration Reference

All configuration lives under `channels.opengram` in your OpenClaw config file.

| Key | Type | Required | Default | Description |
|-----|------|----------|---------|-------------|
| `baseUrl` | `string` | Yes | — | OpenGram instance URL (e.g. `http://localhost:3000`) |
| `instanceSecret` | `string` | No | — | API auth secret. Also reads `OPENGRAM_INSTANCE_SECRET` env var. |
| `agents` | `string[]` | No | `[]` | Linked OpenClaw agent IDs |
| `defaultModelId` | `string` | No | — | Default model ID for new chats |
| `reconnectDelayMs` | `number` | No | `3000` | SSE reconnect delay in milliseconds |

### Environment Variables

| Variable | Description |
|----------|-------------|
| `OPENGRAM_INSTANCE_SECRET` | Instance secret for API auth (overrides config) |

## Architecture

```
OpenGram (PWA)          @opengramsh/openclaw-plugin          OpenClaw Agent
     |                         |                              |
     |--- SSE events --------->|                              |
     |   message.created       |--- dispatch ----------------->|
     |   request.resolved      |                              |
     |                         |                              |
     |<--- REST API -----------|<--- reply (streamed) ---------|
     |   createMessage         |   deliver(block/final/tool)  |
     |   sendChunk             |                              |
     |   completeMessage       |                              |
```

### Components

- **API Client** (`api-client.ts`) — HTTP client for the OpenGram REST API with retry logic and SSE connection support.
- **Channel Plugin** (`channel.ts`) — OpenClaw `ChannelPlugin` implementation. Registers capabilities, tools, and gateway lifecycle.
- **Inbound Listener** (`inbound.ts`) — SSE-based event listener. Handles `message.created` and `request.resolved` events with deduplication and cursor-based catch-up.
- **Outbound** (`outbound.ts`) — Sends agent text and media messages to OpenGram.
- **Streaming** (`streaming.ts`) — Delta-based streaming. Tracks per-dispatch state, sends only new text as chunks, and finalizes or cancels streams.
- **Chat Manager** (`chat-manager.ts`) — Manages chat-to-agent mappings, active chat tracking, and client state.
- **Agent Tools** — Four channel-scoped tools available to agents:
  - `opengram_request` — Create structured requests (choice, text input, form)
  - `opengram_chat` — Create, update, and list chats
  - `opengram_media` — Upload media files to a chat
  - `opengram_search` — Full-text search across conversations

### Agent Skill

The bundled skill (`skills/opengram/SKILL.md`) teaches agents how to use OpenGram-specific features like structured requests, streaming, and media uploads.

## Capabilities

| Feature | Supported |
|---------|-----------|
| Direct chats | Yes |
| Media attachments | Yes |
| Block streaming | Yes |
| Threads | No |
| Reactions | No |
| Polls | No |
| Native commands | No |

## Development

```bash
# Install dependencies
npm install

# Run tests
npm test

# Type check
npm run typecheck

# Build
npm run build
```

## License

MIT
