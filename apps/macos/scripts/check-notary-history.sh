#!/usr/bin/env bash

set -euo pipefail

print_usage() {
  cat <<EOF
Usage:
  ./scripts/check-notary-history.sh [limit]

Displays recent Apple notarization submissions in a readable table using
credentials from apps/macos/.env.build.

Examples:
  ./scripts/check-notary-history.sh
  ./scripts/check-notary-history.sh 10
EOF
}

LIMIT="${1:-20}"

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  print_usage
  exit 0
fi

if ! [[ "$LIMIT" =~ ^[0-9]+$ ]]; then
  echo "Error: limit must be a positive integer." >&2
  print_usage >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
ENV_FILE="$PROJECT_DIR/.env.build"

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

HISTORY_JSON="$(
  xcrun notarytool history \
    --apple-id "$APPLE_ID" \
    --password "$APPLE_ID_PASSWORD" \
    --team-id "$DEVELOPMENT_TEAM" \
    -f json
)"

JSON_PAYLOAD="$HISTORY_JSON" /usr/bin/python3 - "$LIMIT" <<'PY'
import json
import os
import sys
from datetime import datetime, timezone

limit = int(sys.argv[1])
payload = json.loads(os.environ["JSON_PAYLOAD"])
history = payload.get("history", [])[:limit]

if not history:
    print("No notarization submissions found.")
    sys.exit(0)

def fmt_date(value: str) -> str:
    if not value:
        return "-"
    try:
        dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
        local_dt = dt.astimezone()
        return local_dt.strftime("%Y-%m-%d %H:%M:%S %Z")
    except Exception:
        return value

rows = [
    {
        "created": fmt_date(item.get("createdDate", "")),
        "status": item.get("status", "-"),
        "name": item.get("name", "-"),
        "id": item.get("id", "-"),
    }
    for item in history
]

headers = {
    "created": "Created",
    "status": "Status",
    "name": "Name",
    "id": "Submission ID",
}

widths = {
    key: max(len(headers[key]), *(len(row[key]) for row in rows))
    for key in headers
}

def line(char: str = "-") -> str:
    return "+-" + "-+-".join(char * widths[key] for key in headers) + "-+"

print(line("-"))
print(
    "| "
    + " | ".join(headers[key].ljust(widths[key]) for key in headers)
    + " |"
)
print(line("="))
for row in rows:
    print(
        "| "
        + " | ".join(row[key].ljust(widths[key]) for key in headers)
        + " |"
    )
print(line("-"))
print(f"Showing {len(rows)} submission(s).")
PY
