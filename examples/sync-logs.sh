#!/usr/bin/env bash
# Gemini Local Hub - Log Sync Utility
# Usage:
#   ./sync-logs.sh            (Updates CHANGELOG only)
#   ./sync-logs.sh --release  (Updates CHANGELOG and DECISIONS)
# Requirements: curl, node

set -euo pipefail

HUB_PORT=${GEMINI_HUB_PORT:-2999}
HUB_URL="http://localhost:${HUB_PORT}/api/chat/prompt"
PROJECT_PATH="$(pwd -P)"

# 1. Parse Arguments
UPDATE_DECISIONS=false
COMMIT_COUNT=15
if [[ "${1:-}" == "--release" ]]; then
  UPDATE_DECISIONS=true
  COMMIT_COUNT=50
  echo "🚀 Release mode enabled: Will propose DECISIONS.md updates if architectural shifts occurred."
fi

# 2. Preflight — curl and node required
for cmd in curl node; do
  if ! command -v "$cmd" &>/dev/null; then
    echo "❌ Required tool '$cmd' is not installed. Please install it and try again."
    exit 1
  fi
done

# 3. Health Check
if ! curl -s -f "http://localhost:${HUB_PORT}/api/health" > /dev/null; then
  echo "❌ Error: Gemini Local Hub is not running at localhost:${HUB_PORT}."
  exit 1
fi

# 4. Gather recent git history (Tag-Aware)
if LAST_TAG=$(git describe --tags --match="v*" --abbrev=0 2>/dev/null); then
  echo "📌 Found last release tag: $LAST_TAG"
  HISTORY="$(git log ${LAST_TAG}..HEAD --pretty=format:"%h - %ad : %s" --date=short)"

  # Fallback if there are no new commits since the last tag
  if [[ -z "$HISTORY" ]]; then
    echo "⚠️ No new commits since $LAST_TAG. Falling back to last $COMMIT_COUNT commits."
    HISTORY="$(git log -n $COMMIT_COUNT --pretty=format:"%h - %ad : %s" --date=short)"
  fi
else
  echo "⚠️ No version tags found. Using last $COMMIT_COUNT commits."
  HISTORY="$(git log -n $COMMIT_COUNT --pretty=format:"%h - %ad : %s" --date=short)"
fi

# 5. Locate CHANGELOG.md and DECISIONS.md (monorepo-aware, max depth 3)
DOC_FILES=""
while IFS= read -r -d '' f; do
  DOC_FILES="${DOC_FILES}${f}\n"
done < <(find . -maxdepth 3 \( -name "CHANGELOG.md" -o -name "DECISIONS.md" \) -print0 2>/dev/null)

# 6. Build context
EXISTING_CONTENT=""
HIGHEST_ADR="ADR-000"

if [[ -n "$DOC_FILES" ]]; then
  while IFS= read -r -d '' relpath; do
    [[ -z "$relpath" ]] && continue
    relpath="${relpath#./}"
    if [[ -f "$relpath" ]]; then

      if [[ "$relpath" == *"CHANGELOG.md"* ]]; then
        snippet="$(head -n 50 "$relpath" 2>/dev/null || true)"
        EXISTING_CONTENT="${EXISTING_CONTENT}\n--- ${relpath} (excerpt) ---\n${snippet}\n"
      elif [[ "$relpath" == *"DECISIONS.md"* ]]; then
        FOUND_ADR=$(grep -oE 'ADR-[0-9]{3}' "$relpath" | sort -r | head -n 1 || true)
        if [[ -n "$FOUND_ADR" ]]; then
          HIGHEST_ADR="$FOUND_ADR"
        fi
      fi

    fi
  done < <(echo -en "$DOC_FILES" | tr '\n' '\0')
fi

# 7. Dynamic Prompting based on mode
DECISION_INSTRUCTIONS="CRITICAL: DO NOT generate updates for DECISIONS.md. ONLY update CHANGELOG.md."
if [[ "$UPDATE_DECISIONS" == "true" ]]; then
  DECISION_INSTRUCTIONS="You MAY generate updates for DECISIONS.md if significant architectural shifts occurred. The highest existing ADR is ${HIGHEST_ADR}. Start numbering new entries from the next integer."
fi

PROMPT="Task: Analyze the following git history and prepare updates for our project documentation.
All necessary file excerpts and git history are provided below. DO NOT use any tools to read or write files. Rely exclusively on the text provided in this prompt.

EXISTING CONTENT SUMMARY (Do NOT duplicate these entries). Each block is prefixed with its relative path:
${EXISTING_CONTENT}

STRICT RULES:
1. COMPARE the Git History against the Existing Content.
2. DO NOT generate entries for changes that are already logged.
3. DO NOT output the top-level file headers (e.g., "# Changelog" or "All notable changes..."). Output ONLY the new specific entries starting with "## ".
4. ${DECISION_INSTRUCTIONS}

OUTPUT FORMAT:
For each file that needs updating, output a block with the EXACT relative path as shown above:

<<<FILE:relative/path/to/file.md>>>
[Content]
<<<END_FILE>>>

Git History:
$HISTORY
"

# 8. Query the Hub
echo "🤖 Querying Gemini Hub for documentation updates (Isolated Context)..."
PAYLOAD=$(echo "$PROMPT" | node -e "
  const fs = require('fs');
  const fp = process.argv[1];
  const msg = fs.readFileSync(0, 'utf8');
  console.log(JSON.stringify({
    folderPath: fp,
    message: msg,
    ephemeral: true,
    model: 'gemini-2.5-flash'
  }));
" "$PROJECT_PATH")

OUTPUT=""
USED_MODEL=""
attempts=0
max_attempts=2
while [ "$attempts" -lt "$max_attempts" ]; do
  RESPONSE=$(curl -s -X POST "$HUB_URL" \
    -H "Content-Type: application/json" \
    -d "$PAYLOAD")
  PARSED=$(echo "$RESPONSE" | node -e "
    const fs = require('fs');
    try {
      const d = JSON.parse(fs.readFileSync(0, 'utf8'));
      const model = d.usedModel != null ? String(d.usedModel) : '';
      const response = d.response != null ? String(d.response) : '';
      process.stdout.write(model + '\n' + response);
    } catch {
      process.stdout.write('\n');
    }
  ")
  read -r USED_MODEL <<< "$PARSED"
  OUTPUT=$(printf '%s\n' "$PARSED" | tail -n +2)
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

# 9. Process the output with Node.js
echo "$OUTPUT" | USED_MODEL="$USED_MODEL" node -e "
const fs = require('fs');
const path = require('path');
const content = fs.readFileSync(0, 'utf8');
const usedModel = process.env.USED_MODEL;
const modelText = (usedModel && usedModel.trim() !== '') ? ' (Model: ' + usedModel + ')' : '';
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
    console.log('✅ Updated ' + relPath + modelText);
  } catch (e) {
    console.error('❌ Error updating', relPath, ':', e.message);
  }
}
"

echo "Done. Please review 'git diff' to verify changes."