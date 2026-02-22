#!/usr/bin/env bash
# ===========================================================================
# connect.sh — Link the current project to the Gemini Local Hub
# ===========================================================================
#
# Usage:
#   Run this script from the root of any project you want to connect:
#
#     bash /path/to/connect.sh
#
#   Or copy it into your project and run:
#
#     chmod +x connect.sh && ./connect.sh
#
#   Optional: --pro to warm up a session with the Pro model (default is Flash).
#
# Requirements: curl, node
# ===========================================================================

set -euo pipefail

HUB_URL="${GEMINI_HUB_URL:-http://localhost:3000}"

# ---------------------------------------------------------------------------
# Preflight — make sure curl and node are available
# ---------------------------------------------------------------------------
for cmd in curl node; do
  if ! command -v "$cmd" &>/dev/null; then
    echo "❌ Required tool '$cmd' is not installed. Please install it and try again."
    exit 1
  fi
done

# ---------------------------------------------------------------------------
# Parse args — optional --pro to use Pro model for this session
# ---------------------------------------------------------------------------
USE_PRO=false
for arg in "$@"; do
  if [ "$arg" = "--pro" ]; then
    USE_PRO=true
    break
  fi
done

# ---------------------------------------------------------------------------
# 1. Discovery — resolve the current project's absolute path
# ---------------------------------------------------------------------------
PROJECT_PATH="$(pwd -P)"
echo "🔗 Connecting project: $PROJECT_PATH"

# ---------------------------------------------------------------------------
# 2. Health check — make sure the Hub is running
# ---------------------------------------------------------------------------
echo "🩺 Checking Hub at $HUB_URL ..."

HEALTH_RESPONSE="$(curl -sf "${HUB_URL}/api/health" 2>/dev/null)" || {
  echo "❌ Gemini Local Hub is not running at $HUB_URL"
  echo "   Start the Hub first, then re-run this script."
  exit 1
}

HEALTH_STATUS="$(echo "$HEALTH_RESPONSE" | node -e "const d=JSON.parse(require('fs').readFileSync(0,'utf8')); console.log(d.status||'')")"
if [ "$HEALTH_STATUS" != "ok" ]; then
  echo "❌ Hub returned unexpected health status: $HEALTH_STATUS"
  exit 1
fi

echo "✅ Hub is healthy"

# ---------------------------------------------------------------------------
# 3. Registration — warm up a session for this project
# ---------------------------------------------------------------------------
echo "📡 Registering project with the Hub ..."

START_PAYLOAD="$(node -e "
const fp = process.argv[1];
const usePro = process.argv[2] === 'true';
const o = { folderPath: fp };
if (usePro) o.model = 'gemini-3-pro-preview';
console.log(JSON.stringify(o));
" "$PROJECT_PATH" "$USE_PRO")"

START_RESPONSE="$(curl -sf -X POST "${HUB_URL}/api/chat/start" \
  -H "Content-Type: application/json" \
  -d "$START_PAYLOAD" 2>/dev/null)" || {
  echo "❌ Failed to register project. Is the path valid?"
  exit 1
}

# ---------------------------------------------------------------------------
# 4. Validation — confirm the Hub accepted the project
# ---------------------------------------------------------------------------
START_STATUS="$(echo "$START_RESPONSE" | node -e "const d=JSON.parse(require('fs').readFileSync(0,'utf8')); console.log(d.status||'')")"
RESOLVED_PATH="$(echo "$START_RESPONSE" | node -e "const d=JSON.parse(require('fs').readFileSync(0,'utf8')); console.log(d.folderPath||'')")"

if [ "$START_STATUS" != "ready" ]; then
  ERROR_MSG="$(echo "$START_RESPONSE" | node -e "const d=JSON.parse(require('fs').readFileSync(0,'utf8')); console.log(d.error||'unknown error')")"
  echo "❌ Hub did not accept the project: $ERROR_MSG"
  exit 1
fi

echo "✅ Linked! Hub is ready for: $RESOLVED_PATH"
