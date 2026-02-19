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
2. Builds Next.js standalone output
3. Creates `/opt/opengram/web`, `/opt/opengram/data`, `/opt/opengram/config`
4. Runs Drizzle migrations for `/opt/opengram/data/opengram.db`
5. Installs `opengram-web.service`
6. Writes `/opt/opengram/config/opengram.env`
7. Generates default `/opt/opengram/config/opengram.config.json` (if missing)
8. Enables and starts the service

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

1. Install and authenticate Tailscale on the host:

```bash
sudo tailscale up
```

2. Enable HTTPS for the host in your Tailnet (MagicDNS should be enabled).
3. Access OpenGram using the Tailscale HTTPS URL for the machine.

Set `server.publicBaseUrl` in `/opt/opengram/config/opengram.config.json` to that HTTPS URL, then restart:

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

- Next.js standalone server
- `better-sqlite3` native addon support
- `VOLUME /opt/opengram/data` for SQLite DB and uploads
- Container health check on `GET /api/v1/health`

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
