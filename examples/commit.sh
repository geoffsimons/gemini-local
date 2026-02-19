#!/usr/bin/env bash
# Compatible with Bash and Zsh.

# Gemini Local Hub - Example Commit Utility
# Usage: Copy this to your project root and run ./commit.sh

set -euo pipefail

HUB_URL="http://localhost:3000/api/chat/prompt"
PROJECT_PATH="$(pwd -P)"

# 1. Health Check
if ! curl -s -f "http://localhost:3000/api/health" > /dev/null; then
    echo "❌ Error: Gemini Local Hub is not running at localhost:3000."
    exit 1
fi

# 2. Check for staged changes
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
    PAYLOAD=$(jq -n \
      --arg fp "$PROJECT_PATH" \
      --arg msg "$prompt" \
      '{folderPath: $fp, message: $msg, ephemeral: true}')

    local response
    response=$(curl -s -X POST "$HUB_URL" \
        -H "Content-Type: application/json" \
        -d "$PAYLOAD")

    echo "$response" | jq -r '.response'
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