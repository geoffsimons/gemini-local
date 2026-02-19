# CONTRIBUTING: Builder's Guide

This document defines the governance model, coding standards, and scripting requirements for extending the Gemini Local Hub.

## 1. Governance: The 'Verify Before Trust' Model

The Hub adheres to a strict lifecycle for managing project access. All contributors must respect these boundaries:

1. **Existence Validation**: No path may be added to the registry without a physical check via `fs.existsSync`.
2. **Deterministic Identity**: Session IDs must always be derived deterministically from the absolute path to ensure session coherence across different clients.
3. **State Isolation**: Automated tools (like commit generators) should always use the `ephemeral` flag to prevent background tasks from corrupting the user's primary conversation history.

## 2. Style & Formatting Rules

To maintain high code quality and prevent common LLM hallucinations, we enforce the following:

- **Strict No Trailing Whitespace**: All files must end with a single newline and contain zero trailing spaces.
- **No Code-Blocks-in-Prose**: When writing documentation or system instructions, do not wrap code examples in triple backticks unless they are intended to be extracted as a file. Use indentation or single backticks for inline references.
- **Explicit Type Safety**: All new API routes must define strict TypeScript interfaces for request bodies and response payloads.

## 3. Scripting Standards

All ecosystem scripts (Bash/Zsh) must prioritize portability and robustness:

- **JSON Construction**: Never use string interpolation to build JSON payloads. You **must** use `jq` to ensure proper escaping and structure.
    - *Bad*: `-d "{"path": "$VAR"}"`
    - *Good*: `PAYLOAD=$(jq -n --arg v "$VAR" '{path: $v}')`
- **Shell Compatibility**: Scripts must be compatible with both Bash 4+ and Zsh. Avoid shell-specific built-ins that break portability (e.g., use `read` instead of `read -k`).
- **Preflight Checks**: Every script must validate its dependencies (`curl`, `jq`) and perform a health check against the Hub (`/api/health`) before execution.
