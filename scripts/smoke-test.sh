#!/usr/bin/env bash
set -euo pipefail

HUB_PORT=${GEMINI_HUB_PORT:-2999}
HUB_URL="${HUB_URL:-http://localhost:${HUB_PORT}/api}"
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

bold() { printf "\033[1m%s\033[0m\n" "$*"; }
green() { printf "\033[32m%s\033[0m\n" "$*"; }
red()   { printf "\033[31m%s\033[0m\n" "$*"; }

bold "============================================"
bold "  Hub Integration Test (v1.2 Agentic)"
bold "  Project: $TEST_PROJECT"
bold "============================================"

# 1. Health Check
bold "[1/10] Health Check"
curl -sf "$HUB_URL/health" > /dev/null || (red "Hub offline"; exit 1)
green "  PASS: Hub is online"

# 2. Warm-up (trust test project then start)
bold "[2/10] Initializing Sandbox..."
curl -s -X POST "$HUB_URL/registry/add" \
     -H "Content-Type: application/json" \
     -d "{\"folderPath\": \"$TEST_PROJECT\"}" > /dev/null
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$HUB_URL/chat/start" \
     -H "Content-Type: application/json" \
     -d "{\"folderPath\": \"$TEST_PROJECT\"}")
[ "$HTTP_CODE" -eq 200 ] && green "  PASS: Sandbox warmed up" || (red "  FAIL: HTTP $HTTP_CODE"; exit 1)

# 3. YOLO mode
bold "[3/10] Enabling YOLO Mode..."
YOLO_BODY=$(node -e "console.log(JSON.stringify({ folderPath: process.argv[1], yoloMode: true }))" "$TEST_PROJECT")
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" -X PATCH "$HUB_URL/chat/config" \
     -H "Content-Type: application/json" \
     -d "$YOLO_BODY")
[ "$HTTP_CODE" -eq 200 ] && green "  PASS: YOLO mode enabled" || (red "  FAIL: HTTP $HTTP_CODE"; exit 1)

# 4. Negative Test (Nonexistent folder)
bold "[4/10] Validating Ghost Folder Rejection..."
GHOST_PATH="/tmp/should-not-exist-$(date +%s)"
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$HUB_URL/chat/start" \
     -H "Content-Type: application/json" \
     -d "{\"folderPath\": \"$GHOST_PATH\"}")
[ "$HTTP_CODE" -ge 400 ] && green "  PASS: Rejected ghost folder" || (red "  FAIL: Accepted non-existent folder"; exit 1)

# 5. Session Clear
bold "[5/10] Session Clear..."
curl -s -X POST "$HUB_URL/chat/prompt" -H "Content-Type: application/json" \
     -d "{\"folderPath\": \"$TEST_PROJECT\", \"message\": \"My name is HubTest. Remember it.\"}" > /dev/null
curl -s -X POST "$HUB_URL/chat/clear" -H "Content-Type: application/json" \
     -d "{\"folderPath\": \"$TEST_PROJECT\"}" > /dev/null
RESPONSE=$(curl -s -X POST "$HUB_URL/chat/prompt" -H "Content-Type: application/json" \
     -d "{\"folderPath\": \"$TEST_PROJECT\", \"message\": \"What was the name I told you?\"}")
TEXT=$(echo "$RESPONSE" | jq -r '.response')
[[ "$TEXT" != *"HubTest"* ]] && green "  PASS: Memory wipe successful" || (red "  FAIL: AI still remembers HubTest"; exit 1)

# 6. Visual Context (Sharp)
bold "[6/10] Visual Context Validation..."
RED_BASE64=$(node -e "require('sharp')({create:{width:10,height:10,channels:4,background:{r:255,g:0,b:0,alpha:1}}}).png().toBuffer().then(b => console.log(b.toString('base64')))")
PAYLOAD=$(jq -n --arg fp "$TEST_PROJECT" --arg r "$RED_BASE64" '{folderPath: $fp, message: "What color is this? Return only the hex.", images: [{data: $r, mimeType: "image/png"}]}')
RESPONSE=$(curl -s -X POST "$HUB_URL/chat/prompt" -H "Content-Type: application/json" -d "$PAYLOAD")
TEXT=$(echo "$RESPONSE" | jq -r '.response' | tr '[:upper:]' '[:lower:]')
[[ "$TEXT" == *"ff0000"* ]] && green "  PASS: Image identified correctly" || (red "  FAIL: Visual mismatch: $TEXT"; exit 1)

# 7. Governance Lifecycle
bold "[7/10] Governance & Trust Lifecycle"
GOVERNANCE_PROJECT=$(mktemp -d -t gemini-gov.XXXXXX)
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$HUB_URL/chat/start" \
     -H "Content-Type: application/json" -d "{\"folderPath\": \"$GOVERNANCE_PROJECT\"}")
[ "$HTTP_CODE" -ge 400 ] && green "  PASS: Untrusted folder blocked" || (red "  FAIL: Security bypass"; exit 1)

# 8. Model Orchestration
bold "[8/10] Model Orchestration & Discovery"
MODELS=$(curl -s "$HUB_URL/models")
FIRST=$(echo "$MODELS" | jq -r '.[0]')
if [[ "$FIRST" == *"3.1"* ]]; then green "  PASS: 3.1 Pro is active"; else bold "  Note: Using $FIRST"; fi

# 9. Agentic Stream Validation
bold "[9/10] Agentic Stream Validation"
if npx tsx scripts/test-stream.ts "$TEST_PROJECT"; then
  green "  PASS: Streaming verified"
else
  red "  FAIL"
  exit 1
fi

# 10. Agentic Tool Execution (Human-in-the-Loop)
bold "[10/10] Agentic Tool Execution"
if npx tsx scripts/test-tools.ts "$TEST_PROJECT"; then
  green "  PASS: Tool execution verified"
else
  red "  FAIL"
  exit 1
fi

bold "============================================"
green "  ALL TESTS PASSED"
