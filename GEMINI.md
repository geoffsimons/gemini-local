# Gemini Local Project Context & Rules

## Core Objective
Build a robust, local-first HTTP bridge for the Google Gemini CLI.
The system is a monolithic Next.js application that serves two purposes:
1.  **API Layer:** Wraps the local `gemini-cli` to provide a persistent, stateful HTTP interface.
2.  **UI Layer:** A modern chat interface for interacting with the model.

## Tech Stack
- **Framework:** Next.js 14+ (App Router).
- **Language:** TypeScript (Strict Mode).
- **Styling:** Tailwind CSS (v4) with `clsx` and `tailwind-merge`.
- **Core Libraries:**
    - `@google/gemini-cli-core`: For interacting with the Gemini model.
    - `sharp`: For server-side image processing (stitching/resizing).
    - `lucide-react`: For UI icons.

## Project Structure
- **/app/api**: API Routes (The "Server").
- **/app/components**: React Client Components (The "UI").
- **/lib**: Shared utilities and Singleton instances.
- **GEMINI.md**: The source of truth for Project Context and System Prompts.

## 📐 ARCHITECTURAL PATTERNS

### 1. The Global Singleton (Crucial)
Because Next.js in development mode hot-reloads frequently, we cannot instantiate a new `GeminiClient` on every request.
- **Pattern:** You MUST use the Global Singleton pattern for the Gemini Client in `lib/gemini.ts`.
- **Rule:** Check `globalThis.geminiClient` before creating a new instance.
- **Why:** This ensures the CLI process remains alive and retains conversational memory across API calls.

### 2. Multi-Modal "Stitching" Strategy
The internal Gemini API endpoint has a hard limit of **1 Image Attachment**.
- **Constraint:** We support multiple images by "stitching" them into a single composite image server-side.
- **Tool:** Use `sharp` in `lib/image.ts`.
- **Format:** Always output **PNG** to prevent color bleeding (JPEG artifacts confuse the model).
- **Resolution:** **NEVER** downscale images unless they exceed the API payload limit (20MB). We want high-fidelity text readability.

### 3. System Prompt Injection (Hallucination Fix)
The internal model often "refuses" to see images if the prompt structure is strictly `[Text, Image]`.
- **Rule:** If an image is attached, the API Route MUST inject a system hint into the text prompt:
    - *Single Image:* `[System: User has attached a base64 encoded image for analysis.]`
    - *Multi-Image:* `[System: User has attached a composite image containing N images stitched horizontally...]`

## 💻 DEVELOPMENT GUIDELINES

### AI Agent Role
- **Role:** Senior Full-Stack Engineer.
- **Intent:** You focus on robustness, type safety, and clean architecture.
- **Constraint:** Adhere to the "Why" defined in this file. Do not invent new patterns for image handling or state management without checking `GEMINI.md` first.

### Formatting & Code Style
- **TypeScript:** Use interfaces for all data structures (e.g., `Message`, `ImagePayload`).
- **Tailwind:** Use utility classes. Avoid custom CSS files.
- **Whitespace:** **STRICT CONSTRAINT**. No trailing whitespace. Files must end with a single newline.

### Git & Workflow
- **STRICT PROHIBITION**: You are **NEVER** authorized to execute `git commit` or `git push`.
- **Mandatory Hand-off**:
  1.  Create/Edit files as requested.
  2.  Run `git add <files>` to stage the changes.
  3.  **STOP** and instruct the user to run: `./scripts/commit.sh`
  4.  Do not generate a commit message yourself; the script handles that.

## 🚀 API CONTRACT (Internal)
**POST** `/api/chat`
- **Request:**
  ```json
  {
    "message": "string (optional)",
    "images": [{ "mimeType": "image/png", "data": "base64..." }]
  }