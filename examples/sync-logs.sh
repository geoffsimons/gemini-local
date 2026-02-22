#!/usr/bin/env bash
# Gemini Local Hub - Example Log Sync Utility
# Usage: Copy this to your project root and run ./sync-logs.sh
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

# 3. Gather recent git history
HISTORY="$(git log -n 15 --pretty=format:"%h - %ad : %s" --date=short)"

# 4. Locate CHANGELOG.md and DECISIONS.md (monorepo-aware, max depth 3)
DOC_FILES=""
while IFS= read -r -d '' f; do
  DOC_FILES="${DOC_FILES}${f}\n"
done < <(find . -maxdepth 3 \( -name "CHANGELOG.md" -o -name "DECISIONS.md" \) -print0 2>/dev/null)

# 5. Build context: read each file and prefix with relative path
EXISTING_CONTENT=""
if [[ -n "$DOC_FILES" ]]; then
  while IFS= read -r -d '' relpath; do
    [[ -z "$relpath" ]] && continue
    # Normalize: strip leading ./
    relpath="${relpath#./}"
    if [[ -f "$relpath" ]]; then
      snippet="$(head -n 50 "$relpath" 2>/dev/null || true)"
      EXISTING_CONTENT="${EXISTING_CONTENT}
--- ${relpath} (excerpt, first 50 lines) ---
${snippet}

"
    fi
  done < <(echo -en "$DOC_FILES" | tr '\n' '\0')
fi

# 6. Define the prompt
PROMPT="Analyze the following git history and prepare updates for our project documentation.

EXISTING CONTENT SUMMARY (Do NOT duplicate these). Each block is prefixed with its relative path:
${EXISTING_CONTENT}

STRICT RULES:
1. COMPARE the Git History against the Existing Content.
2. DO NOT generate entries for changes that are already logged.
3. For DECISIONS.md, find the last ADR number in the summary (e.g., ADR-014) and start numbering NEW entries from the next integer.
4. If no significant architectural decisions were made, do NOT generate a DECISIONS.md block.

OUTPUT FORMAT:
For each file that needs updating, output a block with the EXACT relative path as shown above (e.g. CHANGELOG.md or packages/ui/CHANGELOG.md):

<<<FILE:relative/path/to/file.md>>>
[Content]
<<<END_FILE>>>

Use the same relative path used in the existing content summary (e.g. packages/ui/DECISIONS.md not just DECISIONS.md in a monorepo).

Git History:
$HISTORY
"

# 7. Query the Hub (graceful retry for transient latency)
echo "🤖 Querying Gemini Hub for documentation updates..."
PAYLOAD=$(echo "$PROMPT" | node -e "
  const fs = require('fs');
  const fp = process.argv[1];
  const msg = fs.readFileSync(0, 'utf8');
  console.log(JSON.stringify({ folderPath: fp, message: msg }));
" "$PROJECT_PATH")

OUTPUT=""
attempts=0
max_attempts=2
while [ "$attempts" -lt "$max_attempts" ]; do
  RESPONSE=$(curl -s -X POST "$HUB_URL" \
    -H "Content-Type: application/json" \
    -d "$PAYLOAD")
  OUTPUT=$(echo "$RESPONSE" | node -e "const d=JSON.parse(require('fs').readFileSync(0,'utf8')); console.log(d.response!=null?d.response:'')")
  if [[ -n "$OUTPUT" && "$OUTPUT" != "null" ]]; then
    break
  fi
  attempts=$((attempts + 1))
  if [ "$attempts" -lt "$max_attempts" ]; then
    sleep 1
  fi
done

if [[ -z "$OUTPUT" || "$OUTPUT" == "null" ]]; then
  echo "❌ Error: Failed to get a response from the Hub."
  exit 1
fi

# 8. Process the output with Node.js — extract <<<FILE:path>>> blocks and write to relative paths
echo "$OUTPUT" | node -e "
const fs = require('fs');
const path = require('path');
const content = fs.readFileSync(0, 'utf8');
const pattern = /<<<FILE:(.*?)>>>\s*([\s\S]*?)\s*<<<END_FILE>>>/g;
let match;
const matches = [];
while ((match = pattern.exec(content)) !== null) {
  const relPath = match[1].trim();
  const newContent = match[2].trim();
  if (relPath && newContent) matches.push([relPath, newContent]);
}
if (matches.length === 0) {
  console.log('No new updates found in Gemini output.');
  process.exit(0);
}
const cwd = process.cwd();
for (const [relPath, newContent] of matches) {
  if (!relPath || relPath.includes('..')) {
    console.log('Warning: Invalid or unsafe path skipped:', relPath);
    continue;
  }
  const fullPath = path.resolve(cwd, relPath);
  if (!fullPath.startsWith(cwd)) {
    console.log('Warning: Path escapes project root, skipping:', relPath);
    continue;
  }
  try {
    let existingContent = '';
    if (fs.existsSync(fullPath)) {
      existingContent = fs.readFileSync(fullPath, 'utf8');
    }
    let updatedContent = existingContent;
    const base = path.basename(relPath);
    if (base === 'CHANGELOG.md' && existingContent) {
      const idx = existingContent.search(/^##\s/m);
      if (idx >= 0) {
        updatedContent = existingContent.slice(0, idx) + newContent + '\n\n' + existingContent.slice(idx);
      } else {
        updatedContent = existingContent.trimEnd() + '\n\n' + newContent + '\n';
      }
    } else if (base === 'DECISIONS.md' && existingContent) {
      updatedContent = existingContent.trimEnd() + '\n\n' + newContent + '\n';
    } else {
      updatedContent = existingContent.trimEnd() + '\n\n' + newContent + '\n';
    }
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, updatedContent);
    console.log('✅ Updated', relPath);
  } catch (e) {
    console.error('❌ Error updating', relPath, ':', e.message);
  }
}
"

echo "Done. Please review 'git diff' to verify changes."
