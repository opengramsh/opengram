# Deployment

OpenGram supports two deployment paths:

- Direct install on Linux with `systemd` (primary)
- Docker container deployment (alternative)

## Direct Install (Primary)

### Host requirements

- Debian/Ubuntu host with `systemd`
- Root or sudo access
- Network access to fetch Node.js packages

### Install

Run from the repository root:

```bash
sudo ./install.sh
```

`install.sh` does the following:

1. Installs Node.js 20.x (if missing or too old)
2. Builds Hono + Vite output
3. Creates `/opt/opengram/web`, `/opt/opengram/data`, `/opt/opengram/config`
4. Runs SQL migrations for `/opt/opengram/data/opengram.db`
5. Installs `opengram-web.service`
6. Creates `/opt/opengram/config/opengram.env` (if missing)
7. Generates default `/opt/opengram/config/opengram.config.json` (if missing)
8. Enables service on boot and starts/restarts it for the deployed version

### Service management

```bash
sudo systemctl status opengram-web --no-pager
sudo systemctl restart opengram-web
```

Health endpoint:

```bash
curl -fsS http://127.0.0.1:3000/api/v1/health
```

### Filesystem layout

```text
/opt/opengram/
  web/
  data/
    opengram.db
    opengram.db-wal
    uploads/
  config/
    opengram.config.json
    opengram.env
```

## Tailscale TLS Setup

OpenGram is intended to run behind Tailscale. Keep OpenGram listening on local/private interfaces and expose HTTPS through your Tailnet.

### Option A: MagicDNS + `tailscale cert` (spec default)

1. Install and authenticate Tailscale on the host:

```bash
sudo tailscale up
```

2. In the Tailscale admin console, enable **MagicDNS** for the Tailnet.
3. Determine the host's MagicDNS name:

```bash
tailscale status --self --json | jq -r '.Self.DNSName'
```

4. Mint a certificate for that hostname:

```bash
sudo tailscale cert <hostname.ts.net>
```

`tailscale cert` writes a keypair in the working directory by default. Terminate TLS with that certificate using your reverse proxy, or use `tailscale serve` (below) for built-in HTTPS forwarding.

5. Set `server.publicBaseUrl` in `/opt/opengram/config/opengram.config.json` to your HTTPS URL and restart OpenGram:

```bash
sudo systemctl restart opengram-web
```

### Option B: `tailscale serve` HTTPS forwarding

Use Tailscale to terminate TLS and forward to local OpenGram:

```bash
sudo tailscale serve --https=443 http://127.0.0.1:3000
```

Then set `server.publicBaseUrl` to the `https://<hostname>.ts.net` URL and restart OpenGram:

```bash
sudo systemctl restart opengram-web
```

## Docker (Alternative)

Build:

```bash
docker build -t opengram/web:latest .
```

Run:

```bash
docker run -d \
  --name opengram-web \
  -p 3000:3000 \
  -v opengram_data:/opt/opengram/data \
  -v "$(pwd)/config:/opt/opengram/config" \
  opengram/web:latest
```

The image includes:

- Hono server bundle + Vite static assets
- `better-sqlite3` native addon support
- Container startup migrations before server launch
- `VOLUME /opt/opengram/data` for SQLite DB and uploads
- Container health check on `GET /api/v1/health`

On each container boot, `deploy/docker/entrypoint.sh` runs `deploy/docker/run-migrations.js` first. It applies any pending SQL files from `migrations/` (tracked in `__opengram_migrations`) and then starts `node dist/server/server.mjs`.

## Optional Reverse Proxy (Non-Tailscale)

If you do not use Tailscale TLS, place a reverse proxy in front of OpenGram.

### Caddy example

```caddyfile
opengram.example.com {
  reverse_proxy 127.0.0.1:3000
}
```

### nginx example

```nginx
server {
  listen 443 ssl;
  server_name opengram.example.com;

  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}
```
