# Gemini Local Hub: Stateful Orchestration Layer

The Gemini Local Hub is a high-performance orchestration layer designed to transform stateless LLM interactions into persistent, project-aware developer sessions. By maintaining a pool of "Warm Sessions" in memory, the Hub eliminates the significant cold-start latency associated with standard CLI invocations, enabling near-instantaneous AI-driven workflows.

## 1. Architectural Intent: The Warm Session Advantage

Standard CLI-based AI tools suffer from an "Invocation Penalty"—every call requires a fresh OAuth handshake, model discovery, and context loading. The Hub centralizes these costs into a single, long-lived process.

- **Session Persistence**: Maintains `GeminiClient` instances as global singletons, preserving conversation history and local memory across separate HTTP requests.
- **Latency Elimination**: Reduces sub-10 second cold starts to sub-second "warm" responses by keeping the model connection alive and authenticated.
- **Project-Aware Context**: Automatically injects project-specific rules (`GEMINI.md`) into every session, ensuring the model operates with full architectural awareness from the first prompt.

## 2. Core Pillars

### Stateful Registry Pattern
The Hub's heart is a `ClientRegistry` that maps filesystem paths to deterministic session IDs. This ensures that any tool—be it a shell script, a CI pipeline, or the built-in UI—interacts with the same coherent conversation state for a given project.

### Governance: Verify Before Trust
Security is enforced through a strict "Verify Before Trust" model. No directory can be registered or accessed unless the Hub has physically validated its existence and provenance on the local disk. This prevents registry pollution and ensures that sessions are only spawned for valid, authorized project roots.

### Multimodal Normalization
The Hub stabilizes model reasoning for complex visual tasks by performing server-side image normalization. Using the `sharp` library, multiple input images are stitched into a single high-fidelity composite, accompanied by structural system hints that guide the model's spatial interpretation.

## 3. The V2 Roadmap: Multi-Agent Collaboration

The future of the Hub lies in expanding from a single-session proxy to a multi-agent orchestration platform:

- **Named Workspaces**: Support for multiple independent conversation threads within a single project root.
- **Agent Roles**: Specialized "Architect" vs. "Coder" agents that can collaborate or peer-review within the same project context.
- **Autonomous Diagnostics**: Real-time integration with system logs and build errors for proactive, agent-driven debugging.

---
MIT License | Built for high-speed local AI development.
