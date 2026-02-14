# Gemini Local Hub

A stateful, multi-project orchestrator for the [Gemini CLI](https://geminicli.com). The Hub exposes a local HTTP API that manages concurrent Gemini sessions across any number of project directories — each identified by its folder path, each carrying its own conversation history and local memory.

Built on Next.js and the [`@google/gemini-cli-core`](https://www.npmjs.com/package/@google/gemini-cli-core) SDK.

---

## Architectural Overview

### The Folder-as-Key Registry

The Hub's core abstraction is the **ClientRegistry** (`lib/registry.ts`), a global singleton that maps each project directory to a fully initialized `GeminiClient` session.

```
┌──────────────────────────────────────────────────┐
│                  ClientRegistry                  │
│                                                  │
│  "/Users/you/project-a:ab3f01c2" → Session A     │
│  "/Users/you/project-b:7e9d44a1" → Session B     │
│  "/Users/you/project-c:c1f8e003" → Session C     │
│                                                  │
│  Key = resolved folder path + stable hash        │
│  Value = { GeminiClient, Config, initialized }   │
└──────────────────────────────────────────────────┘
```

- **Stable identity**: Each folder path is hashed via `scrypt` to produce a deterministic session ID.
- **Lazy initialization**: Sessions are created on first request and cached for the lifetime of the server process.
- **Concurrency-safe**: A per-key promise lock prevents duplicate initialization when parallel requests arrive for the same folder.

### Authentication

The Hub leverages the Gemini CLI's **`oauth-personal`** authentication flow. There is no API key to manage — the server calls `config.refreshAuth(AuthType.LOGIN_WITH_GOOGLE)` at session init, reusing the OAuth token cached by `gemini login`.

---

## Prerequisites

| Requirement | Version | Notes |
|---|---|---|
| **Node.js** | >= 18.17.0 | LTS recommended |
| **Gemini CLI** | Latest | [Installation guide](https://geminicli.com/docs/get-started/installation/) |
| **Google Account** | — | For the OAuth handshake |

---

## Getting Started

### 1. Install the Gemini CLI

If you haven't already, install the CLI globally:

```bash
npm install -g @google/gemini-cli
```

### 2. Authenticate with Google

Run the login command to perform the OAuth handshake. This caches your credentials locally so the Hub can reuse them:

```bash
gemini login
```

See: [Gemini CLI Authentication](https://geminicli.com/docs/get-started/authentication/)

### 3. Authorize the Project Directory

The Gemini CLI requires explicit trust for every folder it reads. To authorize the Hub's root directory:

```bash
cd /path/to/gemini-local
gemini "hello"
```

When prompted — *"Do you trust this folder and allow Gemini to read its contents?"* — select **Yes**.

> This adds the path to `~/.gemini/trustedFolders.json`. You only need to do this once per directory.

### 4. Install Dependencies

```bash
npm install
```

### 5. Launch the Hub

```bash
npm run dev
```

The Hub is now running at [http://localhost:3000](http://localhost:3000).

---

## API Documentation

All endpoints are served under `/api/chat/`. The Hub automatically initializes sessions on first contact — you can call `/prompt` directly without calling `/start` first.

### `POST /api/chat/start`

Explicitly warm up a session for a given project folder. Useful for pre-loading before the user sends their first prompt.

**Request Body**

| Field | Type | Required | Description |
|---|---|---|---|
| `folderPath` | `string` | Yes | Absolute or relative path to the project directory. |
| `sessionId` | `string` | No | Custom session identifier. Defaults to a stable hash of the folder path. |

**Example**

```bash
curl -X POST http://localhost:3000/api/chat/start \
  -H "Content-Type: application/json" \
  -d '{"folderPath": "/Users/you/my-project"}'
```

**Response**

```json
{ "status": "ready", "folderPath": "/Users/you/my-project" }
```

---

### `POST /api/chat/prompt`

Send a text or multimodal prompt to the model within a project session. Handles **multi-image stitching automatically** — when multiple images are attached, the Hub composites them into a single horizontally-stitched image via Sharp before sending to the model.

**Request Body**

| Field | Type | Required | Description |
|---|---|---|---|
| `folderPath` | `string` | Yes | Absolute or relative path to the project directory. |
| `sessionId` | `string` | No | Custom session identifier. |
| `message` | `string` | Conditional | The text prompt. Required if `images` is not provided. |
| `images` | `ImagePayload[]` | Conditional | Array of image objects. Required if `message` is not provided. |

**`ImagePayload` Schema**

| Field | Type | Description |
|---|---|---|
| `data` | `string` | Base64-encoded image data. |
| `mimeType` | `string` | MIME type (e.g. `image/png`, `image/jpeg`). |

**Example — Text Only**

```bash
curl -X POST http://localhost:3000/api/chat/prompt \
  -H "Content-Type: application/json" \
  -d '{"folderPath": "/Users/you/my-project", "message": "Explain this codebase."}'
```

**Example — With Images**

```bash
curl -X POST http://localhost:3000/api/chat/prompt \
  -H "Content-Type: application/json" \
  -d '{
    "folderPath": "/Users/you/my-project",
    "message": "What do these screenshots show?",
    "images": [
      { "data": "<base64>", "mimeType": "image/png" },
      { "data": "<base64>", "mimeType": "image/png" }
    ]
  }'
```

**Response**

```json
{ "response": "The model's response text..." }
```

> When multiple images are provided, they are stitched left-to-right into a single composite PNG. The model receives a system annotation describing the layout.

---

### `GET /api/chat/status`

Check whether a session for a given folder is initialized and ready.

**Query Parameters**

| Param | Type | Required | Description |
|---|---|---|---|
| `folderPath` | `string` | Yes | Absolute or relative path to the project directory. |

**Example**

```bash
curl "http://localhost:3000/api/chat/status?folderPath=/Users/you/my-project"
```

**Response**

```json
{ "folderPath": "/Users/you/my-project", "ready": true }
```

---

### `POST /api/chat/clear`

Destroy a session and wipe its conversation history. The next request to that folder will trigger a fresh initialization.

**Request Body**

| Field | Type | Required | Description |
|---|---|---|---|
| `folderPath` | `string` | Yes | Absolute or relative path to the project directory. |
| `sessionId` | `string` | No | Custom session identifier. |

**Example**

```bash
curl -X POST http://localhost:3000/api/chat/clear \
  -H "Content-Type: application/json" \
  -d '{"folderPath": "/Users/you/my-project"}'
```

**Response**

```json
{ "success": true, "message": "Session history cleared" }
```

---

## Client Integration Guide

Use the Hub as a backend from any TypeScript or JavaScript project. The following `askHub` utility wraps the `/api/chat/prompt` endpoint into a single async call:

```typescript
const HUB_URL = process.env.HUB_URL ?? "http://localhost:3000/api";

interface ImagePayload {
  data: string;      // base64-encoded image
  mimeType: string;  // e.g. "image/png"
}

interface HubResponse {
  response?: string;
  error?: string;
  details?: string;
}

async function askHub(
  folderPath: string,
  message: string,
  images?: ImagePayload[],
): Promise<string> {
  const res = await fetch(`${HUB_URL}/chat/prompt`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ folderPath, message, images }),
  });

  const data: HubResponse = await res.json();

  if (!res.ok) {
    throw new Error(data.details ?? data.error ?? `Hub returned ${res.status}`);
  }

  return data.response!;
}
```

**Usage**

```typescript
// Text-only prompt
const answer = await askHub("/Users/you/my-project", "Summarize this repo.");

// Multimodal prompt — the Hub stitches multiple images automatically
const analysis = await askHub(
  "/Users/you/my-project",
  "Compare these two screenshots.",
  [
    { data: screenshotA, mimeType: "image/png" },
    { data: screenshotB, mimeType: "image/png" },
  ],
);
```

**Session lifecycle helpers**

```typescript
// Warm up a session before the first prompt
await fetch(`${HUB_URL}/chat/start`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ folderPath: "/Users/you/my-project" }),
});

// Check readiness
const status = await fetch(
  `${HUB_URL}/chat/status?folderPath=/Users/you/my-project`,
).then(r => r.json());
console.log(status.ready); // true | false

// Reset conversation history
await fetch(`${HUB_URL}/chat/clear`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ folderPath: "/Users/you/my-project" }),
});
```

---

## Local Memory

The Hub supports per-project system instructions via a **`GEMINI.md`** file.

Place a `GEMINI.md` file in the root of any project directory. When the Hub initializes a session for that folder, it reads the file and injects its contents as the model's system instruction.

```
my-project/
├── GEMINI.md    ← "You are a senior engineer working on..."
├── src/
└── package.json
```

- If `GEMINI.md` is present, its full text is loaded via `config.setUserMemory()`.
- If `GEMINI.md` is absent, the session initializes without project-specific context (a warning is logged).
- The file is read once at session init. To reload, call `/api/chat/clear` and send a new prompt.

---

## Development & Testing

### Smoke Test

The Hub ships with an integration smoke test that validates the full lifecycle — health check, session warm-up, memory injection, ghost folder rejection, session clearing, and multi-image stitching.

**1. Start the Hub in one terminal:**

```bash
npm run dev
```

**2. Run the smoke test in another terminal:**

```bash
npm run test:smoke
```

Or directly:

```bash
./scripts/smoke-test.sh
```

The script creates a temporary sandbox directory with its own `GEMINI.md`, exercises all four API endpoints, and cleans up on exit. Override the Hub URL with the `HUB_URL` environment variable:

```bash
HUB_URL=http://localhost:4000/api npm run test:smoke
```

### Integration Test

```bash
npm run test:integration
```

### Linting

```bash
npm run lint
```

---

## License

MIT
