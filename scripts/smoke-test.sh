#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Smoke Test — quick curl-based validation of the Hub API.
#
# Usage:
#   ./scripts/smoke-test.sh                     # defaults
#   HUB_URL=http://localhost:4000 ./scripts/smoke-test.sh
#   FOLDER_PATH=/some/project ./scripts/smoke-test.sh
#
# Requires: curl, jq
# ---------------------------------------------------------------------------

set -euo pipefail

HUB_URL="${HUB_URL:-http://localhost:3000}"
FOLDER_PATH="${FOLDER_PATH:-$(cd "$(dirname "$0")/.." && pwd)}"

pass=0
fail=0

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
green()  { printf "\033[32m%s\033[0m\n" "$*"; }
red()    { printf "\033[31m%s\033[0m\n" "$*"; }
bold()   { printf "\033[1m%s\033[0m\n" "$*"; }

assert_eq() {
  local label="$1" actual="$2" expected="$3"
  if [ "$actual" = "$expected" ]; then
    green "  PASS  $label  (got: $actual)"
    ((pass++)) || true
  else
    red   "  FAIL  $label  (expected: $expected, got: $actual)"
    ((fail++)) || true
  fi
}

assert_contains() {
  local label="$1" haystack="$2" needle="$3"
  if echo "$haystack" | grep -qi "$needle"; then
    green "  PASS  $label  (response contains \"$needle\")"
    ((pass++)) || true
  else
    red   "  FAIL  $label  (expected \"$needle\" in response)"
    ((fail++)) || true
  fi
}

assert_http() {
  local label="$1" actual="$2" expected="$3"
  if [ "$actual" -eq "$expected" ] 2>/dev/null; then
    green "  PASS  $label  (HTTP $actual)"
    ((pass++)) || true
  else
    red   "  FAIL  $label  (expected HTTP $expected, got HTTP $actual)"
    ((fail++)) || true
  fi
}

# ---------------------------------------------------------------------------
bold "============================================"
bold "  Hub Smoke Test"
bold "  Server : $HUB_URL"
bold "  Folder : $FOLDER_PATH"
bold "============================================"
echo ""

# ------------------------------------------------------------------
# 1. Health check
# ------------------------------------------------------------------
bold "[1/5] Health Check"
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "$HUB_URL/api/health")
assert_http "GET /api/health returns 200" "$HTTP_CODE" 200

BODY=$(curl -s "$HUB_URL/api/health")
STATUS=$(echo "$BODY" | jq -r '.status')
assert_eq "health.status" "$STATUS" "ok"
echo ""

# ------------------------------------------------------------------
# 2. Cold status check
# ------------------------------------------------------------------
bold "[2/5] Cold Status Check"
ENCODED_PATH=$(python3 -c "import urllib.parse; print(urllib.parse.quote('$FOLDER_PATH'))")
BODY=$(curl -s "$HUB_URL/api/chat/status?folderPath=$ENCODED_PATH")
READY=$(echo "$BODY" | jq -r '.ready')
assert_eq "cold status ready" "$READY" "false"
echo ""

# ------------------------------------------------------------------
# 3. Explicit start (warm-up)
# ------------------------------------------------------------------
bold "[3/5] Session Start"
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" \
  -X POST "$HUB_URL/api/chat/start" \
  -H "Content-Type: application/json" \
  -d "{\"folderPath\": \"$FOLDER_PATH\"}")
assert_http "POST /api/chat/start returns 200" "$HTTP_CODE" 200

BODY=$(curl -s -X POST "$HUB_URL/api/chat/start" \
  -H "Content-Type: application/json" \
  -d "{\"folderPath\": \"$FOLDER_PATH\"}")
START_STATUS=$(echo "$BODY" | jq -r '.status')
assert_eq "start.status" "$START_STATUS" "ready"
echo ""

# ------------------------------------------------------------------
# 4. Sequential prompts (context persistence)
# ------------------------------------------------------------------
bold "[4/5] Sequential Prompts"

# Prompt A — introduce a name
BODY_A=$(curl -s -X POST "$HUB_URL/api/chat/prompt" \
  -H "Content-Type: application/json" \
  -d "{\"folderPath\": \"$FOLDER_PATH\", \"message\": \"Hi, my name is HubTest. Please remember it.\"}")
RESP_A=$(echo "$BODY_A" | jq -r '.response // empty')
if [ -n "$RESP_A" ]; then
  green "  PASS  Prompt A returned a response (${#RESP_A} chars)"
  ((pass++)) || true
else
  red   "  FAIL  Prompt A returned empty response"
  ((fail++)) || true
fi

# Prompt B — ask for name back
BODY_B=$(curl -s -X POST "$HUB_URL/api/chat/prompt" \
  -H "Content-Type: application/json" \
  -d "{\"folderPath\": \"$FOLDER_PATH\", \"message\": \"What is my name? Reply with just the name, nothing else.\"}")
RESP_B=$(echo "$BODY_B" | jq -r '.response // empty')
assert_contains "Prompt B remembers name" "$RESP_B" "HubTest"
echo ""

# ------------------------------------------------------------------
# 5. Invalid folder
# ------------------------------------------------------------------
bold "[5/5] Invalid Folder Path"
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" \
  -X POST "$HUB_URL/api/chat/start" \
  -H "Content-Type: application/json" \
  -d '{"folderPath": "/nonexistent/untrusted/path/xyz"}')

if [ "$HTTP_CODE" -ge 400 ] && [ "$HTTP_CODE" -lt 600 ]; then
  green "  PASS  Invalid folder returns error (HTTP $HTTP_CODE)"
  ((pass++)) || true
else
  red   "  FAIL  Expected 4xx/5xx for invalid folder, got HTTP $HTTP_CODE"
  ((fail++)) || true
fi
echo ""

# ------------------------------------------------------------------
# Summary
# ------------------------------------------------------------------
bold "============================================"
TOTAL=$((pass + fail))
if [ "$fail" -eq 0 ]; then
  green "  All $TOTAL assertions passed."
else
  red   "  $fail of $TOTAL assertions failed."
fi
bold "============================================"

exit "$fail"
