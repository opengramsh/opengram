#!/usr/bin/env bash
#
# Build, sign, notarize, and package Opengram as a DMG.
#
# Required env vars:
#   DEVELOPMENT_TEAM   — Apple Developer Team ID (10-char, e.g. XXXXXXXXXX)
#   APPLE_ID           — Apple ID email for notarization
#   APPLE_ID_PASSWORD  — App-specific password (NOT your Apple ID password)
#
# Optional env vars:
#   MARKETING_VERSION             — e.g. "1.0.0" (defaults to value in project.yml)
#   BUILD_NUMBER                  — e.g. "42"   (defaults to value in project.yml)
#   NOTARY_WAIT_TIMEOUT_SECONDS   — max time to poll a notarization request (default: 600)
#   NOTARY_POLL_INTERVAL_SECONDS  — polling interval while waiting (default: 15)
#   SPARKLE_EDDSA_KEY             — EdDSA private key for Sparkle signing (base64)
#   SPARKLE_BIN_DIR               — path to Sparkle CLI tools (sign_update, generate_appcast)
#
# Usage:
#   cd apps/macos
#   ./scripts/build-and-notarize.sh
#   ./scripts/build-and-notarize.sh --submission-id <app-submission-id>
#   ./scripts/build-and-notarize.sh --dmg-submission-id <dmg-submission-id>
#
# The script auto-loads .env.build from the apps/macos/ directory if it exists.
# Create it with:
#   DEVELOPMENT_TEAM=XXXXXXXXXX
#   APPLE_ID=you@example.com
#   APPLE_ID_PASSWORD=xxxx-xxxx-xxxx-xxxx

set -euo pipefail

print_usage() {
  cat <<EOF
Usage:
  ./scripts/build-and-notarize.sh [--submission-id <app-submission-id>] [--dmg-submission-id <dmg-submission-id>]

Options:
  --submission-id, --app-submission-id  Resume from an existing app notarization submission ID.
                                        Requires an existing exported app at build/export/Opengram.app.
  --dmg-submission-id                   Resume from an existing DMG notarization submission ID.
                                        Requires an existing DMG at build/Opengram.dmg.
  -h, --help                            Show this help message.
EOF
}

APP_SUBMISSION_ID="${APP_SUBMISSION_ID:-}"
DMG_SUBMISSION_ID="${DMG_SUBMISSION_ID:-}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --submission-id|--app-submission-id)
      if [[ $# -lt 2 ]]; then
        echo "Error: $1 requires a submission ID." >&2
        exit 1
      fi
      APP_SUBMISSION_ID="$2"
      shift 2
      ;;
    --dmg-submission-id)
      if [[ $# -lt 2 ]]; then
        echo "Error: $1 requires a submission ID." >&2
        exit 1
      fi
      DMG_SUBMISSION_ID="$2"
      shift 2
      ;;
    -h|--help)
      print_usage
      exit 0
      ;;
    *)
      echo "Error: Unknown argument '$1'." >&2
      print_usage >&2
      exit 1
      ;;
  esac
done

if [[ -n "$APP_SUBMISSION_ID" && -n "$DMG_SUBMISSION_ID" ]]; then
  echo "Error: Specify either an app submission ID or a DMG submission ID, not both." >&2
  exit 1
fi

# ── Load .env.build if present ───────────────────────────────────────────────

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ENV_FILE="$(cd "$SCRIPT_DIR/.." && pwd)/.env.build"

if [[ -f "$ENV_FILE" ]]; then
  echo "==> Loading env vars from $ENV_FILE"
  set -a
  source "$ENV_FILE"
  set +a
fi

# ── Validate required env vars ───────────────────────────────────────────────

for var in DEVELOPMENT_TEAM APPLE_ID APPLE_ID_PASSWORD; do
  if [[ -z "${!var:-}" ]]; then
    echo "Error: $var is not set." >&2
    exit 1
  fi
done

# ── Config ───────────────────────────────────────────────────────────────────

PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
SCHEME="Opengram"
BUILD_DIR="$PROJECT_DIR/build"
ARCHIVE_PATH="$BUILD_DIR/$SCHEME.xcarchive"
EXPORT_DIR="$BUILD_DIR/export"
EXPORT_OPTIONS="$BUILD_DIR/ExportOptions.plist"
DMG_PATH="$BUILD_DIR/$SCHEME.dmg"
APP_PATH="$EXPORT_DIR/$SCHEME.app"
APP_ZIP="$BUILD_DIR/$SCHEME-app.zip"
NOTARY_WAIT_TIMEOUT_SECONDS="${NOTARY_WAIT_TIMEOUT_SECONDS:-600}"
NOTARY_POLL_INTERVAL_SECONDS="${NOTARY_POLL_INTERVAL_SECONDS:-15}"
NOTARY_AUTH_ARGS=(
  --apple-id "$APPLE_ID"
  --password "$APPLE_ID_PASSWORD"
  --team-id "$DEVELOPMENT_TEAM"
)

VERSION_OVERRIDES=""
if [[ -n "${MARKETING_VERSION:-}" ]]; then
  VERSION_OVERRIDES+=" MARKETING_VERSION=$MARKETING_VERSION"
fi
if [[ -n "${BUILD_NUMBER:-}" ]]; then
  VERSION_OVERRIDES+=" CURRENT_PROJECT_VERSION=$BUILD_NUMBER"
fi

require_path() {
  local path="$1"
  local description="$2"

  if [[ ! -e "$path" ]]; then
    echo "Error: $description not found at $path." >&2
    exit 1
  fi
}

extract_json_field() {
  local json_payload="$1"
  local field="$2"

  JSON_PAYLOAD="$json_payload" /usr/bin/python3 - "$field" <<'PY'
import json
import os
import sys

field = sys.argv[1]
data = json.loads(os.environ["JSON_PAYLOAD"])
value = data.get(field, "")
if value is None:
    value = ""
print(value)
PY
}

submit_for_notarization() {
  local artifact_path="$1"
  local artifact_label="$2"
  local response
  local submission_id

  echo "==> Submitting $artifact_label for notarization..." >&2
  response="$(
    xcrun notarytool submit "$artifact_path" \
      "${NOTARY_AUTH_ARGS[@]}" \
      --no-wait \
      -f json
  )"

  submission_id="$(extract_json_field "$response" "id")"

  if [[ -z "$submission_id" ]]; then
    echo "Error: notarytool did not return a submission ID for $artifact_label." >&2
    printf '%s\n' "$response" >&2
    exit 1
  fi

  echo "==> $artifact_label submission ID: $submission_id" >&2
  printf '%s\n' "$submission_id"
}

