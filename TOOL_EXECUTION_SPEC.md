# Tool Execution State Machine — Implementation Spec

This spec establishes the Tool Execution state machine with manual UI approval and automated YOLO mode. It aligns with GEMINI.md (interfaces, Tailwind, no trailing whitespace, single newline EOF) and DECISIONS.md ADRs.

---

## 1. Session Configuration (`lib/registry.ts`)

### 1.1 Interface

- Extend `ProjectSession` with `yoloMode: boolean`.
- No other existing fields changed.

### 1.2 Config File Read in `createSession`

- **Location:** Session creation happens in `ClientRegistry.getSession` (there is no separate `createSession`; the session object is created when missing). Apply config read at the point where a new session is instantiated (the block that creates `session = { client, config, ... }`).
- **Config path:** Resolve `folderPath` and read `join(normalizedPath, '.gemini', 'settings.json')`. Use `existsSync` before `readFileSync`; handle parse errors (e.g. invalid JSON) by falling back to default.
- **Parsing:** Parse JSON and read `security?.disableYoloMode`. If the key is present and boolean: `yoloMode = !security.disableYoloMode`. If file missing, parse error, or key absent: default `yoloMode` to `false`.
- **Persistence:** Store `yoloMode` on the new session object only at creation time. Do not re-read the file on every request.

### 1.3 Toggle Method

- Add a method on `ClientRegistry`: e.g. `setYoloMode(folderPath: string, value: boolean, sessionId?: string): Promise<void>`.
- Resolve session by `folderPath` and optional `sessionId` (reuse existing key generation). If session exists, set `session.yoloMode = value`; no need to persist back to `.gemini/settings.json` (runtime-only toggle).

---

## 2. API Route Tool Interception (`app/api/chat/prompt/route.ts`)

### 2.1 Interception Point

- The stream is the `for await (const event of stream)` over `session.client.prompt(...)`. Events are already in the public `JsonStreamEvent` shape (e.g. `JsonStreamEventType.TOOL_USE`). Treat `event.type === JsonStreamEventType.TOOL_USE` as the “tool call request” for interception.

### 2.2 Branch on `session.yoloMode`

- **When `yoloMode === false` (manual approval):**
  - Emit the tool event to the client: send one NDJSON line with `type: 'TOOL_USE'` and the same payload fields as today (`tool_name`, `parameters`). Include `tool_id` if present on the event so the frontend can reference it for Approve/Reject.
  - Then terminate the stream gracefully: close the stream (stop consuming further events from `session.client.prompt` and close the `ReadableStream` controller) so the agent pauses until the UI sends an approval (future phase). Do not execute the tool in this path.
- **When `yoloMode === true` (YOLO / auto-execute):**
  - Do not emit `TOOL_USE` to the frontend for approval.
  - Stub: log `[Agent] Auto-executing tool: ${event.toolName}` (use the same property name as the stream event, e.g. `tool_name`). Actual tool execution integration is deferred to the next phase.

### 2.3 Buffered (Non-Streaming) Path

- The route has a non-streaming branch that consumes the same iterator. Apply the same rule: on first `TOOL_USE`, if `yoloMode === false`, treat as “needs approval” (e.g. return a structured error or 4xx indicating tool approval required, or document that streaming is required for tool flows). If `yoloMode === true`, stub with the same log and continue (no execution yet).

### 2.4 Event Payload

- Ensure the payload sent for `TOOL_USE` includes at least: `type`, `tool_name`, `parameters`, and `tool_id` when available (from registry’s `serverEventToJsonStreamEvents`), so the frontend can show and later resolve approval by `tool_id`.

---

## 3. Frontend State & Permissions (`app/page.tsx` and related)

### 3.1 State Variables

- **pendingToolCall:** State holding the last tool-call request that awaits user action. Type: match the stream event structure: `{ type: 'TOOL_USE'; tool_name: string; parameters: Record<string, unknown>; tool_id?: string } | null`. Set to `null` when there is no pending request.
- **yoloMode:** Boolean reflecting the session’s YOLO mode. Default `false`. Must stay in sync with the backend session (see config API below).

### 3.2 Stream Handling

- In the same place where the stream is parsed (e.g. in `lib/hub-state.ts` inside `sendMessage`, where `event.type === 'TOOL_USE'` is handled): when `event.type === 'TOOL_USE'`, set `pendingToolCall` to the event object (type, tool_name, parameters, tool_id). Do not use it only for “thinking” label; the stream will stop after this event in manual mode, so the UI must show the approval card.

### 3.3 “Action Required” UI

- When `pendingToolCall` is non-null, render a distinct component (e.g. an “Action Required” card) that shows:
  - Tool name: `pendingToolCall.tool_name`
  - Arguments: `pendingToolCall.parameters` (formatted for readability, e.g. JSON or key-value list).
- Actions:
  - **Approve:** Button that will later trigger a request to execute the tool (next phase). For now, can clear `pendingToolCall` and optionally show a “Approved; execution not yet implemented” message.
  - **Reject:** Button that clears `pendingToolCall` and optionally appends a short assistant or system message that the user rejected the tool call.

### 3.4 YOLO Toggle and Config API

- **UI:** Add a YOLO mode toggle (e.g. switch) in the header (e.g. in `app/page.tsx` or a header component). Toggle state must reflect `yoloMode` from state.
- **Sync with backend:** Introduce a session config API used by the frontend to get and set YOLO mode:
  - **GET (or POST with body)** `/api/chat/config`: Request must include `folderPath` and optionally `sessionId`. Response: `{ yoloMode: boolean }` from the session’s `yoloMode` (from registry). If no session exists, return default `{ yoloMode: false }` or 404.
  - **PATCH or POST** `/api/chat/config`: Body: `{ folderPath: string; sessionId?: string; yoloMode: boolean }`. Call registry’s `setYoloMode(folderPath, yoloMode, sessionId)`. Return success/error.
- On load (e.g. when `activeFolder` is set), fetch config and set `yoloMode`. When the user flips the toggle, call the update endpoint then update local state.

### 3.5 State Lifting

- `pendingToolCall` and `yoloMode` may live in `lib/hub-state.ts` (e.g. in `useChat` or a dedicated hook) so that both the header (toggle) and the chat area (approval card) can access them. Pass `yoloMode`, `pendingToolCall`, and handlers (e.g. onApprove, onReject, onYoloChange) via props or context as needed from `app/page.tsx` to the header and to the chat/tool-approval component.

---

## 4. Constraints (Recap)

- No trailing whitespace; files end with a single newline (per GEMINI.md).
- Use interfaces for data structures; Tailwind utility classes only.
- Do not commit or push; stage and hand off to `./scripts/commit.sh` (per GEMINI.md).
- This spec is implementation- and logic-focused only; no full code blocks—intended for use with local code-generation tools.

---

## 5. ADR Suggestion (Optional)

Consider adding **ADR-007: Tool Execution State Machine and YOLO Mode** to DECISIONS.md: decision to support two modes (manual approval vs YOLO) driven by project-local `.gemini/settings.json` and a runtime toggle, with tool execution interception in the prompt stream and a dedicated config API for session settings.
