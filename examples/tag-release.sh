#!/usr/bin/env bash
# GCA - Automated Tagging Utility
# Usage: ./tag-release.sh

set -euo pipefail

HUB_PORT=${GEMINI_HUB_PORT:-2999}
HUB_URL="http://localhost:${HUB_PORT}/api/chat/prompt"
PROJECT_PATH="$(pwd -P)"

# 1. Gather History since last tag
if LAST_TAG=$(git describe --tags --match="v*" --abbrev=0 2>/dev/null); then
  HISTORY="$(git log ${LAST_TAG}..HEAD --oneline)"
  if [[ -z "$HISTORY" ]]; then
    echo "ℹ️ No new commits since $LAST_TAG. Nothing to tag."
    exit 0
  fi
else
  echo "⚠️ No previous tags found. Defaulting to v0.1.0."
  LAST_TAG="v0.0.0"
  HISTORY="$(git log --oneline)"
fi

# 2. Build the Versioning Prompt
PROMPT="Current Version: ${LAST_TAG}
Recent Changes:
${HISTORY}

Task: Based on the changes above, determine if this release should be a MINOR or PATCH version bump. 
Rules:
1. Bumping to MINOR (e.g., v3.2.0 -> v3.3.0) if there are architectural refactors, new features, or significant logic shifts (like moving prompts to backend or deleting stores).
2. Bumping to PATCH (e.g., v3.2.0 -> v3.2.1) if there are only bug fixes, CSS tweaks, or minor text changes.
3. Output ONLY the raw version string (e.g., v3.3.0) and nothing else."

# 3. Query the Hub for the version recommendation
echo "🤖 Consulting the Hub for version recommendation..."
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

RESPONSE=$(curl -s -X POST "$HUB_URL" -H "Content-Type: application/json" -d "$PAYLOAD")
NEW_TAG=$(echo "$RESPONSE" | node -e "
  try {
    const d = JSON.parse(fs.readFileSync(0, 'utf8'));
    process.stdout.write(d.response.trim());
  } catch {
    process.exit(1);
  }
")

if [[ ! "$NEW_TAG" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "❌ Error: Hub returned invalid version string: $NEW_TAG"
  exit 1
fi

echo "✅ Hub recommends: $NEW_TAG (Previous: $LAST_TAG)"
echo "🚀 Run the following to release:"
echo ""
echo "git tag $NEW_TAG && git push origin $NEW_TAG"