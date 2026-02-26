#!/usr/bin/env bash

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

# Parse optional -m hint
HINT=""
while getopts 'm:' opt; do
    case $opt in
        m) HINT="$OPTARG" ;;
    esac
done
shift $((OPTIND - 1))

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

    # Using echo -e to ensure newlines in the prompt are respected before piping
    echo -e "$prompt" | gemini
}

echo "Generating commit message..."
PROPOSED_MESSAGE="$(generate_commit_message "$HINT")"

if [[ -z "$PROPOSED_MESSAGE" ]]; then
    echo "Error: Failed to get a response from gemini."
    exit 1
fi

echo ""
echo "--- PROPOSED COMMIT MESSAGE ---"
echo "$PROPOSED_MESSAGE"
echo "-------------------------------"
echo ""

git commit -m "$PROPOSED_MESSAGE"
exit $?

