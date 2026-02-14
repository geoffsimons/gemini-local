# Gemini Local Hub

A stateful, multi-project orchestrator for the [Gemini CLI](https://geminicli.com). The Hub exposes a local HTTP API that manages concurrent Gemini sessions across any number of project directories — each identified by its folder path, each carrying its own conversation history and local memory.

Built on Next.js and the [`@google/gemini-cli-core`](https://www.npmjs.com/package/@google/gemini-cli-core) SDK.

---

## Why

Running `gemini` directly from the command line starts a fresh process every time. Each invocation pays the full cost: authentication, model initialization, memory loading, and session setup. That overhead adds up fast when you have scripts that call Gemini repeatedly — like a commit message generator that runs on every commit.

The Hub eliminates that cost by keeping **warm sessions** alive in memory:

- **Centralized state.** One long-lived process manages all your Gemini sessions. No per-invocation startup penalty.
- **Cross-project memory.** Each project gets its own session with its own `GEMINI.md` system instruction, but they all share a single authenticated process.
- **Faster execution.** Local scripts (like `examples/commit.sh`) that pipe prompts through the Hub skip the 5-10 second cold-start entirely. The session is already warm — the prompt goes straight to the model.

---

## Getting Started

### Prerequisites

| Requirement | Version | Notes |
|---|---|---|
| **Node.js** | >= 18.17.0 | LTS recommended |
| **Gemini CLI** | Latest | [Installation guide](https://geminicli.com/docs/get-started/installation/) |
| **Google Account** | -- | For the OAuth handshake |

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

## Governance & Security

### Verify Before Trust

The Hub enforces a strict **Verify Before Trust** policy (ADR-004). No folder path is persisted to the trust registry unless the Hub has first confirmed its physical existence on disk via `fs.existsSync`. This is enforced at two layers:

1. **Administrative gate** (`POST /api/registry/add`): Rejects nonexistent directories with a `400` before `addTrustedFolder` is ever called.
2. **Operational gate** (`POST /api/chat/start`): Performs the same existence check before touching the trust list or spawning a session.

The result is a system that cannot accumulate "ghost trusts" — phantom paths from deleted or mistyped directories. The trust list (`~/.gemini/trustedFolders.json`) reflects only directories that were verified at registration time.

**Storage format** (`~/.gemini/trustedFolders.json`):

```json
{
  "/Users/you/project-a": "TRUST_FOLDER",
  "/Users/you/project-b": "TRUST_FOLDER"
}
```

The on-disk schema is an object map — `Record<string, "TRUST_FOLDER">`. If the file contains an older array format (`{ folders: string[] }`), `lib/folders.ts` performs a self-healing migration on first read and writes the corrected map back to disk.

### Folder-as-Key Session Registry

The Hub's core state primitive is the **ClientRegistry** (`lib/registry.ts`), a global singleton that maps each project directory to a fully initialized `GeminiClient` session. The registry key is a composite of the resolved absolute path and a deterministic hash derived via `scrypt`:

```
Key:   "/Users/you/project-a:ab3f01c2"
Value: { GeminiClient, Config, initialized: boolean }
```

This design enables **multi-turn conversations across separate HTTP requests**. A script can call `POST /api/chat/prompt` five times in sequence, and every call lands in the same session with full conversation history intact — because the folder path deterministically resolves to the same registry entry.

Three properties govern the registry's behavior:

- **Stable identity**: `scrypt(folderPath)` produces a deterministic session ID. The same folder always maps to the same session.
- **Lazy initialization**: Sessions are created on first request and cached for the process lifetime. The full Golden Copy sequence (auth, config, memory injection, chat start) runs once.
- **Concurrency safety**: A per-key promise lock (`pendingInits`) prevents duplicate initialization when parallel requests target the same folder before the first init completes.

The registry is declared on `globalThis` to survive Next.js Fast Refresh in development. In production, it lives for the lifetime of the Node.js process.

---

## The Hub Ecosystem

The `examples/` directory contains Bash/Zsh-compatible shell scripts that demonstrate the Hub's value as a developer automation backend. Each script is self-contained, portable, and designed to be copied into any project root.

All scripts share a common contract:
- Resolve `$(pwd -P)` as the project identity.
- Health-check the Hub before issuing requests.
- Communicate with the Hub exclusively through its HTTP API.

### `connect.sh` — Project Onboarding

The primary method for registering a new project with the Hub. Performs a full handshake in a single command.

**Usage (from any project directory):**

```bash
bash /path/to/gemini-local/examples/connect.sh
```

**Sequence:**

1. **Discovery** — Resolves the current directory to an absolute path.
2. **Health check** — Verifies the Hub is running at `$GEMINI_HUB_URL` (default: `http://localhost:3000`).
3. **Registration** — Calls `POST /api/chat/start` to register the folder, add it to the trust list, and warm up its session.
4. **Validation** — Confirms the Hub accepted the project and the session is ready.

After completion, the session is warm. Any subsequent call — from the Chat Playground, a `curl` command, or another script — hits the model with zero initialization delay.

**Override the Hub URL:**

```bash
GEMINI_HUB_URL=http://localhost:4000 ./connect.sh
```

**Requirements:** `curl`, `jq`

### `commit.sh` — Stateful Commit Generator

A high-speed, interactive Git commit message generator that uses the Hub to produce Conventional Commits from staged diffs.

**Usage:**

```bash
git add -p
bash /path/to/gemini-local/examples/commit.sh
```

**Behavior:**

1. Validates the Hub is running and that changes are staged (`git diff --cached`).
2. Sends the full staged diff to `POST /api/chat/prompt` with a structured prompt requesting Conventional Commits format.
3. Presents the proposed message with an interactive menu:
   - **(A)ccept** — Commits immediately with the generated message.
   - **(E)dit** — Opens the message in `$EDITOR` for manual refinement before committing.
   - **(R)etry** — Accepts a free-text hint and regenerates the message with additional context.
   - **(C)ancel** — Aborts without committing.

Because the script targets a warm Hub session, the round-trip from diff to proposed message is typically under two seconds. The session's conversation history means retries with hints benefit from the model's memory of the previous attempt.

### `sync-logs.sh` — Automated Changelog & ADR Updates

A context-aware documentation sync tool that analyzes recent Git history and generates incremental updates for `CHANGELOG.md` and `DECISIONS.md`.

**Usage:**

```bash
bash /path/to/gemini-local/examples/sync-logs.sh
```

**Behavior:**

1. Gathers the last 15 commits via `git log`.
2. Reads the top 50 lines of `CHANGELOG.md` and the last 50 lines of `DECISIONS.md` as existing context.
3. Sends both to the Hub with strict deduplication rules: the model must compare history against existing content and only emit genuinely new entries.
4. Parses the model's structured output (`<<<FILE:...>>>` blocks) and surgically inserts new content:
   - **CHANGELOG.md**: New entries are inserted above the first existing `##` heading.
   - **DECISIONS.md**: New ADR entries are appended, with numbering continuing from the last existing record.
5. Writes updates to disk and instructs the user to review via `git diff`.

The script prevents documentation drift by anchoring every update to the actual commit record, while the deduplication prompt ensures idempotent runs.

---

## Mission Control

The root path (`/`) serves a split-pane **Hub Console** — the central observability tool for monitoring session state and manually testing multimodal prompts.

| Pane | Purpose |
|---|---|
| **Project List** (left sidebar) | Displays all registered folders from `trustedFolders.json` with live readiness indicators: **Ready** (session initialized, accepting prompts) or **Cold** (registered but not yet warmed). Supports inline actions: warm-up, session clearing, and unregistration. |
| **Chat Playground** (main area) | Select any registered project and send text or multi-image prompts directly. Supports drag-and-drop image attachments with live preview. Useful for verifying session initialization, model responsiveness, and image stitching behavior without `curl`. |

The console is a first-party consumer of the Hub's own API surface — every action maps directly to the endpoints documented below. What works in the console works identically from `curl` or a script.

---

## API Reference

All endpoints accept and return JSON. The `folderPath` parameter is resolved to an absolute path server-side.

### Operational — `/api/chat`

Session lifecycle and prompt execution for Gemini conversations.

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/chat/start` | Warm up a session for a folder. Runs the full Golden Copy initialization sequence (auth, memory injection, chat start). Validates folder existence, adds to trust registry, then initializes. Idempotent. |
| `POST` | `/api/chat/prompt` | Send a text or multimodal prompt. Auto-initializes on first contact if no warm session exists. Multi-image payloads are stitched into a single composite PNG server-side. |
| `GET` | `/api/chat/status` | Query parameter: `folderPath`. Returns `{ ready: boolean }` indicating whether the folder has an initialized in-memory session. |
| `POST` | `/api/chat/clear` | Destroy the in-memory session for a folder. The next request triggers fresh initialization with a clean conversation history. |

### Administrative — `/api/registry`

Folder trust governance and project lifecycle management.

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/registry/add` | Register a folder as trusted. Validates physical existence on disk before persisting to `trustedFolders.json`. Returns `400` for nonexistent paths. |
| `GET` | `/api/registry/list` | Returns all trusted folders with their current in-memory readiness status (`isReady: boolean`). |
| `POST` | `/api/registry/unregister` | Remove a folder from the trust list and purge its in-memory session. Disk removal is atomic; memory purge is best-effort. |

### Diagnostics

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/health` | Returns `{ status: "ok", uptime: <seconds> }`. No auth required. |

---

## Technical Architecture

### Horizontal Image Stitching

The Gemini API exhibits inconsistent behavior when handling multiple independent image attachments. The Hub normalizes multi-image inputs into a single composite via server-side stitching (`lib/images.ts`), using `sharp`:

1. **Normalization** — Each input buffer is re-encoded through `sharp` to strip corrupt metadata and normalize orientation.
2. **Canvas calculation** — Total width is the sum of all image widths; height is the maximum.
3. **Composition** — Images are placed left-to-right on a transparent RGBA canvas.
4. **Output** — The composite is rendered as **PNG** (never JPEG — compression artifacts degrade text readability and confuse the model).

When a multi-image payload arrives at `POST /api/chat/prompt`, the stitched composite replaces the individual attachments. A system hint is injected into the text prompt so the model knows to interpret the composite as N separate visual contexts ordered left-to-right:

```
[System: User has attached a base64 encoded image that is a composite
of 3 images stitched horizontally. Treat them as separate visual
contexts ordered left-to-right.]
```

Single-image payloads pass through unmodified with their own system hint.

### GEMINI.md — Per-Project Memory

The Hub supports per-project system instructions via a `GEMINI.md` file placed at the root of any connected project directory.

During the Golden Copy initialization sequence (`lib/registry.ts`), the Hub reads the target folder's `GEMINI.md` and injects its full contents as the model's system instruction via `config.setUserMemory()`. This gives every session a persistent, project-scoped architectural context that survives across prompts within that session.

```
my-project/
├── GEMINI.md    <- Defines coding patterns, constraints, agent role
├── src/
└── package.json
```

| State | Behavior |
|---|---|
| **Present** | Full text loaded at session init. The model operates within the constraints defined in the file. |
| **Absent** | Session initializes without project-specific context. A warning is logged. |
| **Modified** | `GEMINI.md` is read once at init. To pick up changes, call `POST /api/chat/clear` and send a new prompt to trigger reinitialization. |

This is the mechanism that allows scripts like `commit.sh` to produce project-aware output — the model already knows the codebase's conventions, tech stack, and architectural intent before the first prompt arrives.

### Warm Sessions & Performance

When the Hub is running, every registered project has a warm session ready to accept prompts. This is the key performance advantage over invoking `gemini` directly:

| Workflow | Cold (direct CLI) | Warm (via Hub) |
|---|---|---|
| `commit.sh` generates a message | ~5-10s startup + prompt | Prompt only (sub-second) |
| CI script analyzes a diff | New process per call | Reuses cached session |
| Multi-project batch job | N startups for N projects | All sessions pre-warmed |

### Authentication

The Hub leverages the Gemini CLI's **`oauth-personal`** flow. No API key required — the server calls `config.refreshAuth(AuthType.LOGIN_WITH_GOOGLE)` at session init, reusing the OAuth token cached by `gemini login`.

---

## Client Integration Guide

Use the Hub as a backend from any TypeScript or JavaScript project.

### The `askHub` Utility

The following utility wraps `POST /api/chat/prompt` into a single async call:

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
// Text-only prompt
const answer = await askHub(".", "Summarize this repo.");

// Multimodal prompt with image stitching
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
| [`DECISIONS.md`](./DECISIONS.md) | Architecture Decision Records (ADRs). Covers the monorepo structure, client registry design, image stitching strategy, folder trust governance, and shell compatibility. |
| [`CHANGELOG.md`](./CHANGELOG.md) | Versioned record of features, migrations, and behavioral changes. |
| [`GEMINI.md`](./GEMINI.md) | Project context and system prompt rules. The canonical reference for coding patterns, constraints, and the AI agent's operating contract. |

---

## License

MIT
