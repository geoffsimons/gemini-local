/**
 * Integration test suite for the Hub API lifecycle.
 *
 * Requires a running Next.js server (default: http://localhost:3000).
 * Run with:  npx tsx tests/integration.test.ts
 *
 * Override the server URL:  HUB_URL=http://localhost:4000 npx tsx tests/integration.test.ts
 * Override the project dir: TEST_FOLDER=/absolute/path npx tsx tests/integration.test.ts
 */

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const BASE_URL = process.env.HUB_URL || "http://localhost:3000";

// Default to the hub root — a real folder that contains GEMINI.md.
const FOLDER_PATH = process.env.TEST_FOLDER || path.resolve(process.cwd());

// Gemini round-trips can be slow; give every test generous headroom.
const PROMPT_TIMEOUT_MS = 120_000;
const INIT_TIMEOUT_MS = 90_000;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function get(route: string): Promise<Response> {
  return fetch(`${BASE_URL}${route}`);
}

async function post(
  route: string,
  body: Record<string, unknown>,
): Promise<Response> {
  return fetch(`${BASE_URL}${route}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe("Hub API Integration", () => {
  // ------------------------------------------------------------------
  // Pre-flight: make sure the server is reachable
  // ------------------------------------------------------------------
  before(async () => {
    try {
      const res = await get("/api/health");
      const data = (await res.json()) as { status: string };
      assert.equal(data.status, "ok", "Health check did not return ok");
    } catch (err) {
      throw new Error(
        `Server not reachable at ${BASE_URL}. Start it with \`npm run dev\` first.\n${err}`,
      );
    }
  });

  // ------------------------------------------------------------------
  // Scenario 1 — Cold Start
  // Verify that a brand-new folder reports ready: false.
  // ------------------------------------------------------------------
  it("Scenario 1: cold status check returns ready=false", async () => {
    const encoded = encodeURIComponent(FOLDER_PATH);
    const res = await get(`/api/chat/status?folderPath=${encoded}`);
    assert.equal(res.status, 200, `Expected 200, got ${res.status}`);

    const data = (await res.json()) as { folderPath: string; ready: boolean };
    assert.equal(data.ready, false, "Session should not be ready before initialization");
    assert.equal(data.folderPath, FOLDER_PATH, "Returned folderPath should match");
  });

  // ------------------------------------------------------------------
  // Scenario 2 — Explicit Initialization
  // Call POST /api/chat/start and verify it comes back 200 / ready.
  // ------------------------------------------------------------------
  it(
    "Scenario 2: POST /api/chat/start initializes the session",
    { timeout: INIT_TIMEOUT_MS },
    async () => {
      const res = await post("/api/chat/start", { folderPath: FOLDER_PATH });
      assert.equal(res.status, 200, `Expected 200, got ${res.status}`);

      const data = (await res.json()) as { status: string; folderPath: string };
      assert.equal(data.status, "ready", "Start should return status=ready");
      assert.equal(data.folderPath, FOLDER_PATH);

      // Confirm the status endpoint now agrees
      const statusRes = await get(
        `/api/chat/status?folderPath=${encodeURIComponent(FOLDER_PATH)}`,
      );
      const statusData = (await statusRes.json()) as { ready: boolean };
      assert.equal(statusData.ready, true, "Session should be ready after /start");
    },
  );

  // ------------------------------------------------------------------
  // Scenario 3 — Sequential Prompts (context persistence)
  // Send two prompts via the same folderPath and verify the model
  // remembers the first when answering the second.
  // ------------------------------------------------------------------
  it(
    "Scenario 3: sequential prompts preserve session context",
    { timeout: PROMPT_TIMEOUT_MS },
    async () => {
      // Prompt A: introduce a name
      const res1 = await post("/api/chat/prompt", {
        folderPath: FOLDER_PATH,
        message: "Hi, my name is HubTest. Please remember it.",
      });
      assert.equal(res1.status, 200, `Prompt A: expected 200, got ${res1.status}`);

      const data1 = (await res1.json()) as { response: string };
      assert.ok(
        typeof data1.response === "string" && data1.response.length > 0,
        "Prompt A should return a non-empty response",
      );

      // Prompt B: ask for the name back
      const res2 = await post("/api/chat/prompt", {
        folderPath: FOLDER_PATH,
        message: "What is my name? Reply with just the name, nothing else.",
      });
      assert.equal(res2.status, 200, `Prompt B: expected 200, got ${res2.status}`);

      const data2 = (await res2.json()) as { response: string };
      assert.ok(
        data2.response.includes("HubTest"),
        `Expected response to contain "HubTest", got: "${data2.response}"`,
      );
    },
  );

  // ------------------------------------------------------------------
  // Scenario 4 — Invalid / non-existent folder
  // The Golden Copy init should fail for a path that doesn't exist,
  // returning a 500 (or 403 once path-validation is added).
  // ------------------------------------------------------------------
  it(
    "Scenario 4: invalid folder returns an error status",
    { timeout: INIT_TIMEOUT_MS },
    async () => {
      const res = await post("/api/chat/start", {
        folderPath: "/nonexistent/untrusted/path/xyz",
      });

      assert.ok(
        res.status >= 400 && res.status < 600,
        `Expected 4xx or 5xx for invalid folder, got ${res.status}`,
      );

      const data = (await res.json()) as { error: string };
      assert.ok(
        typeof data.error === "string" && data.error.length > 0,
        "Error response should contain an error message",
      );
    },
  );
});
