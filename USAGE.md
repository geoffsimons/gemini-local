# USAGE: Developer Manual

This guide covers the installation, API specifications, and ecosystem tools for interacting with the Gemini Local Hub.

## 1. Installation & Setup

### Prerequisites
- **Node.js**: >= 18.17.0
- **Gemini CLI**: Installed and authenticated (`gemini login`).
- **Google Account**: Required for the underlying OAuth handshake.

### Launching the Hub
```bash
npm install
npm run dev
```
The Hub Console will be available at `http://localhost:3000`.

## 2. API Specification

All endpoints communicate via JSON. The `folderPath` parameter must be an absolute path (though the server resolves relative paths against its own CWD).

### Prompt Execution: `POST /api/chat/prompt`
The primary interface for sending text and images to a project session.

| Field | Type | Description |
|---|---|---|
| `folderPath` | `string` | **Required**. The absolute path to the project directory. |
| `message` | `string` | The text prompt. Required if no images are provided. |
| `images` | `array` | Optional. List of `{ data: string (base64), mimeType: string }`. |
| `ephemeral` | `boolean` | Optional. If `true`, resets history before this prompt (Isolation Mode). |
| `sessionId` | `string` | Optional. Overrides the default deterministic session ID. |

### Registry Management: `POST /api/registry/add`
Registers a folder as a "Trusted Project".

| Field | Type | Description |
|---|---|---|
| `folderPath` | `string` | **Required**. Path to the directory. Must exist on disk. |

## 3. Ecosystem Tools (`examples/`)

The Hub includes a suite of portable shell scripts designed to be used from within any project root.

- **`connect.sh`**: The onboarding utility. Run this from your project root to register it with the Hub and warm up the session.
- **`commit.sh`**: A high-speed Conventional Commit generator. It pipes your staged `git diff` to the Hub and produces a structured commit message in seconds. Uses the `ephemeral` flag to ensure the commit task doesn't pollute your main chat history.
- **`sync-logs.sh`**: Documentation automation. Analyzes your last 15 commits and surgically updates `CHANGELOG.md` and `DECISIONS.md` without duplicating existing entries.

## 4. UI Workflow & Shortcuts

The Hub Console (`/`) provides a split-pane interface for project management and interactive chat.

- **Project Sidebar**: Monitor the "Warm/Cold" status of your projects and perform lifecycle actions (Warm-up, Clear, Unregister).
- **Chat Playground**: Supports multi-modal interaction with drag-and-drop image support.
- **Keyboard Orchestration**:
    - **`Enter`**: Send prompt.
    - **`Shift + Enter`**: Insert a new line (essential for structured prompts).
    - **`Cmd/Ctrl + K`**: Clear terminal (UI only).
