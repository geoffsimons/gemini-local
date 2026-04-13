# Gemini Local Project Context & Rules

## Core Objective

Build a robust, local-first HTTP bridge for the Google Gemini CLI. The system is a monolithic Next.js application that serves two purposes:

1. **API Layer:** Wraps the local Gemini CLI (via `@google/gemini-cli-core`) to provide a persistent, stateful HTTP interface.
2. **UI Layer:** A modern chat interface for interacting with the model.

## Tech Stack

- **Framework:** Next.js (App Router).
- **Language:** TypeScript (Strict Mode).
- **Styling:** Tailwind CSS (v4) with `clsx` and `tailwind-merge`.
- **Core Libraries:**
  - `@google/gemini-cli-core`: Interacting with the Gemini model and tool registry.
  - `sharp`: Server-side image processing (stitching/resizing).
  - `lucide-react`: UI icons.

## Architectural Patterns

### 1. State Management: Global Singleton

Next.js in development mode hot-reloads frequently, so the app cannot instantiate a new Gemini client (or session container) on every request.

- **Pattern:** Use the Global Singleton pattern so that the Gemini session (or the registry that holds sessions) survives across API calls. At runtime, check a global (e.g. `globalThis`) before creating a new instance.
- **Why:** The CLI process stays alive and retains conversational memory across requests. This aligns with ADR-001 (Singleton required for CLI persistence) and ADR-002 (centralized registry keyed by project directory).

### 2. Agentic Loop: Asynchronous Streaming Pipeline

The chat API uses an asynchronous streaming pipeline to support multi-turn tool use.

- **Mechanism:** A long-lived stream is consumed in a loop. The pipeline runs until a terminal condition (e.g. no more tool calls for this turn). Each iteration drains the stream, then either finishes the response or continues with tool execution and another round.
- **TOOL_USE interception:** When the stream emits tool-call events, the route collects them. If the session is in manual-approval mode, the stream is paused and the client receives the tool calls for approval. If the session is in YOLO mode, tools are executed server-side and the loop continues by sending function responses back into the model and starting a new stream. This implements the Tool Execution state machine (ADR-007).

### 3. Tool Execution: Server-Side via SDK ToolRegistry

Tools are executed on the server using the native SDK’s tool registry.

- **Flow:** The session exposes the SDK config, which provides a `ToolRegistry`. Execution resolves the tool by name, builds the invocation from the given parameters, runs it with an abort signal, and returns content suitable for a function response back to the model. The same execution path is used for both YOLO (auto-execute in the prompt route) and manual approval (dedicated tool API).
- **No hardcoded paths:** The architecture is described by concepts (registry, session, config, ToolRegistry); file locations for dynamic logic are not specified here.

### 4. Multi-Modal Stitching (ADR-003)

The internal Gemini API has a limit of one image attachment per request. Multiple images are supported by stitching them into a single composite image server-side (e.g. with `sharp`). Output format is PNG to avoid JPEG artifacts. Do not downscale images unless they exceed the API payload limit; preserve high-fidelity text readability.

### 5. System Prompt Injection (Hallucination Mitigation)

If the prompt structure is strictly text-then-image, the model may refuse to analyze images. When an image is attached, the API route must inject a system hint into the text prompt (e.g. single image: user has attached a base64 image for analysis; multi-image: composite of N images stitched horizontally, treat as separate contexts left-to-right).

### 6. Folder Trust & Ephemeral Sessions (ADR-004, ADR-006)

Only requests for trusted project directories are allowed; trust is managed via a persistent registry and existence checks. The API supports an `ephemeral` flag and optional custom `sessionId` for one-off or automated flows that must not affect the main chat history.

## Development Guidelines

- **AI Agent Role:** Senior Full-Stack Engineer. Focus on robustness, type safety, and clean architecture. Follow the “why” in this file; do not invent new patterns for image handling or state management without checking project context first.
- **TypeScript:** Use interfaces for all data structures (e.g. messages, image payloads, history entries).
- **Tailwind:** Use utility classes; avoid custom CSS files where possible.
- **Whitespace:** No trailing whitespace. Files must end with a single newline.

## Hard Boundaries

- **Git:** You are **never** authorized to run `git commit` or `git push`. After creating or editing files: run `git add <files>` to stage changes, then **stop** and instruct the user to run `./scripts/commit.sh`. Do not generate a commit message; the script handles it.
- **Formatting:** No trailing whitespace. Single newline at end of file.

## ADR Alignment

Design and implementation must align with the Architecture Decision Records (see `DECISIONS.md`): Next.js monorepo and Singleton (ADR-001, ADR-002), server-side image stitching (ADR-003), folder trust (ADR-004), shell compatibility for scripts (ADR-005), ephemeral and custom session IDs (ADR-006), and the Tool Execution state machine with YOLO vs manual approval (ADR-007).
