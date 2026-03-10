#!/usr/bin/env bash
#
# Bump the macOS app version and regenerate the Xcode project.
#
# Usage:
#   ./scripts/bump-version.sh --patch          # 0.1.0 → 0.1.1
#   ./scripts/bump-version.sh --minor          # 0.1.0 → 0.2.0
#   ./scripts/bump-version.sh --major          # 0.1.0 → 1.0.0
#   ./scripts/bump-version.sh 0.2.0            # explicit version
#   ./scripts/bump-version.sh 0.2.0 42         # explicit version + build number

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
PROJECT_YML="$PROJECT_DIR/project.yml"

# Read current version from project.yml
CURRENT="$(grep 'MARKETING_VERSION:' "$PROJECT_YML" | head -1 | sed 's/.*"\(.*\)".*/\1/')"
IFS='.' read -r CUR_MAJOR CUR_MINOR CUR_PATCH <<< "$CURRENT"

VERSION=""
BUILD_NUMBER=""

case "${1:-}" in
  --patch)
    VERSION="$CUR_MAJOR.$CUR_MINOR.$((CUR_PATCH + 1))"
    BUILD_NUMBER="${2:-}"
    ;;
  --minor)
    VERSION="$CUR_MAJOR.$((CUR_MINOR + 1)).0"
    BUILD_NUMBER="${2:-}"
    ;;
  --major)
    VERSION="$((CUR_MAJOR + 1)).0.0"
    BUILD_NUMBER="${2:-}"
    ;;
  ""|--help|-h)
    echo "Usage: $0 <--patch|--minor|--major|version> [build-number]"
    echo ""
    echo "Current version: $CURRENT"
    echo ""
    echo "Options:"
    echo "  --patch    $CURRENT → $CUR_MAJOR.$CUR_MINOR.$((CUR_PATCH + 1))"
    echo "  --minor    $CURRENT → $CUR_MAJOR.$((CUR_MINOR + 1)).0"
    echo "  --major    $CURRENT → $((CUR_MAJOR + 1)).0.0"
    echo "  <version>  Set an explicit version (e.g. 0.2.0)"
    exit 1
    ;;
  -*)
    echo "Error: Unknown option '$1'" >&2
    exit 1
    ;;
  *)
    VERSION="$1"
    BUILD_NUMBER="${2:-}"
    ;;
esac

echo "==> $CURRENT → $VERSION"

# Update MARKETING_VERSION
sed -i '' "s/MARKETING_VERSION: \".*\"/MARKETING_VERSION: \"$VERSION\"/" "$PROJECT_YML"

# Update CURRENT_PROJECT_VERSION if provided
if [[ -n "$BUILD_NUMBER" ]]; then
  sed -i '' "s/CURRENT_PROJECT_VERSION: \".*\"/CURRENT_PROJECT_VERSION: \"$BUILD_NUMBER\"/" "$PROJECT_YML"
  echo "==> Set CURRENT_PROJECT_VERSION to $BUILD_NUMBER"
fi

# Regenerate Xcode project
if command -v xcodegen &>/dev/null; then
  echo "==> Regenerating Xcode project..."
  (cd "$PROJECT_DIR" && xcodegen generate)
else
  echo "Error: xcodegen not found. Install with: brew install xcodegen" >&2
  exit 1
fi

echo "==> Done! Version is now $VERSION"
