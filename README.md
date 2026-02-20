# OpenGram

OpenGram is a mobile-first chat + task-review app for AI agent workflows, built with Next.js and SQLite.

## Development

Install dependencies and run local dev:

```bash
npm ci
npm run dev
```

Run tests:

```bash
npm test
```

## Deployment

Direct install (primary):

```bash
sudo ./install.sh
```

Full deployment docs, including Tailscale TLS and optional reverse proxy setup:

- `docs/deployment.md`

Docker (alternative):

```bash
docker build -t opengram/web:latest .
docker run -d -p 3000:3000 -v opengram_data:/opt/opengram/data opengram/web:latest
```

Health check endpoint:

```bash
curl -fsS http://127.0.0.1:3000/api/v1/health
```
