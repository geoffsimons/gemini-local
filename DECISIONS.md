# Architecture Decision Records (ADR)

## ADR-001: Next.js Monorepo Structure
- **Status:** Accepted
- **Context:** We needed a simplified way to distribute the API and UI together.
- **Decision:** Use Next.js App Router to serve both the API routes (backend) and React components (frontend) in a single process.
- **Consequences:** Simplified deployment; Shared type definitions; Global Singleton pattern required for CLI persistence.

## ADR-002: Client Registry for Session Persistence
- **Status:** Accepted
- **Context:** The Gemini CLI requires a persistent process to maintain conversation state, but HTTP is stateless.
- **Decision:** Implement a centralized `Registry` to manage and cache `GeminiClient` instances, keyed by the target project directory.
- **Consequences:** Enables multi-turn conversations across separate HTTP requests; requires proactive management of race conditions during concurrent session initialization. Enables a "Warm Session" pattern that eliminates OAuth handshake and discovery latency for recurring requests (e.g., commit scripts).

## ADR-003: Server-Side Image Composite (Stitching)
- **Status:** Accepted
- **Context:** The underlying Gemini API and model behavior can be inconsistent when handling multiple independent image attachments.
- **Decision:** Use the `sharp` library to stitch multiple input images into a single horizontal composite PNG before transmission.
- **Consequences:** Ensures high-fidelity text readability and consistent model analysis; bypasses single-image constraints while maintaining visual context.

## ADR-004: Folder Trust & Governance Lifecycle
- **Status:** Accepted
- **Context:** To ensure security and prevent unauthorized session initialization across the filesystem, the system needs a mechanism to track and validate "trusted" project directories before the CLI process is spawned.
- **Decision:** Introduce a persistent `trustedFolders.json` registry (managed via `lib/folders.ts`) that stores an object map of authorized paths. All project registrations must pass an existence check and follow an auto-trust policy. Implement a "Verify Before Trust" guardrail that strictly validates the physical existence of a directory before adding it to the persistent registry.
- **Consequences:** Provides a security layer against arbitrary filesystem access; enables the UI to display a managed list of active/available projects; transitions the system from simple session management to a governed project lifecycle. Prevents "Ghost Trusts" and registry pollution from invalid or deleted project paths.

## ADR-005: Universal Shell Compatibility
- **Status:** Accepted
- **Context:** The Hub's integration scripts need to operate across diverse developer environments (macOS, Linux, WSL).
- **Decision:** Target Bash 4+ as the primary scripting language for all examples and internal utilities while maintaining Zsh compatibility.
- **Consequences:** Ensures cross-platform portability for project-onboarding and automation scripts; requires avoiding Zsh-specific syntax (like `read -k`).

## ADR-006: Ephemeral Sessions and Custom Identifiers
- **Status:** Accepted
- **Context:** Automated tools (e.g., commit message generators) require short-lived, isolated execution contexts that should not interfere with the user's primary persistent chat history.
- **Decision:** Implement an `ephemeral` flag and support for custom `sessionId` strings in the chat API. Ephemeral sessions bypass the persistent registry and are intended for one-off tasks.
- **Consequences:** Enables stateless, automated interactions; prevents background tasks from polluting user-facing chat history; allows for concurrent session isolation within the same project directory.
