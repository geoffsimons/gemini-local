import { GeminiClient, Config, sessionId } from "@google/gemini-cli-core";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Extend globalThis to persist the client and config across Next.js hot-reloads.
 * initLock ensures concurrent getGeminiClient() calls share one initialization.
 */
declare global {
  var geminiClient: GeminiClient | undefined;
  var geminiConfig: Config | undefined;
  var geminiInitLock: Promise<GeminiClient> | undefined;
}

/**
 * Reads the GEMINI.md file from the project root.
 * Returns an empty string if the file is missing.
 */
function loadUserMemory(): string {
  try {
    const memoryPath = join(process.cwd(), "GEMINI.md");
    return readFileSync(memoryPath, "utf-8");
  } catch {
    return "";
  }
}

/**
 * Performs the actual client initialization. Called only once, inside the lock.
 */
async function createGeminiClient(): Promise<GeminiClient> {
  const cwd = process.cwd();

  const config = new Config({
    sessionId: sessionId,
    model: "gemini-2.5-flash",
    targetDir: cwd,
    cwd,
    debugMode: false,
    interactive: false,
    approvalMode: "auto" as never,
  });

  // Inject project context as user memory
  const userMemory = loadUserMemory();
  if (userMemory) {
    config.setUserMemory(userMemory);
  }

  await config.initialize();

  const client = config.getGeminiClient();
  await client.initialize();
  await client.startChat();

  // Ensure the chat session is wired up and active before returning
  client.getChat();

  globalThis.geminiConfig = config;
  return client;
}

/**
 * Returns the global singleton GeminiClient.
 * On first call, creates a Config, sets user memory from GEMINI.md,
 * initializes the client, and starts a chat session. Concurrent callers
 * await the same initialization via a lock.
 *
 * Subsequent calls (including after hot-reload) return the cached instance.
 */
export async function getGeminiClient(): Promise<GeminiClient> {
  if (globalThis.geminiClient) {
    return globalThis.geminiClient;
  }

  if (!globalThis.geminiInitLock) {
    globalThis.geminiInitLock = (async () => {
      const client = await createGeminiClient();
      globalThis.geminiClient = client;
      return client;
    })();
  }

  return globalThis.geminiInitLock;
}
