#!/usr/bin/env bash
set -euo pipefail

APP_USER="opengram"
APP_GROUP="opengram"
INSTALL_ROOT="/opt/opengram"
WEB_DIR="${INSTALL_ROOT}/web"
DATA_DIR="${INSTALL_ROOT}/data"
CONFIG_DIR="${INSTALL_ROOT}/config"
SERVICE_NAME="opengram-web.service"
SERVICE_SRC="deploy/systemd/${SERVICE_NAME}"
SERVICE_DST="/etc/systemd/system/${SERVICE_NAME}"
ENV_FILE="${CONFIG_DIR}/opengram.env"
CONFIG_FILE="${CONFIG_DIR}/opengram.config.json"
MIN_NODE_MAJOR=20

log() {
  printf '[opengram-install] %s\n' "$1"
}

require_root() {
  if [[ "${EUID}" -ne 0 ]]; then
    echo "install.sh must run as root (or with sudo)." >&2
    exit 1
  fi
}

require_project_root() {
  if [[ ! -f "package.json" || ! -f "next.config.ts" ]]; then
    echo "Run install.sh from the OpenGram repository root." >&2
    exit 1
  fi
}

install_nodejs() {
  log "Installing Node.js ${MIN_NODE_MAJOR}.x via NodeSource (apt)..."
  apt-get update
  apt-get install -y ca-certificates curl gnupg
  curl -fsSL "https://deb.nodesource.com/setup_${MIN_NODE_MAJOR}.x" | bash -
  apt-get install -y nodejs
}

ensure_nodejs() {
  if ! command -v node >/dev/null 2>&1; then
    install_nodejs
    return
  fi

  local major
  major="$(node -p 'process.versions.node.split(".")[0]')"
  if (( major < MIN_NODE_MAJOR )); then
    log "Detected Node.js v${major}; upgrading to ${MIN_NODE_MAJOR}.x."
    install_nodejs
  fi
}

ensure_build_tools() {
  if ! command -v apt-get >/dev/null 2>&1; then
    echo "Only apt-based distributions are supported by install.sh." >&2
    exit 1
  fi

  apt-get update
  apt-get install -y build-essential python3 rsync
}

ensure_service_user() {
  if ! getent group "${APP_GROUP}" >/dev/null; then
    groupadd --system "${APP_GROUP}"
  fi

  if ! id -u "${APP_USER}" >/dev/null 2>&1; then
    useradd \
      --system \
      --gid "${APP_GROUP}" \
      --home-dir "${WEB_DIR}" \
      --shell /usr/sbin/nologin \
      "${APP_USER}"
  fi
}

prepare_directories() {
  mkdir -p "${WEB_DIR}" "${DATA_DIR}/uploads" "${CONFIG_DIR}"
  chown -R "${APP_USER}:${APP_GROUP}" "${INSTALL_ROOT}"
  chmod 0750 "${INSTALL_ROOT}" "${DATA_DIR}" "${CONFIG_DIR}"
}

build_application() {
  log "Installing dependencies and building standalone bundle..."
  npm ci
  npm run build
}

deploy_standalone() {
  log "Deploying Next.js standalone output to ${WEB_DIR}..."
  rsync -a --delete .next/standalone/ "${WEB_DIR}/"
  mkdir -p "${WEB_DIR}/.next"
  rsync -a --delete .next/static/ "${WEB_DIR}/.next/static/"
  if [[ -d "public" ]]; then
    rsync -a --delete public/ "${WEB_DIR}/public/"
  fi

  chown -R "${APP_USER}:${APP_GROUP}" "${WEB_DIR}"
}

ensure_default_config() {
  if [[ ! -f "${CONFIG_FILE}" ]]; then
    log "Creating default config: ${CONFIG_FILE}"
    install -m 0640 config/opengram.config.json "${CONFIG_FILE}"
    chown "${APP_USER}:${APP_GROUP}" "${CONFIG_FILE}"
  else
    log "Config exists; leaving it unchanged: ${CONFIG_FILE}"
  fi
}

write_env_file() {
  if [[ -f "${ENV_FILE}" ]]; then
    log "Env file exists; leaving it unchanged: ${ENV_FILE}"
    return
  fi

  cat >"${ENV_FILE}" <<EOF
NODE_ENV=production
HOSTNAME=0.0.0.0
PORT=3000
DATABASE_URL=${DATA_DIR}/opengram.db
OPENGRAM_CONFIG_PATH=${CONFIG_FILE}
OPENGRAM_PUBLIC_BASE_URL=http://localhost:3000
EOF
  chown "${APP_USER}:${APP_GROUP}" "${ENV_FILE}"
  chmod 0640 "${ENV_FILE}"
}

run_migrations() {
  log "Running database migrations..."
  DATABASE_URL="${DATA_DIR}/opengram.db" npm run db:migrate
  chown -R "${APP_USER}:${APP_GROUP}" "${DATA_DIR}"
}

install_systemd_unit() {
  if [[ ! -f "${SERVICE_SRC}" ]]; then
    echo "Missing service template: ${SERVICE_SRC}" >&2
    exit 1
  fi

  install -m 0644 "${SERVICE_SRC}" "${SERVICE_DST}"
  systemctl daemon-reload
  systemctl enable "${SERVICE_NAME}"
  if systemctl is-active --quiet "${SERVICE_NAME}"; then
    systemctl restart "${SERVICE_NAME}"
  else
    systemctl start "${SERVICE_NAME}"
  fi
}

print_next_steps() {
  log "Install completed."
  log "Service status: systemctl status ${SERVICE_NAME} --no-pager"
  log "Health check: curl -fsS http://127.0.0.1:3000/api/v1/health"
}

main() {
  require_root
  require_project_root
  ensure_build_tools
  ensure_nodejs
  ensure_service_user
  prepare_directories
  build_application
  deploy_standalone
  ensure_default_config
  write_env_file
  run_migrations
  install_systemd_unit
  print_next_steps
}

main "$@"
