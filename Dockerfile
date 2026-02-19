FROM node:20-bookworm AS deps
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci

FROM deps AS builder
COPY . .
RUN npm run build

FROM node:20-bookworm-slim AS runner
WORKDIR /opt/opengram/web
ENV NODE_ENV=production \
  NEXT_TELEMETRY_DISABLED=1 \
  HOSTNAME=0.0.0.0 \
  PORT=3000 \
  DATABASE_URL=/opt/opengram/data/opengram.db \
  OPENGRAM_CONFIG_PATH=/opt/opengram/config/opengram.config.json

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl \
  && rm -rf /var/lib/apt/lists/* \
  && groupadd --system --gid 10001 opengram \
  && useradd --system --uid 10001 --gid opengram --home /opt/opengram/web --shell /usr/sbin/nologin opengram \
  && mkdir -p /opt/opengram/data/uploads /opt/opengram/config

COPY --from=builder /app/.next/standalone/ /opt/opengram/web/
COPY --from=builder /app/.next/static/ /opt/opengram/web/.next/static/
COPY --from=builder /app/public/ /opt/opengram/web/public/
COPY --from=builder /app/config/opengram.config.json /opt/opengram/config/opengram.config.json

RUN chown -R opengram:opengram /opt/opengram

USER opengram
EXPOSE 3000
VOLUME ["/opt/opengram/data"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -fsS http://127.0.0.1:3000/api/v1/health || exit 1

CMD ["node", "server.js"]
