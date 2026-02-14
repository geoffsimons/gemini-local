#!/usr/bin/env zsh

# Gemini Local Hub - Example Commit Utility
# Usage: Copy this to your project root and run ./commit.sh

HUB_URL="http://localhost:3000/api/chat/prompt"
PROJECT_PATH=$(pwd -P)

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
    local diff_content=$(git diff --cached)
    local hint_content=$1
    local prompt="Generate a professional git commit message in Conventional Commits style.
Focus on the architectural intent and functional requirements. [cite: 2026-02-08]

Title: <type>(<scope>): <subject> (lowercase, no period)
Body: Concise bulleted list of 'why' and 'how'.

Diff:
$diff_content"

    if [[ -n "$hint_content" ]]; then
        prompt="$prompt\n\nUser Hint: $hint_content"
    fi

    # API Request to Hub
    local response=$(curl -s -X POST "$HUB_URL" \
        -H "Content-Type: application/json" \
        -d "{\"folderPath\": \"$PROJECT_PATH\", \"message\": \"$prompt\"}")

    echo "$response" | jq -r '.response'
}

HINT=""
while true; do
    echo "🤖 Generating commit message via Gemini Hub..."
    PROPOSED_MESSAGE=$(generate_commit_message "$HINT")

    if [[ -z "$PROPOSED_MESSAGE" || "$PROPOSED_MESSAGE" == "null" ]]; then
        echo "❌ Error: Failed to get a response from the Hub."
        exit 1
    fi

    echo "\n--- PROPOSED COMMIT MESSAGE ---"
    echo "$PROPOSED_MESSAGE"
    echo "-------------------------------\n"

    echo -n "(A)ccept, (E)dit manually, (R)etry with hint, or (C)ancel? "
    read -k 1 REPLY
    echo ""

    case $REPLY in
        [Aa])
            git commit -m "$PROPOSED_MESSAGE"
            exit $? ;;
        [Ee])
            TMPFILE=$(mktemp /tmp/commit_msg.XXXXXX)
            echo "$PROPOSED_MESSAGE" > "$TMPFILE"
            ${EDITOR:-vim} "$TMPFILE"
            FINAL_MESSAGE=$(cat "$TMPFILE")
            rm "$TMPFILE"
            [ -n "$FINAL_MESSAGE" ] && git commit -m "$FINAL_MESSAGE" || echo "Cancelled."
            exit 0 ;;
        [Rr])
            echo -n "Enter hint for retry: "
            read HINT
            continue ;;
        [Cc])
            echo "Commit cancelled."
            exit 0 ;;
        *)
            echo "Invalid option." ;;
    esac
done