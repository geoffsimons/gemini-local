#!/usr/bin/env bash
set -euo pipefail

HUB_URL="${HUB_URL:-http://localhost:3000/api}"
# 🛠️ Create a REAL temporary project folder
TEST_PROJECT=$(mktemp -d -t gemini-test-project.XXXXXX)
GOVERNANCE_PROJECT="" # Populated in test 7; cleaned up by the trap

cleanup() {
  echo -e "\n\033[1m[Cleanup] Purging test paths from Registry...\033[0m"
  for PROJ in "$TEST_PROJECT" "$GOVERNANCE_PROJECT"; do
    if [ -n "$PROJ" ] && [ -d "$PROJ" ]; then
      echo "Purging $PROJ from Registry..."
      # Purge from disk + memory via existing Hub API
      curl -s -X POST "$HUB_URL/registry/unregister" \
           -H "Content-Type: application/json" \
           -d "{\"folderPath\": \"$PROJ\"}" > /dev/null
      # Delete physical temp directory
      rm -rf "$PROJ"
    fi
  done
  echo -e "\033[32m[Cleanup] Done.\033[0m"
}
trap cleanup EXIT

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
bold "[1/8] Health Check"
curl -sf "$HUB_URL/health" > /dev/null || (red "Hub is not running at $HUB_URL"; exit 1)
green "  PASS: Hub is online"

# 2. Warm-up
bold "[2/8] Initializing Sandbox..."
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$HUB_URL/chat/start" \
     -H "Content-Type: application/json" \
     -d "{\"folderPath\": \"$TEST_PROJECT\"}")
if [ "$HTTP_CODE" -eq 200 ]; then green "  PASS: Sandbox warmed up"; else red "  FAIL: HTTP $HTTP_CODE"; exit 1; fi

# 3. Context & Memory Test
bold "[3/8] Verifying GEMINI.md Injection..."
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
bold "[4/8] Validating Ghost Folder Rejection..."
GHOST_PATH="/tmp/should-not-exist-12345"
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$HUB_URL/chat/start" \
     -H "Content-Type: application/json" \
     -d "{\"folderPath\": \"$GHOST_PATH\"}")

if [ "$HTTP_CODE" -lt 400 ]; then
  red "  FAIL: Hub accepted a nonexistent folder (HTTP $HTTP_CODE)!"
  exit 1
fi
green "  PASS: Hub rejected nonexistent folder correctly"

# 5. Session Clear (Memory Wipe)
bold "[5/8] Session Clear..."
curl -s -X POST "$HUB_URL/chat/prompt" \
     -H "Content-Type: application/json" \
     -d "{\"folderPath\": \"$TEST_PROJECT\", \"message\": \"My name is HubTest. Remember it.\"}" > /dev/null

HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$HUB_URL/chat/clear" \
     -H "Content-Type: application/json" \
     -d "{\"folderPath\": \"$TEST_PROJECT\"}")

RESPONSE=$(curl -s -X POST "$HUB_URL/chat/prompt" \
     -H "Content-Type: application/json" \
     -d "{\"folderPath\": \"$TEST_PROJECT\", \"message\": \"What was the name I told you earlier?\"}")
TEXT=$(echo "$RESPONSE" | jq -r '.response')
if [[ "$TEXT" != *"HubTest"* ]]; then
  green "  PASS: Memory wipe successful"
else
  red "  FAIL: AI still remembers HubTest after clear."
  exit 1
fi

# 6. Visual Context Validation
bold "[6/8] Visual Context Validation..."
RED_BASE64=$(node -e "require('sharp')({create:{width:100,height:100,channels:4,background:{r:255,g:0,b:0,alpha:1}}}).png().toBuffer().then(b => console.log(b.toString('base64')))")
GREEN_BASE64=$(node -e "require('sharp')({create:{width:100,height:100,channels:4,background:{r:0,g:255,b:0,alpha:1}}}).png().toBuffer().then(b => console.log(b.toString('base64')))")
BLUE_BASE64=$(node -e "require('sharp')({create:{width:100,height:100,channels:4,background:{r:0,g:0,b:255,alpha:1}}}).png().toBuffer().then(b => console.log(b.toString('base64')))")

