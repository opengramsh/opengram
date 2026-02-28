#!/bin/sh
set -eu

# OpenGram installer — checks prerequisites, installs via npm, runs setup wizard.

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
  echo "OpenGram requires Node.js 20 or later."
  echo "Install it from: https://nodejs.org/"
  echo ""
  echo "Or use a version manager:"
  echo "  curl -fsSL https://fnm.vercel.app/install | bash && fnm install 22"
  echo "  curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash && nvm install 22"
  exit 1
fi

NODE_VERSION=$(node -e "console.log(process.versions.node.split('.')[0])")
if [ "$NODE_VERSION" -lt 20 ] 2>/dev/null; then
  error "Node.js v${NODE_VERSION} detected — OpenGram requires v20 or later."
  echo "  Current: $(node --version)"
  echo "  Update:  https://nodejs.org/"
  exit 1
fi

info "Node.js $(node --version) detected"

# ── Detect package manager ─────────────────────────────────────

if command -v pnpm >/dev/null 2>&1; then
  PKG_MGR="pnpm"
  INSTALL_CMD="pnpm add -g opengram"
elif command -v bun >/dev/null 2>&1; then
  PKG_MGR="bun"
  INSTALL_CMD="bun add -g opengram"
else
  PKG_MGR="npm"
  INSTALL_CMD="npm install -g opengram"
fi

info "Using $PKG_MGR to install"

# ── Install OpenGram ───────────────────────────────────────────

echo ""
printf "${BOLD}Installing OpenGram...${RESET}\n"

if ! $INSTALL_CMD; then
  echo ""
  error "Installation failed."
  if [ "$PKG_MGR" = "npm" ]; then
    echo ""
    echo "If you got a permission error, try one of:"
    echo "  sudo npm install -g opengram"
    echo "  npm install -g opengram --prefix ~/.local"
    echo ""
    echo "Or configure npm to use a user-writable directory:"
    echo "  mkdir -p ~/.npm-global"
    echo "  npm config set prefix ~/.npm-global"
    echo "  export PATH=~/.npm-global/bin:\$PATH"
  fi
  exit 1
fi

info "OpenGram installed successfully"

# ── Run setup wizard ───────────────────────────────────────────

echo ""

if [ "${1:-}" = "--no-prompt" ]; then
  info "Skipping setup wizard (--no-prompt)"
  echo ""
  echo "Run 'opengram init' to configure, then 'opengram start' to run."
  exit 0
fi

printf "${BOLD}Running setup wizard...${RESET}\n"
echo ""
opengram init
