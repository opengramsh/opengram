#!/usr/bin/env bash

set -euo pipefail

print_usage() {
  cat <<EOF
Usage:
  ./scripts/check-notary-status.sh <submission-id>

Checks the Apple notarization status for a submission ID using credentials
from apps/macos/.env.build.
EOF
}

if [[ $# -ne 1 ]]; then
  print_usage >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
ENV_FILE="$PROJECT_DIR/.env.build"
SUBMISSION_ID="$1"

if [[ -f "$ENV_FILE" ]]; then
  set -a
  source "$ENV_FILE"
  set +a
fi

for var in DEVELOPMENT_TEAM APPLE_ID APPLE_ID_PASSWORD; do
  if [[ -z "${!var:-}" ]]; then
    echo "Error: $var is not set." >&2
    exit 1
  fi
done

INFO_JSON="$(
  xcrun notarytool info "$SUBMISSION_ID" \
    --apple-id "$APPLE_ID" \
    --password "$APPLE_ID_PASSWORD" \
    --team-id "$DEVELOPMENT_TEAM" \
    -f json
)"

STATUS="$(
  JSON_PAYLOAD="$INFO_JSON" /usr/bin/python3 - <<'PY'
import json
import os

data = json.loads(os.environ["JSON_PAYLOAD"])
print(data.get("status", ""))
PY
)"

printf '%s\n' "$INFO_JSON"

case "$STATUS" in
  Accepted)
    echo ""
    echo "Submission is cleared."
    ;;
  "In Progress")
    echo ""
    echo "Submission is still processing."
    ;;
  Invalid)
    echo ""
    echo "Submission failed. Fetch the full log with:"
    echo "  xcrun notarytool log $SUBMISSION_ID --apple-id \"\$APPLE_ID\" --password \"\$APPLE_ID_PASSWORD\" --team-id \"\$DEVELOPMENT_TEAM\" notary-log.json"
    ;;
esac
