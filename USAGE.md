# Gemini Local Hub — Developer usage

This guide is for developers who run the Hub on their machine and call it from scripts, tools, or the bundled UI.

## Prerequisites

- **Node.js** ≥ 18.17.0
- **Gemini CLI** installed and signed in (`gemini login`) so `@google/gemini-cli-core` can use your OAuth session
- Projects you touch must be **registered as trusted** (see registry endpoints below)

## Run the Hub

```bash
npm install
npm run dev
```

Default URL: **http://localhost:2999** (see `npm run dev` / `npm run start` in `package.json`).

## Core concepts

### Process warmth

Keep the dev server running and **warm sessions** for folders you automate often. **`POST /api/chat/start`** initializes the CLI session for a trusted folder so later **`POST /api/chat/prompt`** calls avoid repeated cold starts. The example script **`examples/connect.sh`** registers the current directory and calls `/api/chat/start`.

### YOLO mode (autonomous tools)

When **YOLO mode** is on, the prompt pipeline **executes tool calls on the server** and **resumes** the model with results instead of stopping for human approval.

- **Project default:** Read from the target project’s **`.gemini/settings.json`**: `security.disableYoloMode`. If that boolean is **`false`**, YOLO is **enabled**; if **`true`**, YOLO is **disabled** (manual approval path). If the file or flag is missing, YOLO defaults to **off**.
- **Runtime API:** **`GET /api/chat/config`** and **`PATCH /api/chat/config`** read/update `yoloMode` for a `folderPath` (and optional `sessionId`). Updates are **persisted** back into `.gemini/settings.json` as `security.disableYoloMode` (inverted relative to `yoloMode`).
- **Per-request override:** **`POST /api/chat/prompt`** accepts **`yoloMode: true`** in the JSON body to force autonomous execution for that request even when the session default would pause for approval.

**Buffered JSON vs streaming:** If you post a prompt **without** streaming and the model issues a **tool call** while YOLO is off, the Hub responds with **HTTP 409** and a payload indicating tool approval is required—this is the conflict you avoid by enabling YOLO or by using **streaming** (see below) so the client can handle `TOOL_USE` and call **`POST /api/chat/tool`**.

### Ephemeral sessions and `sessionId`

- **`ephemeral: true`** (on **`POST /api/chat/prompt`**): Before the prompt runs, the Hub **clears** that session’s **conversation history** and resets the underlying CLI chat. Use this for **background or one-shot tasks** (e.g. **`examples/commit.sh`**, **`examples/sync-logs.sh`**) so automation does not accumulate context in the main thread.
- **`sessionId`** (optional string): Selects a **separate session key** for the same `folderPath`, so parallel or isolated threads do not share history. Omit it to use the Hub’s default stable id for that folder.

Together, **`sessionId` + `ephemeral`** gives you **isolated, stateless-feeling** calls while still reusing the **warm client** for the project.

## API routes (summary)

All chat/registry routes that take a project expect an absolute **`folderPath`** (resolved server-side). Untrusted paths receive **403**.

| Method | Path | Role |
|--------|------|------|
| `GET` | `/api/health` | Liveness: `{ status, uptime }`. |
| `GET` | `/api/models` | JSON array of selectable model id strings for the UI. |
| `POST` | `/api/registry/add` | Body: `{ folderPath }`. Trust a directory (must exist on disk). |
| `GET` | `/api/registry/list` | Trusted folders and basic readiness flags. |
| `POST` | `/api/registry/unregister` | Body: `{ folderPath }`. Remove trust and clear in-memory session. |
| `POST` | `/api/chat/start` | Body: `{ folderPath, sessionId?, model? }`. Explicit warm-up / init. |
| `GET` | `/api/chat/status` | Query: `folderPath`. Session readiness and model info. |
| `POST` | `/api/chat/clear` | Body: `{ folderPath, sessionId? }`. Clear session/history. |
| `GET` | `/api/chat/config` | Query: `folderPath`, optional `sessionId`. Returns `{ yoloMode }`. |
| `PATCH` | `/api/chat/config` | Body: `{ folderPath, sessionId?, yoloMode }`. Toggle YOLO; persists to project config. |
| `POST` | `/api/chat/model` | Body: `{ folderPath, sessionId?, model }`. Switch model for the session. |
| `POST` | `/api/chat/prompt` | Primary **chat** endpoint (text, optional images, streaming or buffered JSON). |
| `POST` | `/api/chat/tool` | Body: tool call(s), `approved`, `folderPath`, optional `sessionId`, optional streaming. Continues after manual approval or fulfills tool execution in the streaming loop. |
| `GET` | `/api/test/registry` | Internal sanity check for the registry (development). |

### `POST /api/chat/prompt` (primary)

**Body (JSON):**

| Field | Type | Notes |
|-------|------|--------|
| `folderPath` | string | **Required.** Absolute path to a **trusted** project. |
| `message` | string | Text prompt; required unless `images` is non-empty. |
| `images` | array | Optional. `{ data: base64, mimeType }` entries; multiple images are stitched server-side when needed. |
| `sessionId` | string | Optional. Isolate history from the default session for that folder. |
| `model` | string | Optional. Model for this session (see `/api/models`). |
| `ephemeral` | boolean | If `true`, clear history before this turn. |
| `stream` | boolean | If `true`, use the streaming response (NDJSON, see below). |
| `yoloMode` | boolean | If `true`, force autonomous tool execution for this request. |

**Streaming:** Send **`stream: true`** **or** header **`Accept: text/event-stream`**. The response is a **long-lived HTTP body** with **`Content-Type: application/x-ndjson`**: each line is one JSON object (event). Typical event types include `INIT`, `MESSAGE`, `THOUGHT`, `TOOL_USE`, `RESULT`, and `ERROR`. This is **newline-delimited JSON** (NDJSON), not the `data:`-framed **`text/event-stream`** wire format of standard **Server-Sent Events (SSE)**—but it is the same class of **server-push streaming** clients often associate with SSE. Prefer consuming it as **one JSON object per line**.

**Non-streaming:** Omit streaming flags; the Hub returns a single JSON object with **`response`** and **`model`** when the turn completes without requiring tool approval—or **409** if a tool needs approval (enable YOLO, streaming, or use `/api/chat/tool`).

### `POST /api/chat/tool`

Used to **approve or reject** tool execution from the UI, or to continue after streamed `TOOL_USE` events. Accepts **`toolCall`** or **`toolCalls`**, **`approved`**, **`folderPath`**, optional **`sessionId`**, and the same **streaming** switch as prompt (`stream: true` or `Accept: text/event-stream`) for NDJSON streaming.

## UI (brief)

The Hub includes a chat playground: **thought** streams, **tool approval** vs **YOLO**, **model switching**, **stop/retry**, and **multi-image** drag-and-drop (stitching + prompt hints handled server-side). Keyboard: **Enter** send, **Shift+Enter** newline, **Cmd/Ctrl+K** clear chat UI.

## Example CLI integration (`examples/`)

| Script | Uses |
|--------|------|
| **`connect.sh`** | `/api/health` → `/api/registry/add` → `/api/chat/start` |
| **`commit.sh`** | `/api/chat/prompt` with **`ephemeral: true`** (buffered JSON) |
| **`sync-logs.sh`** | `/api/chat/prompt` with **`ephemeral: true`** |
| **`tag-release.sh`** | `/api/chat/prompt` with **`ephemeral: true`** |

Copy or adapt these patterns for your own automation; they assume the Hub is already running and that the project path has been trusted.
