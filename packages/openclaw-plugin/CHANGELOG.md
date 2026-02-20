# Changelog

## 0.1.0 (2026-02-19)

Initial release.

### Features

- Channel plugin with full OpenClaw `ChannelPlugin` interface
- Bidirectional messaging: inbound (SSE listener) and outbound (REST API)
- Delta-based streaming with per-dispatch isolation
- Four agent tools: `opengram_request`, `opengram_chat`, `opengram_media`, `opengram_search`
- Bundled agent skill for OpenGram-specific features
- API client with retry logic and exponential backoff
- Cursor-based SSE catch-up on reconnect
- Message deduplication (10,000 ID window)
- Chat-to-agent resolution with caching
- Heartbeat adapter with health check and recipient resolution
- Gateway lifecycle management with abort signal support
- Config schema with TypeBox validation
