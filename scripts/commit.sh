#!/usr/bin/env zsh

# Check if gemini CLI is installed
if ! command -v gemini &> /dev/null; then
    echo "Error: gemini CLI not found in PATH."
    exit 1
fi

# Check for staged changes
if git diff --cached --quiet; then
    echo "Error: No changes staged for commit."
    exit 1
fi

generate_commit_message() {
    local diff_content=$(git diff --cached)
    local hint_content=$1
    local prompt="Generate a professional git commit message in Conventional Commits style based on the following diff.
Title format: <type>(<scope>): <subject> (lowercase, no period at end).
Body: Concise bulleted list explaining the 'why' and 'how'.

Diff:
$diff_content"

    if [[ -n "$hint_content" ]]; then
        prompt="$prompt\n\nUser Hint: $hint_content"
    fi

    echo "$prompt" | gemini
}

HINT=""
while true; do
    echo "Generating commit message..."
    PROPOSED_MESSAGE=$(generate_commit_message "$HINT")

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
            if [[ -n "$FINAL_MESSAGE" ]]; then
                git commit -m "$FINAL_MESSAGE"
                exit $?
            else
                echo "Empty commit message. Cancelled."
                exit 1
            fi ;;
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
