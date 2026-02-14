#!/usr/bin/env bash
set -euo pipefail

HUB_URL="${HUB_URL:-http://localhost:3000/api}"
# 🛠️ Create a REAL temporary project folder
TEST_PROJECT=$(mktemp -d -t gemini-test-project.XXXXXX)
GOVERNANCE_PROJECT="" # Populated in test 7; cleaned up by the trap
trap 'rm -rf "$TEST_PROJECT"; [ -n "$GOVERNANCE_PROJECT" ] && rm -rf "$GOVERNANCE_PROJECT"' EXIT

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
bold "[1/7] Health Check"
curl -sf "$HUB_URL/health" > /dev/null || (red "Hub is not running at $HUB_URL"; exit 1)
green "  PASS: Hub is online"

# 2. Warm-up (Should now pass because folder exists)
bold "[2/7] Initializing Sandbox..."
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$HUB_URL/chat/start" \
     -H "Content-Type: application/json" \
     -d "{\"folderPath\": \"$TEST_PROJECT\"}")
if [ "$HTTP_CODE" -eq 200 ]; then green "  PASS: Sandbox warmed up"; else red "  FAIL: HTTP $HTTP_CODE"; exit 1; fi

# 3. Context & Memory Test
bold "[3/7] Verifying GEMINI.md Injection..."
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
bold "[4/7] Validating Ghost Folder Rejection..."
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$HUB_URL/chat/start" \
     -H "Content-Type: application/json" \
     -d "{\"folderPath\": \"/tmp/should-not-exist-12345\"}")
if [ "$HTTP_CODE" -ge 400 ]; then
  green "  PASS: Hub correctly rejected ghost folder (HTTP $HTTP_CODE)"
else
  red "  FAIL: Hub accepted a nonexistent folder!"
  exit 1
fi

# 5. Session Clear (Memory Wipe)
bold "[5/7] Session Clear..."
# Plant a name into the conversation history
curl -s -X POST "$HUB_URL/chat/prompt" \
     -H "Content-Type: application/json" \
     -d "{\"folderPath\": \"$TEST_PROJECT\", \"message\": \"My name is HubTest. Remember it.\"}" > /dev/null

# Clear the session
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$HUB_URL/chat/clear" \
     -H "Content-Type: application/json" \
     -d "{\"folderPath\": \"$TEST_PROJECT\"}")
if [ "$HTTP_CODE" -ne 200 ]; then
  red "  FAIL: Clear endpoint returned HTTP $HTTP_CODE"
  exit 1
fi

# Ask if the AI still remembers the name
RESPONSE=$(curl -s -X POST "$HUB_URL/chat/prompt" \
     -H "Content-Type: application/json" \
     -d "{\"folderPath\": \"$TEST_PROJECT\", \"message\": \"What was the name I told you earlier?\"}")
TEXT=$(echo "$RESPONSE" | jq -r '.response')
if [[ "$TEXT" != *"HubTest"* ]]; then
  green "  PASS: Memory wipe successful — AI no longer remembers HubTest"
else
  red "  FAIL: AI still remembers HubTest after clear. Response: $TEXT"
  exit 1
fi

# 6. Visual Context Validation (pure-Node image generation + stitching)
bold "[6/7] Visual Context Validation..."

# Generate three 100x100 solid-color PNGs as base64 via sharp
RED_BASE64=$(node -e "require('sharp')({create:{width:100,height:100,channels:4,background:{r:255,g:0,b:0,alpha:1}}}).png().toBuffer().then(b => console.log(b.toString('base64')))")
GREEN_BASE64=$(node -e "require('sharp')({create:{width:100,height:100,channels:4,background:{r:0,g:255,b:0,alpha:1}}}).png().toBuffer().then(b => console.log(b.toString('base64')))")
BLUE_BASE64=$(node -e "require('sharp')({create:{width:100,height:100,channels:4,background:{r:0,g:0,b:255,alpha:1}}}).png().toBuffer().then(b => console.log(b.toString('base64')))")

PAYLOAD=$(cat <<ENDJSON
{
  "folderPath": "$TEST_PROJECT",
  "message": "Identify these three colors from left to right. Return ONLY a JSON list of hex codes.",
  "images": [
    { "data": "$RED_BASE64",   "mimeType": "image/png" },
    { "data": "$GREEN_BASE64", "mimeType": "image/png" },
    { "data": "$BLUE_BASE64",  "mimeType": "image/png" }
  ]
}
ENDJSON
)

RESPONSE=$(curl -s -X POST "$HUB_URL/chat/prompt" \
     -H "Content-Type: application/json" \
     -d "$PAYLOAD")
TEXT=$(echo "$RESPONSE" | jq -r '.response')

