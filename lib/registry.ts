import { GeminiClient, Config, AuthType } from "@google/gemini-cli-core";
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
  private pendingInits = new Map<string, Promise<void>>();

  private generateStableId(path: string): string {
    return scryptSync(path, 'salt', 32).toString('hex').substring(0, 8);
  }

  public async getSession(folderPath: string, customSessionId?: string): Promise<ProjectSession> {
    const sessionId = customSessionId || this.generateStableId(folderPath);
    const registryKey = `${folderPath}:${sessionId}`;
    let session = this.sessions.get(registryKey);

    if (!session) {
      if (!existsSync(folderPath)) {
        log.warn('Rejected session for nonexistent directory', { folder: folderPath });
        throw new Error(`Directory does not exist: ${folderPath}`);
      }

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
      this.sessions.set(registryKey, session);
    } else {
      log.debug('Session cache hit', { folder: folderPath, sessionId, registryKey });
    }

    return session;
  }

  public async initializeSession(folderPath: string): Promise<void> {
    const sessionId = this.generateStableId(folderPath);
    const registryKey = `${folderPath}:${sessionId}`;
    const session = this.sessions.get(registryKey);

    // Check Phase: already initialized
    if (!session || session.initialized) return;

    // Lock Phase: join existing initialization if one is in progress
    const existing = this.pendingInits.get(registryKey);
    if (existing) {
      log.debug('Joining existing initialization for [key]', { key: registryKey });
      return existing;
    }

    // Execution Phase: run Golden Copy once and store promise so others can await it
    const initPromise = (async () => {
      try {
        const sid = session.config.getSessionId();
        log.info('Initializing session', { folder: folderPath, sessionId: sid });

        // --- Start of Golden Copy Logic ---
        await session.config.initialize();
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
      } catch (err) {
        // Evict the broken session so callers don't get a half-initialised entry
        this.sessions.delete(registryKey);
        log.error('Initialization failed — session evicted from registry', { folder: folderPath, error: err });
        throw err;
      } finally {
        this.pendingInits.delete(registryKey);
      }
    })();

    this.pendingInits.set(registryKey, initPromise);
    await initPromise;
  }

  public async clearSession(folderPath: string, sessionId?: string): Promise<void> {
    const sid = sessionId || this.generateStableId(folderPath);
    const registryKey = `${folderPath}:${sid}`;
    const session = this.sessions.get(registryKey);

    if (session) {
      await session.client.startChat();
      log.info(`Session cleared for ${registryKey}`);
    }
  }

  public isReady(folderPath: string): boolean {
    const registryKey = `${folderPath}:${this.generateStableId(folderPath)}`;
    return this.sessions.get(registryKey)?.initialized ?? false;
  }
}

// Global singleton to survive Next.js Fast Refresh
declare global {
  var registry: ClientRegistry | undefined;
}

export const registry = globalThis.registry ?? new ClientRegistry();
if (process.env.NODE_ENV !== "production") globalThis.registry = registry;