wait_for_notarization() {
  local submission_id="$1"
  local artifact_label="$2"
  local log_path="$BUILD_DIR/${artifact_label}-notary-log.json"
  local started_at
  local info_json
  local status
  local now
  local elapsed

  started_at="$(date +%s)"

  while true; do
    info_json="$(
      xcrun notarytool info "$submission_id" \
        "${NOTARY_AUTH_ARGS[@]}" \
        -f json
    )"
    status="$(extract_json_field "$info_json" "status")"

    now="$(date +%s)"
    elapsed=$((now - started_at))

    echo "==> $artifact_label notarization status: ${status:-unknown} (${elapsed}s elapsed)"

    case "$status" in
      Accepted)
        return 0
        ;;
      "In Progress")
        if (( elapsed >= NOTARY_WAIT_TIMEOUT_SECONDS )); then
          echo "Error: Timed out waiting for $artifact_label notarization after ${NOTARY_WAIT_TIMEOUT_SECONDS}s." >&2
          echo "Resume with:" >&2
          if [[ "$artifact_label" == "app" ]]; then
            echo "  ./scripts/build-and-notarize.sh --submission-id $submission_id" >&2
          else
            echo "  ./scripts/build-and-notarize.sh --dmg-submission-id $submission_id" >&2
          fi
          return 2
        fi
        sleep "$NOTARY_POLL_INTERVAL_SECONDS"
        ;;
      *)
        echo "Error: $artifact_label notarization finished with status '$status'." >&2
        if xcrun notarytool log "$submission_id" "${NOTARY_AUTH_ARGS[@]}" "$log_path"; then
          echo "Saved notarization log to $log_path" >&2
        fi
        return 1
        ;;
    esac
  done
}

create_dmg() {
  local dmg_staging="$BUILD_DIR/dmg-staging"

  echo "==> Creating DMG..."
  rm -rf "$dmg_staging" "$DMG_PATH"
  mkdir -p "$dmg_staging"
  cp -R "$APP_PATH" "$dmg_staging/"
  ln -s /Applications "$dmg_staging/Applications"

  hdiutil create \
    -volname "$SCHEME" \
    -srcfolder "$dmg_staging" \
    -ov \
    -format UDZO \
    "$DMG_PATH"

  rm -rf "$dmg_staging"
}

if [[ -z "$APP_SUBMISSION_ID" && -z "$DMG_SUBMISSION_ID" ]]; then
  # ── Regenerate Xcode project (if xcodegen is available) ────────────────────

  if command -v xcodegen &>/dev/null; then
    echo "==> Regenerating Xcode project with XcodeGen..."
    (cd "$PROJECT_DIR" && xcodegen generate)
  else
    echo "==> xcodegen not found, using existing .xcodeproj"
  fi

  # ── Clean build directory ──────────────────────────────────────────────────

  rm -rf "$BUILD_DIR"
  mkdir -p "$BUILD_DIR"

  # ── Generate ExportOptions.plist ───────────────────────────────────────────

  echo "==> Generating ExportOptions.plist..."
  cat > "$EXPORT_OPTIONS" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>method</key>
    <string>developer-id</string>
    <key>teamID</key>
    <string>${DEVELOPMENT_TEAM}</string>
    <key>signingStyle</key>
    <string>automatic</string>
