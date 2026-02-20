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

# 2. Warm-up (trust test project then start)
bold "[2/8] Initializing Sandbox..."
curl -s -X POST "$HUB_URL/registry/add" \
     -H "Content-Type: application/json" \
     -d "{\"folderPath\": \"$TEST_PROJECT\"}" > /dev/null
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$HUB_URL/chat/start" \
     -H "Content-Type: application/json" \
     -d "{\"folderPath\": \"$TEST_PROJECT\"}")
[ "$HTTP_CODE" -eq 200 ] && green "  PASS: Sandbox warmed up" || (red "  FAIL: HTTP $HTTP_CODE"; exit 1)

# 3. Context & Memory Test (retry up to 3x for transient API/stream issues)
bold "[3/8] Verifying GEMINI.md Injection..."
STEP3_PASSED=0
for attempt in 1 2 3; do
  RESPONSE=$(curl -s -w "\nHTTP_CODE:%{http_code}" --max-time 60 -X POST "$HUB_URL/chat/prompt" \
       -H "Content-Type: application/json" \
       -d "{\"folderPath\": \"$TEST_PROJECT\", \"message\": \"What is your secret code?\"}")
  HTTP_CODE=$(echo "$RESPONSE" | grep "HTTP_CODE:" | cut -d: -f2)
  BODY=$(echo "$RESPONSE" | sed '/HTTP_CODE:/d')
  TEXT=$(echo "$BODY" | jq -r '.response // empty')
  if [[ "$TEXT" == *"BLUE_MONKEY"* ]]; then
    STEP3_PASSED=1
    break
  fi
  [[ $attempt -lt 3 ]] && sleep 2
done
if [[ $STEP3_PASSED -eq 1 ]]; then
  green "  PASS: Hub correctly read GEMINI.md"
else
  DETAILS=$(echo "$BODY" | jq -r '.details // .error // empty')
  red "  FAIL: Hub ignored local memory (HTTP $HTTP_CODE). Response: $TEXT"
  [[ -n "$DETAILS" ]] && red "  Details: $DETAILS"
  exit 1
fi

# 4. Negative Test (Nonexistent folder)
bold "[4/8] Validating Ghost Folder Rejection..."
GHOST_PATH="/tmp/should-not-exist-$(date +%s)"
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$HUB_URL/chat/start" \
     -H "Content-Type: application/json" \
     -d "{\"folderPath\": \"$GHOST_PATH\"}")
[ "$HTTP_CODE" -ge 400 ] && green "  PASS: Rejected ghost folder" || (red "  FAIL: Accepted non-existent folder"; exit 1)

# 5. Session Clear
bold "[5/8] Session Clear..."
curl -s -X POST "$HUB_URL/chat/prompt" -H "Content-Type: application/json" \
     -d "{\"folderPath\": \"$TEST_PROJECT\", \"message\": \"My name is HubTest. Remember it.\"}" > /dev/null
curl -s -X POST "$HUB_URL/chat/clear" -H "Content-Type: application/json" \
     -d "{\"folderPath\": \"$TEST_PROJECT\"}" > /dev/null
RESPONSE=$(curl -s -X POST "$HUB_URL/chat/prompt" -H "Content-Type: application/json" \
     -d "{\"folderPath\": \"$TEST_PROJECT\", \"message\": \"What was the name I told you?\"}")
TEXT=$(echo "$RESPONSE" | jq -r '.response')
[[ "$TEXT" != *"HubTest"* ]] && green "  PASS: Memory wipe successful" || (red "  FAIL: AI still remembers HubTest"; exit 1)

# 6. Visual Context (Sharp)
bold "[6/8] Visual Context Validation..."
RED_BASE64=$(node -e "require('sharp')({create:{width:10,height:10,channels:4,background:{r:255,g:0,b:0,alpha:1}}}).png().toBuffer().then(b => console.log(b.toString('base64')))")
PAYLOAD=$(jq -n --arg fp "$TEST_PROJECT" --arg r "$RED_BASE64" \
  '{folderPath: $fp, message: "What color is this? Return only the hex.", images: [{data: $r, mimeType: "image/png"}]}')
RESPONSE=$(curl -s -X POST "$HUB_URL/chat/prompt" -H "Content-Type: application/json" -d "$PAYLOAD")
TEXT=$(echo "$RESPONSE" | jq -r '.response' | tr '[:upper:]' '[:lower:]')
[[ "$TEXT" == *"ff0000"* ]] && green "  PASS: Image identified correctly" || (red "  FAIL: Visual mismatch: $TEXT"; exit 1)

# 7. Governance Lifecycle
bold "[7/8] Governance & Trust Lifecycle"
GOVERNANCE_PROJECT=$(mktemp -d -t gemini-gov.XXXXXX)
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$HUB_URL/chat/start" \
     -H "Content-Type: application/json" -d "{\"folderPath\": \"$GOVERNANCE_PROJECT\"}")
[ "$HTTP_CODE" -ge 400 ] && green "  PASS: Untrusted folder blocked" || (red "  FAIL: Security bypass"; exit 1)

# 8. Model Orchestration
bold "[8/8] Model Orchestration & Discovery"
MODELS=$(curl -s "$HUB_URL/models")
FIRST=$(echo "$MODELS" | jq -r '.[0]')
if [[ "$FIRST" == *"3.1"* ]]; then green "  PASS: 3.1 Pro is active"; else bold "  Note: Using $FIRST"; fi

bold "============================================"
green "  ALL TESTS PASSED"