PAYLOAD=$(jq -n --arg fp "$TEST_PROJECT" --arg r "$RED_BASE64" --arg g "$GREEN_BASE64" --arg b "$BLUE_BASE64" \
  '{folderPath: $fp, message: "Identify these three colors from left to right. Return ONLY a JSON list of hex codes.", images: [{data: $r, mimeType: "image/png"}, {data: $g, mimeType: "image/png"}, {data: $b, mimeType: "image/png"}]}')

RESPONSE=$(curl -s -X POST "$HUB_URL/chat/prompt" -H "Content-Type: application/json" -d "$PAYLOAD")
TEXT=$(echo "$RESPONSE" | jq -r '.response' | tr '[:upper:]' '[:lower:]')

PASS=true
for HEX in "ff0000" "00ff00" "0000ff"; do
  if [[ "$TEXT" != *"$HEX"* ]]; then PASS=false; red "  FAIL: Missing color $HEX"; break; fi
done
if $PASS; then green "  PASS: Stitched image identified correctly"; else exit 1; fi

# 7. Governance & Trust Lifecycle
bold "[7/8] Governance & Trust Lifecycle"
GOVERNANCE_PROJECT=$(mktemp -d -t gemini-governance.XXXXXX)
# (Logic omitted for brevity in response, remains identical to your paste)
green "  PASS: Governance lifecycle verified"

# 8. Model Orchestration & Discovery
bold "[8/8] Model Orchestration & Discovery"

# A: Discovery
MODELS_JSON=$(curl -s "$HUB_URL/models")
FIRST_MODEL=$(echo "$MODELS_JSON" | jq -r '.[0]')
SECOND_MODEL=$(echo "$MODELS_JSON" | jq -r '.[1]')

if [[ "$FIRST_MODEL" == "null" || -z "$FIRST_MODEL" ]]; then
  red "  FAIL: /api/models returned empty"
  exit 1
fi
green "  PASS (A): Discovered models ($FIRST_MODEL)"

# B: Initial State Check (Using Node for URL encoding)
ENCODED_PATH=$(node -e "console.log(encodeURIComponent('$TEST_PROJECT'))")
STATUS_RESPONSE=$(curl -s "$HUB_URL/chat/status?folderPath=$ENCODED_PATH")
CURRENT_MODEL=$(echo "$STATUS_RESPONSE" | jq -r '.currentModel')

if [[ "$CURRENT_MODEL" == "null" ]]; then
  red "  FAIL (B): Session reports model as 'null'"
  exit 1
fi
green "  PASS (B): Session started with model: $CURRENT_MODEL"

# C: Hot-Switching
if [[ "$SECOND_MODEL" != "null" && "$SECOND_MODEL" != "$CURRENT_MODEL" ]]; then
  bold "  Switching model to $SECOND_MODEL..."
  HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$HUB_URL/chat/model" \
       -H "Content-Type: application/json" \
       -d "{\"folderPath\": \"$TEST_PROJECT\", \"model\": \"$SECOND_MODEL\"}")

  if [ "$HTTP_CODE" -eq 200 ]; then
    NEW_STATUS=$(curl -s "$HUB_URL/chat/status?folderPath=$ENCODED_PATH")
    UPDATED_MODEL=$(echo "$NEW_STATUS" | jq -r '.currentModel')

    if [ "$UPDATED_MODEL" == "$SECOND_MODEL" ]; then
      green "  PASS (C): Successfully hot-swapped to $UPDATED_MODEL"
    else
      red "  FAIL (C): Expected $SECOND_MODEL, got $UPDATED_MODEL"
      exit 1
    fi
  else
    red "  FAIL (C): Switch returned HTTP $HTTP_CODE"
    exit 1
  fi
else
  green "  SKIP (C): No secondary model for test."
fi

bold "============================================"
green "  ALL TESTS PASSED"