PASS=true
for HEX in "#FF0000" "#00FF00" "#0000FF"; do
  if [[ "$TEXT" != *"$HEX"* ]]; then
    # Also accept lowercase variants
    HEX_LOWER=$(echo "$HEX" | tr '[:upper:]' '[:lower:]')
    if [[ "$TEXT" != *"$HEX_LOWER"* ]]; then
      PASS=false
      red "  FAIL: Response missing expected color $HEX. Response: $TEXT"
      break
    fi
  fi
done

if $PASS; then
  green "  PASS: Model correctly identified all three colors from stitched composite"
else
  exit 1
fi

# 7. Governance & Trust Lifecycle
bold "[7/7] Governance & Trust Lifecycle"

# Initialization: isolated temp directory for this test case
GOVERNANCE_PROJECT=$(mktemp -d -t gemini-governance.XXXXXX)
echo "You are a governance test assistant." > "$GOVERNANCE_PROJECT/GEMINI.md"

# Step A: Discovery — folder must NOT be in the list yet
LIST_RESPONSE=$(curl -s "$HUB_URL/registry/list")
FOUND=$(echo "$LIST_RESPONSE" | jq --arg p "$GOVERNANCE_PROJECT" '[.folders[] | select(.path == $p)] | length')
if [ "$FOUND" -eq 0 ]; then
  green "  PASS (A): Folder absent from registry before add"
else
  red "  FAIL (A): Folder already in registry before add"
  exit 1
fi

# Step B: Add Trust
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$HUB_URL/registry/add" \
     -H "Content-Type: application/json" \
     -d "{\"folderPath\": \"$GOVERNANCE_PROJECT\"}")
if [ "$HTTP_CODE" -eq 200 ]; then
  green "  PASS (B): Folder added to trusted list"
else
  red "  FAIL (B): Add returned HTTP $HTTP_CODE"
  exit 1
fi

# Step C: Verify Trust — folder must be present with isReady: false
LIST_RESPONSE=$(curl -s "$HUB_URL/registry/list")
IS_READY=$(echo "$LIST_RESPONSE" | jq --arg p "$GOVERNANCE_PROJECT" '[.folders[] | select(.path == $p)][0].isReady')
if [ "$IS_READY" = "false" ]; then
  green "  PASS (C): Folder trusted but not yet activated (isReady: false)"
else
  red "  FAIL (C): Expected isReady=false, got $IS_READY"
  exit 1
fi

# Step D: Activation — warm up the session
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$HUB_URL/chat/start" \
     -H "Content-Type: application/json" \
     -d "{\"folderPath\": \"$GOVERNANCE_PROJECT\"}")
if [ "$HTTP_CODE" -eq 200 ]; then
  green "  PASS (D): Session activated via /chat/start"
else
  red "  FAIL (D): Start returned HTTP $HTTP_CODE"
  exit 1
fi

# Step E: Verify Activation — isReady must now be true
LIST_RESPONSE=$(curl -s "$HUB_URL/registry/list")
IS_READY=$(echo "$LIST_RESPONSE" | jq --arg p "$GOVERNANCE_PROJECT" '[.folders[] | select(.path == $p)][0].isReady')
if [ "$IS_READY" = "true" ]; then
  green "  PASS (E): Folder now active (isReady: true)"
else
  red "  FAIL (E): Expected isReady=true, got $IS_READY"
  exit 1
fi

# Step F: Unregister — remove from trust list and purge memory
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$HUB_URL/registry/unregister" \
     -H "Content-Type: application/json" \
     -d "{\"folderPath\": \"$GOVERNANCE_PROJECT\"}")
if [ "$HTTP_CODE" -eq 200 ]; then
  green "  PASS (F): Folder unregistered"
else
  red "  FAIL (F): Unregister returned HTTP $HTTP_CODE"
  exit 1
fi

# Step G: Final Audit — folder must be gone from list AND memory purged
LIST_RESPONSE=$(curl -s "$HUB_URL/registry/list")
FOUND=$(echo "$LIST_RESPONSE" | jq --arg p "$GOVERNANCE_PROJECT" '[.folders[] | select(.path == $p)] | length')
if [ "$FOUND" -ne 0 ]; then
  red "  FAIL (G): Folder still present in registry list after unregister"
  exit 1
fi

STATUS_RESPONSE=$(curl -s "$HUB_URL/chat/status?folderPath=$(python3 -c "import urllib.parse; print(urllib.parse.quote('$GOVERNANCE_PROJECT'))")")
READY=$(echo "$STATUS_RESPONSE" | jq -r '.ready')
if [ "$READY" = "false" ]; then
  green "  PASS (G): Folder removed from list and memory purged (ready: false)"
else
  red "  FAIL (G): Memory not purged — status returned ready=$READY"
  exit 1
fi

bold "============================================"
green "  ALL TESTS PASSED"