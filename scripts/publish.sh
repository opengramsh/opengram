#!/usr/bin/env bash
set -euo pipefail

# Publish @opengramsh/opengram and the opengramsh wrapper in one go.
# Usage: ./publish.sh [--dry-run]

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
WRAPPER_DIR="$ROOT_DIR/packages/opengramsh"
DRY_RUN=""

if [[ "${1:-}" == "--dry-run" ]]; then
  DRY_RUN="--dry-run"
fi

VERSION=$(node -p "require('$ROOT_DIR/package.json').version")
echo "Publishing v$VERSION"

# 1. Publish @opengramsh/opengram
echo ""
echo "==> @opengramsh/opengram"
cd "$ROOT_DIR"
npm publish --access public $DRY_RUN

# 2. Sync wrapper version and publish
echo ""
echo "==> opengramsh (wrapper)"
node -e "
const fs = require('fs');
const path = '$WRAPPER_DIR/package.json';
const pkg = JSON.parse(fs.readFileSync(path, 'utf8'));
pkg.version = '$VERSION';
pkg.dependencies['@opengramsh/opengram'] = '$VERSION';
fs.writeFileSync(path, JSON.stringify(pkg, null, 2) + '\n');
"
cd "$WRAPPER_DIR"
npm publish --access public $DRY_RUN

echo ""
echo "Done — published v$VERSION"
