# Gemini Local Hub

A stateful, multi-project orchestrator for the [Gemini CLI](https://geminicli.com). The Hub exposes a local HTTP API that manages concurrent Gemini sessions across any number of project directories — each identified by its folder path, each carrying its own conversation history and local memory.

Built on Next.js and the [`@google/gemini-cli-core`](https://www.npmjs.com/package/@google/gemini-cli-core) SDK.

---

## Why

Running `gemini` directly from the command line starts a fresh process every time. Each invocation pays the full cost: authentication, model initialization, memory loading, and session setup. That overhead adds up fast when you have scripts that call Gemini repeatedly — like a commit message generator that runs on every commit.

The Hub eliminates that cost by keeping **warm sessions** alive in memory:

- **Centralized state.** One long-lived process manages all your Gemini sessions. No per-invocation startup penalty.
- **Cross-project memory.** Each project gets its own session with its own `GEMINI.md` system instruction, but they all share a single authenticated process.
- **Faster execution.** Local scripts (like `scripts/commit.sh`) that pipe prompts through the Hub skip the 5–10 second cold-start entirely. The session is already warm — the prompt goes straight to the model.

---

## Connecting a Project

The recommended way to bootstrap any project into the Hub is the `examples/connect.sh` script. It performs a full handshake — health check, registration, and session warm-up — in a single command.

**From any project directory:**

```bash
bash /path/to/gemini-local/examples/connect.sh
```

Or copy it into your project and run it locally:

```bash
cp /path/to/gemini-local/examples/connect.sh ./connect.sh
chmod +x connect.sh
./connect.sh
```

**What it does:**

1. **Discovery** — Resolves the current directory to an absolute path.
2. **Health check** — Verifies the Hub is running at `$GEMINI_HUB_URL` (default: `http://localhost:3000`).
3. **Registration** — Calls `POST /api/chat/start` to register the folder and warm up its session.
4. **Validation** — Confirms the Hub accepted the project and is ready for prompts.

After `connect.sh` completes, the session is warm. Any subsequent call — whether from the Chat Playground, a `curl` command, or a script like `commit.sh` — hits the model immediately with zero initialization delay.

**Override the Hub URL:**

```bash
GEMINI_HUB_URL=http://localhost:4000 ./connect.sh
```

**Requirements:** `curl`, `jq`

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

Use the Hub as a backend from any TypeScript or JavaScript project.

### Bootstrapping

The fastest way to connect a new project is the `connect.sh` script described above. Run it once from the project root to register the folder and warm up its session. After that, you can call the Hub directly from code.

### The `askHub` Utility

The following utility wraps `/api/chat/prompt` into a single async call. It resolves `folderPath` to an absolute path before sending, ensuring correct behavior regardless of how the caller specifies the path.

```typescript
import path from "node:path";

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
  const resolvedPath = path.resolve(folderPath);

  const res = await fetch(`${HUB_URL}/chat/prompt`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ folderPath: resolvedPath, message, images }),
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
// Text-only prompt — relative paths are resolved automatically
const answer = await askHub(".", "Summarize this repo.");

// Absolute path works too
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

### 4. Connect Your First Project

From any project directory you want to work with:

```bash
bash /path/to/gemini-local/examples/connect.sh
```

The script registers the folder, warms up the session, and confirms readiness. You are now ready to send prompts.

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

### Warm Sessions & Script Performance

When the Hub is running, every registered project has a warm session ready to accept prompts. This is the key performance advantage over invoking `gemini` directly:

| Workflow | Cold (direct CLI) | Warm (via Hub) |
|---|---|---|
| `commit.sh` generates a message | ~5–10s startup + prompt | Prompt only (instant) |
| CI script analyzes a diff | New process per call | Reuses cached session |
| Multi-project batch job | N startups for N projects | All sessions pre-warmed |

Scripts like `scripts/commit.sh` pipe their prompt through the local Gemini CLI. By keeping the Hub running and sessions warm, any tooling that calls the Hub's API bypasses the initialization overhead entirely.

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
