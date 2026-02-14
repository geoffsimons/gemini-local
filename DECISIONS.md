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
- **Consequences:** Enables multi-turn conversations across separate HTTP requests; requires proactive management of race conditions during concurrent session initialization.

## ADR-003: Server-Side Image Composite (Stitching)
- **Status:** Accepted
- **Context:** The underlying Gemini API and model behavior can be inconsistent when handling multiple independent image attachments.
- **Decision:** Use the `sharp` library to stitch multiple input images into a single horizontal composite PNG before transmission.
- **Consequences:** Ensures high-fidelity text readability and consistent model analysis; bypasses single-image constraints while maintaining visual context.
