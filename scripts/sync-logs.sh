#!/usr/bin/env zsh

# Check if gemini CLI is installed
if ! command -v gemini &> /dev/null; then
    echo "Error: gemini CLI not found in PATH."
    exit 1
fi

# Gather recent git history
HISTORY=$(git log -n 15 --pretty=format:"%h - %ad : %s" --date=short)

# Read existing content summaries to give context
# We use '|| true' to prevent script failure if files are empty
CHANGELOG_CONTENT=$(head -n 50 CHANGELOG.md 2>/dev/null || echo "")
DECISIONS_LOG=$(tail -n 50 DECISIONS.md 2>/dev/null || echo "")

# Define the prompt
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

CONTENT INSTRUCTIONS:
- For CHANGELOG.md: [Content] must be a single version block. Format: \"## [Unreleased] - YYYY-MM-DD\" followed by bullet points. Do NOT include previous versions.
- For DECISIONS.md: [Content] must be the new ADR entry only.

Git History:
$HISTORY
"

# Run gemini and capture output
echo "Querying Gemini for documentation updates..."
OUTPUT=$(echo "$PROMPT" | gemini)

if [[ $? -ne 0 ]]; then
    echo "Error: Gemini command failed."
    exit 1
fi

# Process the output with Python to update files directly
echo "$OUTPUT" | python3 -c "
import sys, re, os

content = sys.stdin.read()
# Regex to find blocks: <<<FILE:path>>> ... <<<END_FILE>>>
pattern = r'<<<FILE:(.*?)>>>\s*(.*?)\s*<<<END_FILE>>>'
matches = re.findall(pattern, content, re.DOTALL)

if not matches:
    print('No new updates found in Gemini output.')
    sys.exit(0)

for filename, new_content in matches:
    filename = filename.strip()
    new_content = new_content.strip()

    # Ensure we are working with root files
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
            # Insert BEFORE the first version header (## [...) to keep reverse chrono order
            # We look for the first '## ' to identify the start of the previous log
            match = re.search(r'^##\s', existing_content, re.MULTILINE)
            if match:
                idx = match.start()
                updated_content = existing_content[:idx] + new_content + '\n\n' + existing_content[idx:]
            else:
                # If no headers found (new file), append to bottom
                updated_content = existing_content.rstrip() + '\n\n' + new_content + '\n'

        elif 'DECISIONS' in filename:
            # Append to the end
            updated_content = existing_content.rstrip() + '\n\n' + new_content + '\n'

        with open(filename, 'w') as f:
            f.write(updated_content)

        print(f'Updated {filename}')

    except Exception as e:
        print(f'Error updating {filename}: {e}')
"

echo "Done. Please review 'git diff' to verify changes before committing."