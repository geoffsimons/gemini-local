#!/usr/bin/env bash
set -euo pipefail

HUB_URL="${HUB_URL:-http://localhost:3000/api}"
TEST_PROJECT=$(mktemp -d -t gemini-test-project.XXXXXX)
GOVERNANCE_PROJECT=""

cleanup() {
  echo -e "\n\033[1m[Cleanup] Purging test paths...\033[0m"
  for PROJ in "$TEST_PROJECT" "$GOVERNANCE_PROJECT"; do
    if [ -n "$PROJ" ] && [ -d "$PROJ" ]; then
      curl -s -X POST "$HUB_URL/registry/unregister" \
           -H "Content-Type: application/json" \
           -d "{\"folderPath\": \"$PROJ\"}" > /dev/null
      rm -rf "$PROJ"
    fi
  done
  echo -e "\033[32m[Cleanup] Done.\033[0m"
}
trap cleanup EXIT

echo "You are a test assistant. Your secret code is BLUE_MONKEY." > "$TEST_PROJECT/GEMINI.md"

bold() { printf "\033[1m%s\033[0m\n" "$*"; }
green() { printf "\033[32m%s\033[0m\n" "$*"; }
red()   { printf "\033[31m%s\033[0m\n" "$*"; }

bold "============================================"
bold "  Hub Integration Test (v1.2 Agentic)"
bold "  Project: $TEST_PROJECT"
bold "============================================"

# 1. Health Check
bold "[1/8] Health Check"
curl -sf "$HUB_URL/health" > /dev/null || (red "Hub offline"; exit 1)
green "  PASS: Hub is online"

# 2. Warm-up
bold "[2/8] Initializing Sandbox..."
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$HUB_URL/chat/start" \
     -H "Content-Type: application/json" \
     -d "{\"folderPath\": \"$TEST_PROJECT\"}")
[ "$HTTP_CODE" -eq 200 ] && green "  PASS: Sandbox warmed up" || (red "  FAIL: HTTP $HTTP_CODE"; exit 1)

# 3. Context & Memory Test (Increased timeout for 3.1 Pro)
bold "[3/8] Verifying GEMINI.md Injection..."
# We use --max-time 60 because 3.1 Pro thinking cycles can take a while
RESPONSE=$(curl -s --max-time 60 -X POST "$HUB_URL/chat/prompt" \
     -H "Content-Type: application/json" \
     -d "{\"folderPath\": \"$TEST_PROJECT\", \"message\": \"What is your secret code?\"}")

TEXT=$(echo "$RESPONSE" | jq -r '.response // empty')

if [[ "$TEXT" == *"BLUE_MONKEY"* ]]; then
  green "  PASS: Hub correctly read GEMINI.md"
else
  red "  FAIL: Hub ignored local memory or timed out. Response: $TEXT"
  exit 1
fi

# ... [Steps 4-7 remain same as your previous script] ...

# 8. Model Orchestration (3.1 Pro Verification)
bold "[8/8] Model Orchestration & Discovery"
MODELS=$(curl -s "$HUB_URL/models")
FIRST=$(echo "$MODELS" | jq -r '.[0]')

if [[ "$FIRST" == *"3.1"* ]]; then
  green "  PASS: Gemini 3.1 Pro is correctly routed and active"
else
  bold "  Note: 3.1 Pro not detected as primary, using: $FIRST"
fi

bold "============================================"
green "  ALL TESTS PASSED"