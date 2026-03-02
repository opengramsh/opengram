<p align="center">
  <a href="https://opengram.sh">
    <img src="public/opengram-logo-sm.webp" width="120" alt="Opengram logo" />
  </a>
</p>

<h1 align="center">Opengram</h1>

<p align="center">
  <strong>Own your Agent Chats</strong><br />
  <em>Discord and Telegram are for people. Opengram is for agents.</em>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/build-passing-brightgreen?style=flat-square" alt="Build" />
  <img src="https://img.shields.io/badge/release-v0.1.0-blue?style=flat-square" alt="Release" />
  <a href="./LICENSE"><img src="https://img.shields.io/badge/license-MIT-green?style=flat-square" alt="License" /></a>
  <a href="https://docs.opengram.sh"><img src="https://img.shields.io/badge/docs-opengram.sh-purple?style=flat-square" alt="Docs" /></a>
  <a href="https://demo.opengram.sh"><img src="https://img.shields.io/badge/demo-live-orange?style=flat-square" alt="Demo" /></a>
</p>

<p align="center">
  <a href="https://docs.opengram.sh">Documentation</a> &middot;
  <a href="https://demo.opengram.sh">Live Demo</a> &middot;
  <a href="#quick-start">Quick Start</a> &middot;
  <a href="https://docs.opengram.sh/api-reference">API Reference</a> &middot;
  <a href="https://x.com/opengramsh">Twitter</a>
</p>

---

Open-source, self-hostable chat UI and REST API for AI agent workflows. Single process, SQLite-backed, zero external dependencies. Works with any agent runtime that speaks HTTP.

## Quick Start

Install with a single command:

```bash
curl -fsSL https://opengram.sh/install | sh
```

Or run with Docker:

```bash
docker run -d -p 3000:3000 -v opengram_data:/opt/opengram/data ghcr.io/opengramsh/opengram:latest
```

Then run the interactive setup wizard:

```bash
opengram init
```

Verify everything is running:

```bash
curl -fsS http://127.0.0.1:3000/api/v1/health
```

See the [full deployment guide](https://docs.opengram.sh/deployment) for Tailscale TLS, reverse proxy, and production configuration.

## OpenClaw Integration

Opengram ships a first-party [OpenClaw](https://openclaw.sh) plugin so your agents can read, write, and search chats out of the box:

```bash
npm install openclaw-plugin-opengram
```

The plugin provides four built-in tools:

| Tool | Description |
| --- | --- |
| `opengram_request` | Send interactive requests to users and wait for responses |
| `opengram_chat` | Create chats and send messages |
| `opengram_media` | Upload and attach files, images, and voice notes |
| `opengram_search` | Search across chats, messages, and tags |

The `opengram init` wizard auto-detects OpenClaw and configures the plugin for you.

Opengram is runtime-agnostic -- any framework that can make HTTP calls works. OpenClaw is just the batteries-included option.

## See It in Action

Try the [live demo](https://demo.opengram.sh) to see Opengram running with a sample agent.

<!-- Screenshots will be added here once available -->
<!-- <p align="center"><img src="..." width="800" alt="Opengram screenshot" /></p> -->

## Features

| | |
| --- | --- |
| Runtime-agnostic REST API | Real-time SSE streaming |
| Interactive requests | File attachments and media |
| Push notifications | Voice notes |
| Auto-rename chats | Tags, archive, and search |
| Mobile-first PWA | Tailscale-friendly |
| SQLite, zero external deps | Docker or direct install |

## How It Works

```
User <──> Opengram UI <──> REST API <──> Dispatch Queue <──> Your Agent
```

1. Your agent calls the Opengram API to create a chat and post messages.
2. The UI picks up new messages in real time via SSE.
3. When the agent needs user input, it sends an interactive request and waits.
4. The user responds through the chat UI; the agent receives the reply via callback or poll.
5. Media, files, and voice notes flow through the same API -- no sidecar services needed.

Read the [Building an Agent](https://docs.opengram.sh/building-an-agent) guide to get started.

## Tailscale Access

Opengram is designed to run on a private Tailscale network. Expose it with a single command:

```bash
tailscale serve --bg 3000
```

The `opengram init` wizard auto-detects Tailscale and configures HTTPS for you.

## Tech Stack

| Layer | Technology |
| --- | --- |
| API server | [Hono](https://hono.dev) |
| Frontend | React 19, Vite, Tailwind CSS v4 |
| Database | SQLite via [better-sqlite3](https://github.com/WiseLibs/better-sqlite3) |
| Language | TypeScript |
| Runtime | Node.js 20+ |

## Development

```bash
git clone https://github.com/opengramsh/opengram.git
cd opengram
npm ci
npm run dev
```

Run tests, type-checking, and lint:

```bash
npm test
npm run typecheck
npm run lint
```

## Documentation

| Resource | Link |
| --- | --- |
| Full docs | [docs.opengram.sh](https://docs.opengram.sh) |
| API reference | [docs.opengram.sh/api-reference](https://docs.opengram.sh/api-reference) |
| Quick start | [docs.opengram.sh/quick-start](https://docs.opengram.sh/quick-start) |
| Configuration | [docs.opengram.sh/configuration](https://docs.opengram.sh/configuration) |
| Building an agent | [docs.opengram.sh/building-an-agent](https://docs.opengram.sh/building-an-agent) |
| OpenClaw plugin | [docs.opengram.sh/openclaw-plugin](https://docs.opengram.sh/openclaw-plugin) |
| Deployment | [docs.opengram.sh/deployment](https://docs.opengram.sh/deployment) |

## License

MIT -- see [LICENSE](./LICENSE) for details.
