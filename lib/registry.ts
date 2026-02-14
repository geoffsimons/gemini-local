import { GeminiClient, Config, sessionId, AuthType } from "@google/gemini-cli-core";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { scryptSync } from "node:crypto";

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

    // --- Start of Golden Copy Logic ---
    await session.config.initialize();

    // Use the string 'oauth-personal' to leverage existing CLI login
    await session.config.refreshAuth(AuthType.LOGIN_WITH_GOOGLE);

    const memoryPath = join(folderPath, "GEMINI.md");
    if (existsSync(memoryPath)) {
      session.config.setUserMemory(readFileSync(memoryPath, "utf-8"));
    }

    await session.client.initialize();
    session.client.updateSystemInstruction();

    await session.client.startChat();
    // --- End of Golden Copy Logic ---

    session.initialized = true;
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