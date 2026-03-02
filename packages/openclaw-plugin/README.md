# @opengramsh/openclaw-plugin

OpenClaw channel plugin for [OpenGram](https://github.com/brice-ventures/opengram) — a mobile-first PWA for AI agent chat and task management.

This plugin connects OpenClaw agents to OpenGram, enabling bidirectional messaging, structured requests, media uploads, streaming responses, and full-text search.

## Prerequisites

- Node.js >= 20
- OpenClaw >= 2026.1.0

## Installation

```bash
npm install @opengramsh/openclaw-plugin
```

Add the plugin to your OpenClaw configuration (openclaw.json):

```json
{
  "plugins": ["@opengramsh/openclaw-plugin"],
}
```

## Quick Start

The fastest way to get started is the interactive setup wizard:

```bash
openclaw opengram setup
```

The wizard will:
1. Ask for your OpenGram instance URL and test the connection.
2. Configure the instance secret (if your instance requires one).
3. Let you select which agents to link.
4. Auto-approve `user:primary` for pairing so messages flow with zero friction.
5. Optionally restart the gateway to apply changes.

### Manual setup

1. **Install** the plugin in your OpenClaw project.
2. **Configure** the channel in openclaw.json:
```json
{
  "channels": {
    "opengram": {
      "baseUrl": "http://localhost:3000", //replace with your opengram instance URL
      "agents": ["my-agent"], //replace with the IDs of agents you want to talk to in opengram
      "dmPolicy": "pairing",
      "allowFrom": [
        "user:primary"
      ],
      "instanceSecret": "your_opengram_instance_secret" //replace with your secret
    }
  }
}
```
3. **Start OpenClaw** — the plugin connects via SSE and begins listening for user messages.

When a user sends a message in OpenGram, the plugin dispatches it to the appropriate OpenClaw agent. Agent replies are streamed back to OpenGram in real-time.

## Configuration Reference

All configuration lives under `channels.opengram` in your OpenClaw config file.

| Key | Type | Required | Default | Description |
|-----|------|----------|---------|-------------|
| `baseUrl` | `string` | No | `http://localhost:3000` | OpenGram instance URL |
| `instanceSecret` | `string` | No | — | API auth secret. Also reads `OPENGRAM_INSTANCE_SECRET` env var. |
| `agents` | `string[]` | No | `[]` | Linked OpenClaw agent IDs |
| `dmPolicy` | `string` | No | `"pairing"` | DM policy: `open`, `pairing`, `allowlist`, or `disabled` |
| `allowFrom` | `string[]` | No | `[]` | User IDs always permitted to message (used with `allowlist` policy) |
| `showReasoningMessages` | `boolean` | No | `false` | Show agent reasoning/thinking messages in chat |

### Environment Variables

| Variable | Description |
|----------|-------------|
| `OPENGRAM_INSTANCE_SECRET` | Instance secret for API auth (overrides config) |

### Components

- **API Client** (`api-client.ts`) — HTTP client for the OpenGram REST API with retry logic and SSE connection support.
- **Channel Plugin** (`channel.ts`) — OpenClaw `ChannelPlugin` implementation. Registers capabilities, tools, and gateway lifecycle.
- **Inbound Listener** (`inbound.ts`) — SSE-based event listener. Handles `message.created`, `request.resolved`, and `chat.user_typing` events with deduplication and cursor-based catch-up.
- **Outbound** (`outbound.ts`) — Sends agent text and media messages to OpenGram.
- **Streaming** (`streaming.ts`) — Delta-based streaming. Tracks per-dispatch state, sends only new text as chunks, and finalizes or cancels streams.
- **Chat Manager** (`chat-manager.ts`) — Manages chat-to-agent mappings, active chat tracking, and client state.
- **CLI** (`cli/`) — Interactive setup wizard (`openclaw opengram setup`) for guided configuration, connection testing, and agent linking.
- **Agent Tools** — 3 channel-scoped tools available to agents:
  - `opengram_chat` — Create, update, and list chats
  - `opengram_media` — Upload media files to a chat
  - `opengram_search` — Full-text search across conversations

### Agent Skill

The bundled skill (`skills/opengram/SKILL.md`) teaches agents how to use OpenGram-specific features.

## Capabilities

| Feature | Supported |
|---------|-----------|
| Direct chats | Yes |
| Media attachments | Yes |
| Block streaming | Yes |
| Native commands | Soon |
| Threads | No |
| Reactions | No |

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
