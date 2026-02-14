#!/usr/bin/env bash
# Compatible with Bash and Zsh.

# Gemini Local Hub - Example Log Sync Utility
# Usage: Copy this to your project root and run ./sync-logs.sh

set -euo pipefail

HUB_URL="http://localhost:3000/api/chat/prompt"
PROJECT_PATH="$(pwd -P)"

# 1. Health Check
if ! curl -s -f "http://localhost:3000/api/health" > /dev/null; then
    echo "❌ Error: Gemini Local Hub is not running at localhost:3000."
    exit 1
fi

# 2. Gather recent git history
HISTORY="$(git log -n 15 --pretty=format:"%h - %ad : %s" --date=short)"

# 3. Read existing context summaries
CHANGELOG_CONTENT="$(head -n 50 CHANGELOG.md 2>/dev/null || echo "")"
DECISIONS_LOG="$(tail -n 50 DECISIONS.md 2>/dev/null || echo "")"

# 4. Define the prompt
PROMPT="Analyze the following git history and prepare updates for our project documentation.

EXISTING CONTENT SUMMARY (Do NOT duplicate these):
- CHANGELOG.md (Top 50 lines):
$CHANGELOG_CONTENT

- DECISIONS.md (Last 50 lines):
$DECISIONS_LOG

STRICT RULES:
1. COMPARE the Git History against the Existing Content.
2. DO NOT generate entries for changes that are already logged.
3. For DECISIONS.md, find the last ADR number in the summary (e.g., ADR-014) and start numbering NEW entries from the next integer.
4. If no significant architectural decisions were made, do NOT generate a DECISIONS.md block.

OUTPUT FORMAT:
For each file that needs updating, output a block strictly following this format:

<<<FILE:CHANGELOG.md>>>
[Content]
<<<END_FILE>>>

<<<FILE:DECISIONS.md>>>
[Content]
<<<END_FILE>>>

Git History:
$HISTORY
"

# 5. Query the Hub
echo "🤖 Querying Gemini Hub for documentation updates..."
RESPONSE="$(curl -s -X POST "$HUB_URL" \
    -H "Content-Type: application/json" \
    -d "{\"folderPath\": \"$PROJECT_PATH\", \"message\": \"$PROMPT\"}")"

OUTPUT="$(echo "$RESPONSE" | jq -r '.response')"

if [[ -z "$OUTPUT" || "$OUTPUT" == "null" ]]; then
    echo "❌ Error: Failed to get a response from the Hub."
    exit 1
fi

# 6. Process the output with Python
# The pipe-based approach is robust for large strings in both Bash and Zsh,
# as data flows through stdin rather than command-line arguments.
echo "$OUTPUT" | python3 -c "
import sys, re, os

content = sys.stdin.read()
pattern = r'<<<FILE:(.*?)>>>\s*(.*?)\s*<<<END_FILE>>>'
matches = re.findall(pattern, content, re.DOTALL)

if not matches:
    print('No new updates found in Gemini output.')
    sys.exit(0)

for filename, new_content in matches:
    filename = filename.strip()
    new_content = new_content.strip()

    if '/' in filename:
        filename = os.path.basename(filename)

    if not os.path.exists(filename):
        print(f'Warning: File {filename} not found, skipping.')
        continue

    try:
        with open(filename, 'r') as f:
            existing_content = f.read()

        updated_content = existing_content

        if 'CHANGELOG' in filename:
            match = re.search(r'^##\s', existing_content, re.MULTILINE)
            if match:
                idx = match.start()
                updated_content = existing_content[:idx] + new_content + '\n\n' + existing_content[idx:]
            else:
                updated_content = existing_content.rstrip() + '\n\n' + new_content + '\n'

        elif 'DECISIONS' in filename:
            updated_content = existing_content.rstrip() + '\n\n' + new_content + '\n'

        with open(filename, 'w') as f:
            f.write(updated_content)

        print(f'✅ Updated {filename}')

    except Exception as e:
        print(f'❌ Error updating {filename}: {e}')
"

echo "Done. Please review 'git diff' to verify changes."
