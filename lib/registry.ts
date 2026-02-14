import { GeminiClient, Config, sessionId, AuthType } from "@google/gemini-cli-core";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { scryptSync } from "node:crypto";
import { createLogger } from "./logger";

const log = createLogger('Hub/Registry');

interface ProjectSession {
  client: GeminiClient;
  config: Config;
  initialized: boolean;
}

class ClientRegistry {
  private sessions = new Map<string, ProjectSession>();

  private generateStableId(path: string): string {
    return scryptSync(path, 'salt', 32).toString('hex').substring(0, 8);
  }

  public async getSession(folderPath: string, customSessionId?: string): Promise<ProjectSession> {
    const sessionId = customSessionId || this.generateStableId(folderPath);
    const registryKey = `${folderPath}:${sessionId}`;
    let session = this.sessions.get(registryKey);

    if (!session) {
      log.info('Creating new session for folder', { folder: folderPath, sessionId });

      const config = new Config({
        sessionId: sessionId,
        model: "gemini-2.5-flash",
        targetDir: folderPath,
        cwd: folderPath,
        debugMode: false,
        interactive: false, // Essential: prevents the CLI from trying to hijack the terminal
      });

      const client = new GeminiClient(config);

      session = { client, config, initialized: false };
      this.sessions.set(folderPath, session);
    }

    return session;
  }

  public async initializeSession(folderPath: string): Promise<void> {
    const session = await this.sessions.get(folderPath);
    if (!session || session.initialized) return;

    const sid = session.config.sessionId;
    log.info('Initializing session', { folder: folderPath, sessionId: sid });

    // --- Start of Golden Copy Logic ---
    await session.config.initialize();

    // Use the string 'oauth-personal' to leverage existing CLI login
    await session.config.refreshAuth(AuthType.LOGIN_WITH_GOOGLE);

    const memoryPath = join(folderPath, "GEMINI.md");
    if (existsSync(memoryPath)) {
      session.config.setUserMemory(readFileSync(memoryPath, "utf-8"));
    } else {
      log.error('GEMINI.md not found — session will lack project memory', { folder: folderPath, sessionId: sid });
    }

    try {
      await session.client.initialize();
      session.client.updateSystemInstruction();

      await session.client.startChat();
    } catch (err) {
      log.error('CLI initialization failed', { folder: folderPath, sessionId: sid, error: err });
      throw err;
    }
    // --- End of Golden Copy Logic ---

    session.initialized = true;
    log.info('Session initialized successfully', { folder: folderPath, sessionId: sid });
  }

  public isReady(folderPath: string): boolean {
    return this.sessions.get(folderPath)?.initialized ?? false;
  }
}

// Global singleton to survive Next.js Fast Refresh
declare global {
  var registry: ClientRegistry | undefined;
}

export const registry = globalThis.registry ?? new ClientRegistry();
if (process.env.NODE_ENV !== "production") globalThis.registry = registry;