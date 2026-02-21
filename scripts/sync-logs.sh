#!/usr/bin/env bash

# Check if gemini CLI is installed
if ! command -v gemini &> /dev/null; then
    echo "Error: gemini CLI not found in PATH."
    exit 1
fi

# Check if node is installed
if ! command -v node &> /dev/null; then
    echo "Error: Node.js not found in PATH."
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

# Process the output with Node.js to update files directly
echo "$OUTPUT" | node -e "
const fs = require('fs');
const path = require('path');

let content = '';
process.stdin.on('data', chunk => { content += chunk; });
process.stdin.on('end', () => {
    const pattern = /<<<FILE:(.*?)>>>\s*([\s\S]*?)\s*<<<END_FILE>>>/g;
    let match;
    let found = false;

    while ((match = pattern.exec(content)) !== null) {
        found = true;
        let filename = match[1].trim();
        const newContent = match[2].trim();

        // Ensure we are working with root files
        if (filename.includes('/')) {
            filename = path.basename(filename);
        }

        if (!fs.existsSync(filename)) {
            console.log('Warning: File ' + filename + ' not found, skipping.');
            continue;
        }

        try {
            const existingContent = fs.readFileSync(filename, 'utf8');
            let updatedContent = existingContent;

            if (filename.includes('CHANGELOG')) {
                // Insert BEFORE the first version header (## [...) to keep reverse chrono order
                const headerRegex = /^##\s/m;
                const headerMatch = headerRegex.exec(existingContent);
                
                if (headerMatch) {
                    const idx = headerMatch.index;
                    updatedContent = existingContent.slice(0, idx) + newContent + '\n\n' + existingContent.slice(idx);
                } else {
                    // If no headers found (new file), append to bottom
                    updatedContent = existingContent.trimEnd() + '\n\n' + newContent + '\n';
                }
            } else if (filename.includes('DECISIONS')) {
                // Append to the end
                updatedContent = existingContent.trimEnd() + '\n\n' + newContent + '\n';
            }

            fs.writeFileSync(filename, updatedContent, 'utf8');
            console.log('Updated ' + filename);

        } catch (err) {
            console.error('Error updating ' + filename + ': ' + err.message);
        }
    }

    if (!found) {
        console.log('No new updates found in Gemini output.');
        process.exit(0);
    }
});
"

echo "Done. Please review 'git diff' to verify changes before committing."