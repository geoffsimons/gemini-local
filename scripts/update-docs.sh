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

# Gather context files
COMPASS=$(cat GEMINI.md 2>/dev/null || echo "No GEMINI.md found.")
README_CONTENT=$(cat README.md 2>/dev/null || echo "No README.md found.")
USAGE_CONTENT=$(cat USAGE.md 2>/dev/null || echo "No USAGE.md found.")
CHANGELOG_CONTENT=$(head -n 30 CHANGELOG.md 2>/dev/null || echo "No CHANGELOG found.")

# Define the prompt
PROMPT="Act as a Senior Technical Writer. We are preparing a new release for our project. 
Read our architectural compass, our recent changelog, and our existing documentation. 
Rewrite the README.md and USAGE.md to accurately reflect the current state of the project.

PROJECT COMPASS (GEMINI.md):
$COMPASS

RECENT CHANGES (CHANGELOG.md):
$CHANGELOG_CONTENT

CURRENT README.md:
$README_CONTENT

CURRENT USAGE.md:
$USAGE_CONTENT

STRICT RULES:
1. Update features, architecture descriptions, and setup instructions to match the COMPASS and recent changes.
2. Do not remove core setup instructions unless they are obsolete.
3. Keep the tone professional, concise, and developer-focused.
4. Output the COMPLETE rewritten text for both files.

OUTPUT FORMAT:
For each file, output a block strictly following this format:

<<<FILE:README.md>>>
[Complete Markdown Content]
<<<END_FILE>>>

<<<FILE:USAGE.md>>>
[Complete Markdown Content]
<<<END_FILE>>>
"

# Run gemini and capture output
echo "Querying Gemini to rewrite README.md and USAGE.md..."
OUTPUT=$(echo "$PROMPT" | gemini)

if [[ $? -ne 0 ]]; then
    echo "Error: Gemini command failed."
    exit 1
fi

# Process the output with Node.js to overwrite files
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

        if (filename.includes('/')) {
            filename = path.basename(filename);
        }

        try {
            fs.writeFileSync(filename, newContent + '\n', 'utf8');
            console.log('Successfully updated ' + filename);
        } catch (err) {
            console.error('Error updating ' + filename + ': ' + err.message);
        }
    }

    if (!found) {
        console.log('No documentation updates found in Gemini output. Check prompt or CLI response.');
        process.exit(0);
    }
});
"

echo "Done. Please review 'git diff' to verify the documentation updates before committing."