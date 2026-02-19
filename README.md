# Gemini Local Hub: Stateful Orchestration Layer

The Hub is a high-performance HTTP bridge for the Google Gemini CLI, designed to transform stateless CLI calls into persistent, project-aware developer sessions. It eliminates the "Cold Start" latency of standard CLI invocations by maintaining a pool of "Warm Sessions" in memory, drastically reducing the feedback loop for automated AI workflows.

## 1. The Value Proposition: Stateful Orchestration

Standard CLI tools are inherently ephemeral; every execution incurs the full overhead of authentication, model discovery, and context loading. The Hub centralizes these costs into a long-lived orchestration layer.

- **Warm Session Performance**: By maintaining `GeminiClient` instances in a global singleton, the Hub achieves sub-second response times for recurring tasks by bypassing the OAuth handshake and discovery phase.
- **Context Persistence**: Conversation history and system instructions are preserved across separate HTTP requests, enabling complex multi-turn automation that is impossible with standard one-off CLI calls.
- **Unified Interface**: A single Node.js process serves both a production-ready API for shell integration and a modern UI for interactive multi-modal analysis.

## 2. Technical Architecture: Deep Dive

### Registry Pattern: Global Singleton
The core of the Hub is a persistent `ClientRegistry` (`lib/registry.ts`) that maps local filesystem paths to `GeminiClient` instances.
- **Deterministic Hashing**: Project identities are derived from scrypt-hashed absolute paths, ensuring consistent session mapping across different clients.
- **Lazy Initialization**: Sessions are spawned upon first request and undergo a "Golden Copy" sequence: `Authentication Refresh` -> `Config Initialization` -> `Memory Injection` -> `Chat Start`.
- **Process Persistence**: The registry is hoisted to `globalThis`, surviving Next.js Fast Refresh cycles during development to prevent session drops.

### Multimodal Normalization: Sharp Stitching
Gemini models can exhibit inconsistent spatial reasoning when presented with multiple independent image buffers. The Hub normalizes these inputs using the `sharp` library:
- **Horizontal Stitching**: Multiple input images are composited into a single high-fidelity PNG buffer server-side.
- **System Instruction Injection**: The prompt is automatically augmented with a structural hint: `[System: User has attached a composite image containing N images stitched horizontally...]`. This stabilizes the model's ability to interpret visual context ordered left-to-right.

### Context Injection: The Project Memory Bridge
The Hub automatically detects a `GEMINI.md` file in the project root. This file acts as a persistent memory bridge:
- **Automated Loading**: Contents are injected as system instructions during session initialization.
- **Standardized Constraints**: Architectural decisions, coding standards, and project-specific jargon are inherently understood by the model without manual prompt engineering.

## 3. Governance & Security: Verify Before Trust

The Hub implements a strict **Verify Before Trust** model to prevent unauthorized filesystem access and registry pollution.
- **Path Validation**: Directories are strictly validated for physical existence via `fs.existsSync` before being committed to the persistent `~/.gemini/trustedFolders.json` registry.
- **Auto-Healing Registry**: The registry self-corrects on read, migrating legacy formats to optimized object maps and pruning inaccessible paths to prevent "Ghost Trusts".

## 4. The Ecosystem: High-Speed Developer Tools

The `examples/` directory serves as a blueprint for project-aware automation, leveraging the Hub's warm sessions for near-instant execution.

- **`commit.sh`**: A context-aware commit generator. It pipes staged diffs to the Hub, generating Conventional Commits that adhere to the project's `GEMINI.md` rules. Uses `jq` for JSON-safe encoding of complex diffs.
- **`sync-logs.sh`**: Architecturally-aligned documentation synchronization. It analyzes Git history and existing context to surgically update `CHANGELOG.md` and `DECISIONS.md`, ensuring documentation never drifts from implementation.

## 5. Operational Guide: Production Setup

### Prerequisites
- **Node.js**: >= 18.17.0
- **Gemini CLI**: Authenticated via `gemini login`

### Installation & Execution
```bash
npm install
npm run dev
```
The Hub Console is exposed at `http://localhost:3000`.

### Keyboard Orchestration
The Hub Console adheres to professional IDE standards for high-speed interaction:
- **`Enter`**: Submit prompt.
- **`Shift + Enter`**: Insert new line.
- **`Cmd/Ctrl + L`**: Clear active session history.

## 6. Future Roadmap: The V2 Vision

The Hub is evolving from a session proxy into a collaborative multi-agent platform:
- **Named Sessions**: Transitioning from folder-based keys to independent "Workspaces" within a single project.
- **Multi-Agent Collaboration**: Orchestrating distinct "Architect" and "Coder" agents within the same session to provide diverse perspectives on complex refactors.
- **Native Hook Integration**: Seamlessly piping system logs and build errors directly into the session for real-time autonomous debugging.

---
MIT License | Built with Gemini CLI Core.