</dict>
</plist>
PLIST

  # ── Archive ────────────────────────────────────────────────────────────────

  echo "==> Archiving..."
  xcodebuild archive \
    -project "$PROJECT_DIR/$SCHEME.xcodeproj" \
    -scheme "$SCHEME" \
    -destination "generic/platform=macOS" \
    -configuration Release \
    -archivePath "$ARCHIVE_PATH" \
    DEVELOPMENT_TEAM="$DEVELOPMENT_TEAM" \
    CODE_SIGN_STYLE=Manual \
    CODE_SIGN_IDENTITY="Developer ID Application" \
    $VERSION_OVERRIDES

  # ── Export ─────────────────────────────────────────────────────────────────

  echo "==> Exporting archive..."
  xcodebuild -exportArchive \
    -archivePath "$ARCHIVE_PATH" \
    -exportPath "$EXPORT_DIR" \
    -exportOptionsPlist "$EXPORT_OPTIONS"
else
  echo "==> Resuming notarization workflow without rebuilding artifacts..."
fi

if [[ -n "$DMG_SUBMISSION_ID" ]]; then
  echo "==> Resuming DMG notarization with submission ID: $DMG_SUBMISSION_ID"
  require_path "$DMG_PATH" "DMG"
else
  require_path "$APP_PATH" "Exported app"

  if [[ -n "$APP_SUBMISSION_ID" ]]; then
    echo "==> Resuming app notarization with submission ID: $APP_SUBMISSION_ID"
  else
    echo "==> Preparing app zip for notarization..."
    ditto -c -k --keepParent "$APP_PATH" "$APP_ZIP"
    APP_SUBMISSION_ID="$(submit_for_notarization "$APP_ZIP" "app")"
  fi

  if wait_for_notarization "$APP_SUBMISSION_ID" "app"; then
    rm -f "$APP_ZIP"
  else
    wait_status=$?
    exit "$wait_status"
  fi

  echo "==> Stapling notarization ticket to app..."
  xcrun stapler staple "$APP_PATH"

  create_dmg
  DMG_SUBMISSION_ID="$(submit_for_notarization "$DMG_PATH" "dmg")"
fi

if wait_for_notarization "$DMG_SUBMISSION_ID" "dmg"; then
  :
else
  wait_status=$?
  exit "$wait_status"
fi

echo "==> Stapling notarization ticket to DMG..."
xcrun stapler staple "$DMG_PATH"

# ── Sparkle signing (optional) ───────────────────────────────────────────────

if [[ -n "${SPARKLE_EDDSA_KEY:-}" ]]; then
  SPARKLE_BIN_DIR="${SPARKLE_BIN_DIR:-}"

  sign_update_bin="sign_update"
  generate_appcast_bin="generate_appcast"
  if [[ -n "$SPARKLE_BIN_DIR" ]]; then
    sign_update_bin="$SPARKLE_BIN_DIR/sign_update"
    generate_appcast_bin="$SPARKLE_BIN_DIR/generate_appcast"
  fi

  echo "==> Signing DMG with Sparkle EdDSA key..."
  SPARKLE_SIG="$(echo "$SPARKLE_EDDSA_KEY" | "$sign_update_bin" --ed-key-file - "$DMG_PATH")"
  echo "   Sparkle signature: $SPARKLE_SIG"

  DOWNLOAD_URL_PREFIX="https://github.com/opengramsh/opengram/releases/download/v${MARKETING_VERSION:-0.1.0}"
  echo "==> Generating appcast.xml..."
  echo "$SPARKLE_EDDSA_KEY" | "$generate_appcast_bin" \
    --ed-key-file - \
    --download-url-prefix "$DOWNLOAD_URL_PREFIX/" \
    "$BUILD_DIR"

  APPCAST_PATH="$BUILD_DIR/appcast.xml"
  if [[ -f "$APPCAST_PATH" ]]; then
    cp "$APPCAST_PATH" "$PROJECT_DIR/appcast.xml"
    echo "   Appcast copied to: $PROJECT_DIR/appcast.xml"
  else
    echo "   Warning: appcast.xml was not generated (expected at $APPCAST_PATH)"
  fi
else
  echo "==> Skipping Sparkle signing (SPARKLE_EDDSA_KEY not set)"
fi

# ── Done ─────────────────────────────────────────────────────────────────────

echo ""
echo "✅ Done! Signed & notarized DMG at:"
echo "   $DMG_PATH"
echo ""
echo "Verify with:"
echo "   spctl --assess --verbose $APP_PATH"
