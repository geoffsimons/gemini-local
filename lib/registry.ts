import { GeminiClient as CoreClient, Config, AuthType } from "@google/gemini-cli-core";
import { readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { scryptSync } from "node:crypto";
import { createLogger } from "./logger";

const log = createLogger('Hub/Registry');

/**
 * Enhanced GeminiClient with local state tracking for model switching.
 */
class GeminiClient extends CoreClient {
  public currentModel: string;

  constructor(config: Config) {
    super(config);
    this.currentModel = config.getModel() || "gemini-2.5-flash";
  }

  /**
   * Warm up the client and optionally set the model.
   */
  public async start(model?: string): Promise<void> {
    if (model) {
      this.currentModel = model;
    }
    await this.initialize();
    this.updateSystemInstruction();
  }

  /**
   * Rebind the client to a new model while preserving history.
   */
  public async rebind(history: any[]): Promise<void> {
    // @ts-ignore - resumeChat exists in CoreClient
    await this.resumeChat(history);
    this.updateSystemInstruction();
  }
}

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

  public async getSession(folderPath: string, customSessionId?: string, model?: string): Promise<ProjectSession> {
    const normalizedPath = resolve(folderPath);
    const sessionId = customSessionId || this.generateStableId(normalizedPath);
    const registryKey = `${normalizedPath}:${sessionId}`;
    let session = this.sessions.get(registryKey);

    if (!session) {
      if (!existsSync(normalizedPath)) {
        log.warn('Rejected session for nonexistent directory', { folder: normalizedPath });
        throw new Error(`Directory does not exist: ${normalizedPath}`);
      }

      log.info('Creating new session for folder', { folder: normalizedPath, sessionId });

      const config = new Config({
        sessionId: sessionId,
        model: model || "gemini-2.5-flash",
        targetDir: normalizedPath,
        cwd: normalizedPath,
        debugMode: false,
        interactive: false, // Essential: prevents the CLI from trying to hijack the terminal
      });

      const client = new GeminiClient(config);

      session = { client, config, initialized: false };
      this.sessions.set(registryKey, session);
    } else {
      log.debug('Session cache hit', { folder: normalizedPath, sessionId, registryKey });
    }

    return session;
  }

  public async initializeSession(folderPath: string, customSessionId?: string, model?: string): Promise<void> {
    const normalizedPath = resolve(folderPath);
    const sessionId = customSessionId || this.generateStableId(normalizedPath);
    const registryKey = `${normalizedPath}:${sessionId}`;
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
          await session.client.start(model);
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

  public async resetSessionHistory(folderPath: string, sessionId?: string): Promise<void> {
    const session = await this.getSession(folderPath, sessionId);
    log.info('Ephemeral reset: issuing clear command', { folder: folderPath });

    // programmatically issue a "/clear" command to the underlying CLI engine
    // to isolate the next prompt from previous context
    await session.client.resetChat();
  }

  public async clearSession(folderPath: string, sessionId?: string): Promise<void> {
    const normalizedPath = resolve(folderPath);
    const sid = sessionId || this.generateStableId(normalizedPath);
    const registryKey = `${normalizedPath}:${sid}`;

    this.sessions.delete(registryKey);
    this.pendingInits.delete(registryKey);

    log.info(`Session purged from Registry: ${registryKey}. Next request will trigger a fresh initialization.`);
  }

  public isReady(folderPath: string): boolean {
    const normalizedPath = resolve(folderPath);
    const registryKey = `${normalizedPath}:${this.generateStableId(normalizedPath)}`;
    return this.sessions.get(registryKey)?.initialized ?? false;
  }

  public hasSession(folderPath: string, sessionId?: string): boolean {
    const normalizedPath = resolve(folderPath);
    const sid = sessionId || this.generateStableId(normalizedPath);
    const registryKey = `${normalizedPath}:${sid}`;
    return this.sessions.has(registryKey);
  }

  public getStatus(folderPath: string, customSessionId?: string): { isReady: boolean; sessionId?: string; currentModel?: string; sessionExists?: boolean } {
    const normalizedPath = resolve(folderPath);
    const sessionId = customSessionId || this.generateStableId(normalizedPath);
    const registryKey = `${normalizedPath}:${sessionId}`;
    const session = this.sessions.get(registryKey);

    if (!session) {
      return { isReady: false, currentModel: "gemini-2.5-flash", sessionExists: false };
    }
    return {
      isReady: session.initialized,
      sessionId,
      currentModel: session.client.currentModel || session.config.getModel() || "gemini-2.5-flash",
      sessionExists: true
    };
  }

  public async setModel(folderPath: string, model: string, sessionId?: string): Promise<void> {
    const session = await this.getSession(folderPath, sessionId);
    const sid = session.config.getSessionId();
    log.info('Switching model with state handover', { folder: folderPath, model, sessionId: sid });

    // Step 1: Capture State
    const history = session.client.getHistory();

    // Step 2: Update Config
    session.config.setModel(model);
    session.client.currentModel = model;

    // Step 3: Handover
    try {
      await session.client.rebind(history);
    } catch (err) {
      log.error('Model switch handover failed', { error: err, sessionId: sid });
      throw err;
    }
  }
}

// Global singleton to survive Next.js Fast Refresh
declare global {
  var registry: ClientRegistry | undefined;
}

/** Returns the shared registry at runtime (use in routes that may load in a different bundle). */
export function getRegistry(): ClientRegistry {
  if (!globalThis.registry) {
    globalThis.registry = new ClientRegistry();
  }
  return globalThis.registry as ClientRegistry;
}

/**
 * Switch model for a folder session. Exported so the model route can call this
 * without pulling in a tree-shaken registry that lacks setModel.
 */
export async function setModelForSession(
  folderPath: string,
  model: string,
  sessionId?: string
): Promise<void> {
  const reg = getRegistry();
  await reg.setModel(folderPath, model, sessionId);
}

export const registry = getRegistry();
if (process.env.NODE_ENV !== "production") globalThis.registry = registry;