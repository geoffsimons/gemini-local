# Gemini Local Hub

The Gemini Local Hub is a robust, local-first HTTP bridge and orchestration layer for the Google Gemini CLI. It transforms the stateless nature of LLM interactions into persistent, project-aware developer sessions, providing both a high-performance API and a modern chat interface.

## Core Objective

The Hub serves two primary purposes:
1.  **API Layer:** Wraps `@google/gemini-cli-core` to provide a persistent, stateful HTTP interface that eliminates the "Invocation Penalty" (OAuth handshakes and model discovery) of standard CLI calls.
2.  **UI Layer:** A modern, Next.js-based chat interface designed for complex multi-modal workflows and real-time agentic interactions.

## Architectural Pillars

### 1. Stateful "Warm" Sessions (ADR-001/002)
By utilizing a **Global Singleton** pattern, the Hub maintains Gemini client instances in memory across requests. This preserves conversational history and local memory, reducing cold-start latency from seconds to milliseconds. Sessions are deterministically keyed to trusted project directories.

### 2. Agentic Loop & Tool Execution (ADR-007)
The Hub implements a sophisticated asynchronous streaming pipeline for multi-turn tool use.
- **YOLO Mode:** Automated server-side execution via the native SDK `ToolRegistry`.
- **Manual Approval:** Human-in-the-loop validation for sensitive tool calls.
- **State Machine:** Handles complex sequences where the model requires multiple tool interactions to fulfill a single user request.

### 3. Real-Time Thought Streaming
Full transparency into the model's reasoning process. The UI renders real-time "thought blocks"—collapsible reasoning segments that allow developers to monitor the model's logic before it commits to an answer or tool execution.

### 4. Multimodal Normalization (ADR-003)
The Hub circumvents API limitations by performing server-side image processing. Multiple images are stitched into high-fidelity composites using `sharp`, ensuring spatial context is preserved without sacrificing text readability or introducing artifacts.

### 5. Trusted Workspace Governance (ADR-004)
Security is enforced through a persistent registry. The Hub only interacts with "Trusted Folders" that have been physically validated on the local disk, preventing unauthorized filesystem access.

## Tech Stack

- **Framework:** Next.js (App Router)
- **Styling:** Tailwind CSS (v4) with `clsx` and `tailwind-merge`
- **Core Engine:** `@google/gemini-cli-core`
- **Image Processing:** `sharp`
- **Icons:** `lucide-react`

---
MIT License | Built for high-speed, local-first AI development.
