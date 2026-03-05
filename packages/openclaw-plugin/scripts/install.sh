#!/bin/sh
set -eu

# OpenGram OpenClaw plugin installer — installs the plugin and runs the setup wizard.

BOLD="\033[1m"
RED="\033[0;31m"
GREEN="\033[0;32m"
YELLOW="\033[0;33m"
RESET="\033[0m"

info()  { printf "${GREEN}▸${RESET} %s\n" "$1"; }
warn()  { printf "${YELLOW}▸${RESET} %s\n" "$1"; }
error() { printf "${RED}✗${RESET} %s\n" "$1" >&2; }

# ── Check Node.js ──────────────────────────────────────────────

if ! command -v node >/dev/null 2>&1; then
  error "Node.js is not installed."
  echo ""
  echo "The OpenGram OpenClaw plugin requires Node.js 20 or later."
  echo "Install it from: https://nodejs.org/"
  exit 1
fi

NODE_VERSION=$(node -e "console.log(process.versions.node.split('.')[0])")
if [ "$NODE_VERSION" -lt 20 ] 2>/dev/null; then
  error "Node.js v${NODE_VERSION} detected — requires v20 or later."
  echo "  Current: $(node --version)"
  echo "  Update:  https://nodejs.org/"
  exit 1
fi

info "Node.js $(node --version) detected"

# ── Check OpenClaw ─────────────────────────────────────────────

if ! command -v openclaw >/dev/null 2>&1; then
  error "OpenClaw CLI not found on PATH."
  echo ""
  echo "Install OpenClaw first: https://openclaw.ai"
  echo "Then re-run this script."
  exit 1
fi

info "OpenClaw CLI detected"

# ── Install plugin ─────────────────────────────────────────────

INSTALL_CMD="npm --loglevel error --silent --no-fund --no-audit install -g @opengramsh/openclaw-plugin"

echo ""
printf "${BOLD}Installing @opengramsh/openclaw-plugin...${RESET}\n"

if ! $INSTALL_CMD; then
  echo ""
  error "Installation failed."
  echo ""
  echo "If you got a permission error, try one of:"
  echo "  sudo npm --loglevel error --silent --no-fund --no-audit install -g @opengramsh/openclaw-plugin"
  echo "  npm install -g @opengramsh/openclaw-plugin --prefix ~/.local"
  echo ""
  echo "Or configure npm to use a user-writable directory:"
  echo "  mkdir -p ~/.npm-global"
  echo "  npm config set prefix ~/.npm-global"
  echo "  export PATH=~/.npm-global/bin:\$PATH"
  exit 1
fi

info "Plugin installed successfully"

# ── Run setup wizard ───────────────────────────────────────────

echo ""

if [ "${1:-}" = "--no-prompt" ]; then
  info "Skipping setup wizard (--no-prompt)"
  echo ""
  echo "Run 'opengram-openclaw setup' to configure the plugin."
  exit 0
fi

printf "${BOLD}Running setup wizard...${RESET}\n"
echo ""
opengram-openclaw setup < /dev/tty
