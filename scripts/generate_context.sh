#!/bin/bash

# Output file
OUTPUT_FILE="CONTEXT_SUMMARY.md"

# Initialize file
echo "# Project Context Summary" > "$OUTPUT_FILE"
echo "Generated on: $(date)" >> "$OUTPUT_FILE"
echo "" >> "$OUTPUT_FILE"

# Git Section
echo "## Git Status" >> "$OUTPUT_FILE"
echo "\`\`\`" >> "$OUTPUT_FILE"
echo "Branch: $(git branch --show-current)" >> "$OUTPUT_FILE"
echo "" >> "$OUTPUT_FILE"
echo "Recent Log:" >> "$OUTPUT_FILE"
git log -n 5 --oneline >> "$OUTPUT_FILE"
echo "\`\`\`" >> "$OUTPUT_FILE"
echo "" >> "$OUTPUT_FILE"

# Function to process files
# Usage: process_files "Category Name" "${ARRAY[@]}"
process_files() {
    local category_name="$1"
    shift
    local files=("$@")

    echo "### $category_name" >> "$OUTPUT_FILE"

    for pattern in "${files[@]}"; do
        # Expand glob patterns (unquoted $pattern allows expansion)
        # We use 'ls' to handle wildcards safely, redirecting stderr to null
        for file in $pattern; do
            if [ -f "$file" ]; then
                echo "Adding $file..."
                echo "=== FILE: $file ===" >> "$OUTPUT_FILE"

                # Determine extension for syntax highlighting
                ext="${file##*.}"
                case "$ext" in
                    ts|tsx) lang="typescript" ;;
                    js|mjs) lang="javascript" ;;
                    py)     lang="python" ;;
                    md)     lang="markdown" ;;
                    json)   lang="json" ;;
                    css)    lang="css" ;;
                    *)      lang="" ;;
                esac

                echo "\`\`\`$lang" >> "$OUTPUT_FILE"
                cat "$file" >> "$OUTPUT_FILE"
                echo "" >> "$OUTPUT_FILE"
                echo "\`\`\`" >> "$OUTPUT_FILE"
                echo "" >> "$OUTPUT_FILE"
            fi
        done
    done
}

# --- DEFINITIONS ---

# 1. Documentation & Config (The "Why")
DOCS=(
    "GEMINI.md"
    "DECISIONS.md"
    "CHANGELOG.md"
    "package.json"
    "next.config.mjs"
)

# 2. Core Logic (The "Brain")
# Shared utilities, Singleton instances, Image processing
CORE_LIB=(
    "lib/gemini.ts"
    "lib/image.ts"
    "lib/*.ts" # Catch-all for future utils
)

# 3. API Architecture (The "Backend")
API_ROUTES=(
    "app/api/chat/route.ts"
    "app/api/**/*.ts" # Catch-all for future routes
)

# 4. UI Architecture (The "Frontend")
UI_COMPONENTS=(
    "app/page.tsx"
    "app/layout.tsx"
    "app/components/*.tsx"
    "app/globals.css"
)

# --- EXECUTION ---

echo "Generating context summary..."
process_files "Documentation & Config" "${DOCS[@]}"
process_files "Core Logic (Lib)" "${CORE_LIB[@]}"
process_files "API Routes" "${API_ROUTES[@]}"
process_files "UI Components" "${UI_COMPONENTS[@]}"

# Clipboard Integration (macOS)
if command -v pbcopy &> /dev/null; then
    cat "$OUTPUT_FILE" | pbcopy
    echo "✅ Context summary generated and copied to clipboard."
else
    echo "⚠️  pbcopy not found. Context summary generated at $OUTPUT_FILE."
fi