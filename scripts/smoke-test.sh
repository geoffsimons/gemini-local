#!/usr/bin/env bash
set -euo pipefail

HUB_URL="${HUB_URL:-http://localhost:3000/api}"
# 🛠️ Create a REAL temporary project folder
TEST_PROJECT=$(mktemp -d -t gemini-test-project.XXXXXX)
trap 'rm -rf "$TEST_PROJECT"' EXIT # Auto-cleanup on script end

# 📝 Inject a local memory file to verify the Hub reads it
echo "You are a test assistant. Your secret code is BLUE_MONKEY." > "$TEST_PROJECT/GEMINI.md"

bold() { printf "\033[1m%s\033[0m\n" "$*"; }
green() { printf "\033[32m%s\033[0m\n" "$*"; }
red()   { printf "\033[31m%s\033[0m\n" "$*"; }

bold "============================================"
bold "  Hub Integration Test (Sandbox Mode)"
bold "  Project: $TEST_PROJECT"
bold "============================================"

# 1. Health Check
bold "[1/4] Health Check"
curl -sf "$HUB_URL/health" > /dev/null || (red "Hub is not running at $HUB_URL"; exit 1)
green "  PASS: Hub is online"

# 2. Warm-up (Should now pass because folder exists)
bold "[2/4] Initializing Sandbox..."
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$HUB_URL/chat/start" \
     -H "Content-Type: application/json" \
     -d "{\"folderPath\": \"$TEST_PROJECT\"}")
if [ "$HTTP_CODE" -eq 200 ]; then green "  PASS: Sandbox warmed up"; else red "  FAIL: HTTP $HTTP_CODE"; exit 1; fi

# 3. Context & Memory Test
bold "[3/4] Verifying GEMINI.md Injection..."
RESPONSE=$(curl -s -X POST "$HUB_URL/chat/prompt" \
     -H "Content-Type: application/json" \
     -d "{\"folderPath\": \"$TEST_PROJECT\", \"message\": \"What is your secret code?\"}")
TEXT=$(echo "$RESPONSE" | jq -r '.response')
if [[ "$TEXT" == *"BLUE_MONKEY"* ]]; then
  green "  PASS: Hub correctly read GEMINI.md from the sandbox"
else
  red "  FAIL: Hub ignored local memory. Response: $TEXT"
  exit 1
fi

# 4. Negative Test (Nonexistent folder)
bold "[4/4] Validating Ghost Folder Rejection..."
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$HUB_URL/chat/start" \
     -H "Content-Type: application/json" \
     -d "{\"folderPath\": \"/tmp/should-not-exist-12345\"}")
if [ "$HTTP_CODE" -ge 400 ]; then
  green "  PASS: Hub correctly rejected ghost folder (HTTP $HTTP_CODE)"
else
  red "  FAIL: Hub accepted a nonexistent folder!"
  exit 1
fi

bold "============================================"
green "  ALL TESTS PASSED"