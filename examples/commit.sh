#!/usr/bin/env bash
# Gemini Local Hub - Example Commit Utility
# Usage: Copy this to your project root and run ./commit.sh
# Requirements: curl, node

set -euo pipefail

HUB_URL="http://localhost:3000/api/chat/prompt"
PROJECT_PATH="$(pwd -P)"

# 1. Preflight — curl and node required
for cmd in curl node; do
  if ! command -v "$cmd" &>/dev/null; then
    echo "❌ Required tool '$cmd' is not installed. Please install it and try again."
    exit 1
  fi
done

# 2. Health Check
if ! curl -s -f "http://localhost:3000/api/health" > /dev/null; then
    echo "❌ Error: Gemini Local Hub is not running at localhost:3000."
    exit 1
fi

# 3. Check for staged changes
if git diff --cached --quiet; then
    echo "⚠️ Error: No changes staged for commit."
    exit 1
fi

generate_commit_message() {
    local diff_content
    diff_content="$(git diff --cached)"
    local hint_content="$1"

    # STRICT PROMPT: No markdown, no conversational filler.
    local prompt="Task: Generate a professional git commit message in Conventional Commits style.
STRICT RULE: Output ONLY the plain text of the commit message. Do NOT use markdown code blocks (\`\`\`). Do NOT include any conversational text.

Structure:
<type>(<scope>): <subject> (lowercase, no period)
<blank line>
Concise bulleted list explaining the 'why' and 'how'.

Diff:
$diff_content"

    if [[ -n "$hint_content" ]]; then
        prompt="${prompt}

User Hint: ${hint_content}"
    fi

    # API Request to Hub with EPHEMERAL flag to prevent context pollution
    local PAYLOAD
    PAYLOAD=$(echo "$prompt" | node -e "
      const fs = require('fs');
      const fp = process.argv[1];
      const msg = fs.readFileSync(0, 'utf8');
      console.log(JSON.stringify({ folderPath: fp, message: msg, ephemeral: true }));
    " "$PROJECT_PATH")

    local response
    local raw
    local attempts=0
    local max_attempts=2
    while [ "$attempts" -lt "$max_attempts" ]; do
      raw=$(curl -s -X POST "$HUB_URL" \
          -H "Content-Type: application/json" \
          -d "$PAYLOAD")
      response=$(echo "$raw" | node -e "const d=JSON.parse(require('fs').readFileSync(0,'utf8')); console.log(d.response!=null?d.response:'')")
      if [[ -n "$response" && "$response" != "null" ]]; then
        echo "$response"
        return 0
      fi
      attempts=$((attempts + 1))
      if [ "$attempts" -lt "$max_attempts" ]; then
        sleep 1
      fi
    done
    echo "$response"
}

HINT=""
while true; do
    echo "🤖 Generating commit message via Gemini Hub (Isolated Context)..."
    PROPOSED_MESSAGE="$(generate_commit_message "$HINT")"

    if [[ -z "$PROPOSED_MESSAGE" || "$PROPOSED_MESSAGE" == "null" ]]; then
        echo "❌ Error: Failed to get a response from the Hub."
        exit 1
    fi

    echo ""
    echo "--- PROPOSED COMMIT MESSAGE ---"
    echo "$PROPOSED_MESSAGE"
    echo "-------------------------------"
    echo ""

    echo -n "(A)ccept, (E)dit manually, (R)etry with hint, or (C)ancel? "
    read -n 1 -r REPLY
    echo ""

    case "$REPLY" in
        [Aa])
            git commit -m "$PROPOSED_MESSAGE"
            exit $? ;;
        [Ee])
            TMPFILE="$(mktemp /tmp/commit_msg.XXXXXX)"
            echo "$PROPOSED_MESSAGE" > "$TMPFILE"
            "${EDITOR:-vim}" "$TMPFILE"
            FINAL_MESSAGE="$(cat "$TMPFILE")"
            rm "$TMPFILE"
            if [[ -n "$FINAL_MESSAGE" ]]; then
                git commit -m "$FINAL_MESSAGE"
            else
                echo "Cancelled."
            fi
            exit 0 ;;
        [Rr])
            echo -n "Enter hint for retry: "
            read -r HINT
            continue ;;
        [Cc])
            echo "Commit cancelled."
            exit 0 ;;
        *)
            echo "Invalid option." ;;
    esac
done