# Gemini Local Hub

A stateful, multi-project orchestrator for the [Gemini CLI](https://geminicli.com). The Hub exposes a local HTTP API that manages concurrent Gemini sessions across any number of project directories — each identified by its folder path, each carrying its own conversation history and local memory.

Built on Next.js and the [`@google/gemini-cli-core`](https://www.npmjs.com/package/@google/gemini-cli-core) SDK.

---

## Mission Control

The root path (`/`) serves a split-pane **Hub Console** for monitoring and testing:

| Pane | Purpose |
|---|---|
| **Project List** (left sidebar) | Displays all registered folders from `trustedFolders.json` with live readiness status. Supports warm-up, session clearing, and unregistration inline. |
| **Chat Playground** (main area) | Select any registered project and send text or multi-image prompts directly. Useful for verifying session initialization, model responsiveness, and image stitching without `curl`. |

The console calls the same API endpoints documented below — it is a first-party consumer of the Hub's own surface.

---

## API Surface

All endpoints accept and return JSON. The `folderPath` parameter is resolved to an absolute path server-side.

### Operational — `/api/chat`

Session lifecycle and prompt execution for Gemini conversations.

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/chat/start` | Warm up a session for a folder. Runs the full Golden Copy initialization sequence (auth, memory injection, chat start). Idempotent. |
| `POST` | `/api/chat/prompt` | Send a text or multimodal prompt. Auto-initializes on first contact if no session exists. Multi-image payloads are stitched into a single composite PNG. |
| `GET` | `/api/chat/status` | Query parameter: `folderPath`. Returns `{ ready: boolean }` for the given folder's session. |
| `POST` | `/api/chat/clear` | Destroy the in-memory session. Next request triggers fresh initialization with a clean conversation. |

### Administrative — `/api/registry`

Folder trust governance and project lifecycle management.

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/registry/add` | Register a folder as trusted. Validates existence on disk before persisting to `trustedFolders.json`. |
| `GET` | `/api/registry/list` | Returns all trusted folders with their current in-memory readiness status. |
| `POST` | `/api/registry/unregister` | Remove a folder from the trust list and purge its in-memory session. Disk removal is atomic; memory purge is best-effort. |

### Diagnostics

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/health` | Returns `{ status: "ok", uptime: <seconds> }`. No auth required. |

---

## Local Memory

The Hub supports per-project system instructions via a **`GEMINI.md`** file placed at the root of any project directory.

During the Golden Copy initialization sequence (`lib/registry.ts`), the Hub reads the target folder's `GEMINI.md` and injects its full contents as the model's system instruction via `config.setUserMemory()`. This gives every session a persistent, project-scoped context that survives across prompts.

```
my-project/
├── GEMINI.md    ← System instruction: "You are a senior engineer working on..."
├── src/
└── package.json
```

**Behavior:**

- **Present**: Full text is loaded at session init. The model operates within the constraints defined in the file.
- **Absent**: Session initializes without project-specific context. A warning is logged.
- **Reload**: `GEMINI.md` is read once at init. To pick up changes, call `/api/chat/clear` and send a new prompt.

---

## Folder Trust & Governance

The Hub enforces a **Verify Before Trust** policy (see ADR-004). Every folder must pass an `existsSync` check before it is persisted to the trust registry. This prevents phantom paths from polluting the system.

**Storage format** (`~/.gemini/trustedFolders.json`):

```json
{
  "/Users/you/project-a": "TRUST_FOLDER",
  "/Users/you/project-b": "TRUST_FOLDER"
}
```

The on-disk schema is an **Object Key-Value map** — `Record<string, "TRUST_FOLDER">`. If the file contains the legacy array format (`{ folders: string[] }`), `lib/folders.ts` performs a self-healing migration on first read and writes the corrected map back to disk.

---

## Client Integration Guide

Use the Hub as a backend from any TypeScript or JavaScript project. The following `askHub` utility wraps `/api/chat/prompt` into a single async call:

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

**Usage:**

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

**Session lifecycle helpers:**

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

## Getting Started

### Prerequisites

| Requirement | Version | Notes |
|---|---|---|
| **Node.js** | >= 18.17.0 | LTS recommended |
| **Gemini CLI** | Latest | [Installation guide](https://geminicli.com/docs/get-started/installation/) |
| **Google Account** | — | For the OAuth handshake |

### 1. Authenticate with Google

Run the login command to cache your OAuth credentials locally:

```bash
gemini login
```

See: [Gemini CLI Authentication](https://geminicli.com/docs/get-started/authentication/)

### 2. Authorize the Hub Directory

The Gemini CLI requires explicit trust for every folder it reads:

```bash
cd /path/to/gemini-local
gemini "hello"
```

When prompted — *"Do you trust this folder?"* — select **Yes**. This writes the path to `~/.gemini/trustedFolders.json`.

### 3. Install & Launch

```bash
npm install
npm run dev
```

The Hub is now running at [http://localhost:3000](http://localhost:3000).

---

## Architecture

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
- **Lazy initialization**: Sessions are created on first request and cached for the process lifetime.
- **Concurrency-safe**: A per-key promise lock prevents duplicate initialization when parallel requests target the same folder.

### Authentication

The Hub leverages the Gemini CLI's **`oauth-personal`** flow. No API key required — the server calls `config.refreshAuth(AuthType.LOGIN_WITH_GOOGLE)` at session init, reusing the OAuth token cached by `gemini login`.

---

## Development & Testing

### Smoke Test

Validates the full lifecycle — health check, session warm-up, memory injection, ghost folder rejection, session clearing, and multi-image stitching.

```bash
# Terminal 1
npm run dev

# Terminal 2
npm run test:smoke
```

Override the Hub URL:

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

## Technical Context

| Document | Purpose |
|---|---|
| [`DECISIONS.md`](./DECISIONS.md) | Architecture Decision Records (ADRs). Covers the monorepo structure, client registry design, image stitching strategy, and folder trust governance lifecycle. |
| [`CHANGELOG.md`](./CHANGELOG.md) | Versioned record of features, migrations, and behavioral changes. Includes the trusted-folders schema migration and self-healing logic. |
| [`GEMINI.md`](./GEMINI.md) | Project context and system prompt rules. The canonical reference for coding patterns, constraints, and the AI agent's operating contract. |

---

## License

MIT
