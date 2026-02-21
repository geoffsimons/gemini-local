# Developer Usage Guide

This guide covers the installation, API specifications, and ecosystem utilities for the Gemini Local Hub.

## 1. Installation & Setup

### Prerequisites
- **Node.js**: >= 18.17.0
- **Gemini CLI**: Installed and authenticated (`gemini login`).
- **Google Account**: Required for API access and authentication.

### Launching the Hub
```bash
# Install dependencies
npm install

# Start the server in development mode
npm run dev
```
The Hub Console will be available at `http://localhost:3000`.

## 2. UI Workflow & Features

The Hub provides a comprehensive **Chat Playground** and **Project Dashboard**.

### Key Features
- **Thought Blocks**: View the model's internal reasoning in real-time. Reasoning steps are collapsed by default to keep the interface clean.
- **Tool Control**: Intercept and approve tool calls manually or enable "YOLO mode" for autonomous execution.
- **Dynamic Model Switching**: Switch between available Gemini models (e.g., Flash, Pro) mid-conversation.
- **Generation Controls**: Use "Stop" to halt an assistant response or "Retry" to regenerate the last turn.
- **Drag-and-Drop Multi-modal**: Drop multiple images directly into the chat; the Hub handles the stitching and system prompt injection automatically.

### Keyboard Shortcuts
- `Enter`: Send prompt.
- `Shift + Enter`: New line.
- `Cmd/Ctrl + K`: Clear chat UI.

## 3. API Specification

The Hub communicates via JSON. All requests involving a project must use an absolute `folderPath`.

### Chat Prompt: `POST /api/chat/prompt`
The primary streaming interface for interactions.

| Parameter | Type | Description |
|---|---|---|
| `folderPath` | `string` | **Required**. Absolute path to the registered project. |
| `message` | `string` | The text prompt. |
| `images` | `array` | Optional list of `{ data: base64, mimeType: string }`. |
| `ephemeral` | `boolean` | If `true`, the session history is cleared before processing. |
| `sessionId` | `string` | Optional. Use a custom ID for isolated threads (ADR-006). |
| `model` | `string` | Optional. Overrides the default model for this request. |

### Registry Management: `POST /api/registry/add`
Registers a directory as a trusted workspace.
- **Body**: `{ "folderPath": "/absolute/path/to/project" }`

## 4. Ecosystem Utilities (`scripts/`)

The Hub includes AI-powered CLI tools that leverage the local API:

- **`connect.sh`**: Run from any project root to register the folder and "warm up" the Gemini session.
- **`commit.sh`**: Generates high-quality Conventional Commits by analyzing staged changes. Uses ephemeral sessions to avoid polluting main chat history.
- **`sync-logs.sh`**: Automatically updates `CHANGELOG.md` and `DECISIONS.md` by analyzing recent git history.
- **`smoke-test.sh`**: Validates the end-to-end agentic loop, including tool fulfillment and streaming stability.
