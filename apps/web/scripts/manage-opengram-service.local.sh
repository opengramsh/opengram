#!/usr/bin/env bash
set -euo pipefail

SERVICE_NAME="opengram.service"
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MONOREPO_ROOT="$(cd "${REPO_DIR}/../.." && pwd)"
HEALTH_URL="https://ubuntu-8gb-hel1-1.tail658b5f.ts.net:8443/api/v1/health"
SERVICE_STARTUP_TIMEOUT_SEC=30
HEALTH_RETRIES=30
OPENCLAW_CONFIG_PATH="${OPENCLAW_CONFIG_PATH:-$HOME/.openclaw/openclaw.json}"

usage() {
  cat <<'EOF'
Usage:
  ./scripts/manage-opengram-service.local.sh [command]

Commands:
  update   Run npm ci, build, restart service, and verify health (default)
  restart  Restart service only
  status   Show service status
  logs     Follow service logs
  health   Check public health endpoint
EOF
}

is_openclaw_plugin_configured() {
  [[ -f "${OPENCLAW_CONFIG_PATH}" ]] && grep -q '"@opengramsh/openclaw-plugin"' "${OPENCLAW_CONFIG_PATH}"
}

require_service() {
  if ! systemctl --user list-unit-files "${SERVICE_NAME}" 2>/dev/null | grep -q "^${SERVICE_NAME}"; then
    echo "Error: ${SERVICE_NAME} is not installed for this user." >&2
    exit 1
  fi
}

ensure_service_unit_is_current() {
  local unit_path
  unit_path="$(systemctl --user show -p FragmentPath --value "${SERVICE_NAME}" 2>/dev/null || true)"
  if [[ -z "${unit_path}" || ! -f "${unit_path}" ]]; then
    return
  fi

  # Keep existing local units working after the server artifact rename (.mjs -> .js).
  if grep -q "dist/server/server.mjs" "${unit_path}"; then
    echo "Detected stale ExecStart in ${unit_path}; updating to server.js"
    sed -i 's#dist/server/server\.mjs#dist/server/server.js#g' "${unit_path}"
    systemctl --user daemon-reload
  fi
}

wait_for_service_active() {
  local i
  for ((i = 1; i <= SERVICE_STARTUP_TIMEOUT_SEC; i++)); do
    if systemctl --user is-active --quiet "${SERVICE_NAME}"; then
      return 0
    fi
    sleep 1
  done

  echo "Error: ${SERVICE_NAME} did not become active within ${SERVICE_STARTUP_TIMEOUT_SEC}s." >&2
  systemctl --user status "${SERVICE_NAME}" --no-pager || true
  journalctl --user -u "${SERVICE_NAME}" -n 80 --no-pager || true
  exit 1
}

run_health_check() {
  if ! curl -fsS --retry "${HEALTH_RETRIES}" --retry-delay 1 --retry-all-errors "${HEALTH_URL}" >/dev/null 2>&1; then
    echo "Error: health check failed after restart." >&2
    systemctl --user status "${SERVICE_NAME}" --no-pager || true
    journalctl --user -u "${SERVICE_NAME}" -n 80 --no-pager || true
    exit 1
  fi
  curl -fsS "${HEALTH_URL}"
  echo
}

cmd_update() {
  require_service
  ensure_service_unit_is_current
  cd "${MONOREPO_ROOT}"
  echo "[1/9] Pulling latest changes"
  git pull --ff-only
  echo "[2/9] Installing dependencies"
  npm ci --no-audit --fund=false --loglevel=error
  echo "[3/9] Building OpenGram"
  npm run -w apps/web build
  if is_openclaw_plugin_configured; then
    echo "[4/9] Building OpenClaw plugin dist (local repo)"
    npm run -w packages/openclaw-plugin build
    echo "[5/9] Updating global OpenClaw plugin from local repo"
    npm install -g ./packages/openclaw-plugin
  else
    echo "[4/9] Skipping OpenClaw plugin update (not configured)"
  fi
  echo "[6/9] Updating global OpenGram install"
  npm install -g ./apps/web
  echo "[7/9] Restarting ${SERVICE_NAME}"
  systemctl --user restart "${SERVICE_NAME}"
  wait_for_service_active
  if is_openclaw_plugin_configured && command -v openclaw >/dev/null 2>&1; then
    echo "[8/9] Restarting OpenClaw gateway"
    openclaw gateway restart
  else
    echo "[8/9] Skipping OpenClaw gateway restart"
  fi
  echo "[9/9] Health check"
  run_health_check
  echo "Update completed."
}

cmd_restart() {
  require_service
  ensure_service_unit_is_current
  systemctl --user restart "${SERVICE_NAME}"
  wait_for_service_active
  systemctl --user status "${SERVICE_NAME}" --no-pager
}

cmd_status() {
  require_service
  systemctl --user status "${SERVICE_NAME}" --no-pager
}

cmd_logs() {
  require_service
  journalctl --user -u "${SERVICE_NAME}" -f
}

cmd_health() {
  run_health_check
}

cmd="${1:-update}"
case "${cmd}" in
  update) cmd_update ;;
  restart) cmd_restart ;;
  status) cmd_status ;;
  logs) cmd_logs ;;
  health) cmd_health ;;
  -h|--help|help) usage ;;
  *)
    echo "Unknown command: ${cmd}" >&2
    usage
    exit 1
    ;;
esac
