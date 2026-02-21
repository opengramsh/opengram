FROM node:20-bookworm AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM deps AS builder
COPY . .
RUN npm run build

FROM deps AS prod-deps
RUN npm prune --omit=dev

FROM node:20-bookworm-slim AS runner
WORKDIR /opt/opengram/web
ENV NODE_ENV=production \
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

COPY --from=builder /app/dist/server/ /opt/opengram/web/dist/server/
COPY --from=builder /app/dist/client/ /opt/opengram/web/dist/client/
COPY --from=builder /app/migrations/ /opt/opengram/web/migrations/
COPY --from=builder /app/deploy/docker/ /opt/opengram/web/deploy/docker/
COPY --from=builder /app/config/opengram.config.json /opt/opengram/config/opengram.config.json
COPY --from=prod-deps /app/node_modules/ /opt/opengram/web/node_modules/

RUN chmod +x /opt/opengram/web/deploy/docker/entrypoint.sh \
  && chown -R opengram:opengram /opt/opengram

USER opengram
EXPOSE 3000
VOLUME ["/opt/opengram/data"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -fsS http://127.0.0.1:3000/api/v1/health || exit 1

CMD ["/opt/opengram/web/deploy/docker/entrypoint.sh"]
