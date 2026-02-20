import {
  GeminiClient as CoreClient,
  Config,
  AuthType,
  OutputFormat,
  JsonStreamEventType,
  GeminiEventType,
  type JsonStreamEvent,
  type ServerGeminiStreamEvent,
} from "@google/gemini-cli-core";
import { readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { scryptSync } from "node:crypto";
import { createLogger } from "./logger";
import { isFolderTrusted } from "./folders";

const log = createLogger('Hub/Registry');

const DEFAULT_GEMINI_MODEL = process.env.DEFAULT_GEMINI_MODEL || "gemini-3-flash-preview";

/** One turn in the Hub-owned conversation history (user or model). */
export type HistoryEntry = {
  role: 'user' | 'model';
  parts: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }>;
};

log.info('DEFAULT_GEMINI_MODEL', { DEFAULT_GEMINI_MODEL });

function timestamp(): string {
  return new Date().toISOString();
}

/**
 * Converts a single ServerGeminiStreamEvent from the core into zero or more
 * JsonStreamEvent objects for the public stream-json API.
 */
function* serverEventToJsonStreamEvents(
  event: ServerGeminiStreamEvent,
  sessionId: string
): Generator<JsonStreamEvent> {
  const ts = timestamp();
  switch (event.type) {
    case GeminiEventType.ModelInfo: {
      yield {
        type: JsonStreamEventType.INIT,
        timestamp: ts,
        session_id: sessionId,
        model: (event as { value: string }).value,
      };
      break;
    }
    case GeminiEventType.Content: {
      const e = event as { value: string };
      yield {
        type: JsonStreamEventType.MESSAGE,
        timestamp: ts,
        role: 'assistant' as const,
        content: e.value,
        delta: true,
      };
      break;
    }
    case GeminiEventType.Thought: {
      const e = event as { value: { summary?: string } };
      const text = e.value?.summary ?? '';
      if (text) {
        yield {
          type: JsonStreamEventType.MESSAGE,
          timestamp: ts,
          role: 'assistant' as const,
          content: text,
          delta: true,
        };
      }
      break;
    }
    case GeminiEventType.ToolCallRequest: {
      const e = event as { value: { callId: string; name: string; args: Record<string, unknown> } };
      yield {
        type: JsonStreamEventType.TOOL_USE,
        timestamp: ts,
        tool_name: e.value.name,
        tool_id: e.value.callId,
        parameters: e.value.args ?? {},
      };
      break;
    }
    case GeminiEventType.ToolCallResponse: {
      const e = event as { value: { callId: string; error?: Error } };
      yield {
        type: JsonStreamEventType.TOOL_RESULT,
        timestamp: ts,
        tool_id: e.value.callId,
        status: e.value.error ? 'error' : 'success',
        ...(e.value.error && {
          error: { type: 'error', message: e.value.error.message },
        }),
      };
      break;
    }
    case GeminiEventType.Error: {
      const e = event as { value: { error: { message: string } } };
      yield {
        type: JsonStreamEventType.ERROR,
        timestamp: ts,
        severity: 'error' as const,
        message: e.value?.error?.message ?? 'Unknown error',
      };
      break;
    }
    case GeminiEventType.Finished: {
      const e = event as { value: { usageMetadata?: { totalTokenCount?: number; promptTokenCount?: number; candidatesTokenCount?: number } } };
      const um = e.value?.usageMetadata;
      yield {
        type: JsonStreamEventType.RESULT,
        timestamp: ts,
        status: 'success' as const,
        ...(um && {
          stats: {
            total_tokens: um.totalTokenCount ?? 0,
            input_tokens: um.promptTokenCount ?? 0,
            output_tokens: um.candidatesTokenCount ?? 0,
            cached: 0,
            input: um.promptTokenCount ?? 0,
            duration_ms: 0,
            tool_calls: 0,
          },
        }),
      };
      break;
    }
    case GeminiEventType.AgentExecutionStopped:
    case GeminiEventType.AgentExecutionBlocked: {
      const e = event as { value: { reason: string } };
      yield {
        type: JsonStreamEventType.ERROR,
        timestamp: ts,
        severity: 'error' as const,
        message: e.value?.reason ?? 'Agent execution stopped',
      };
      break;
    }
    case GeminiEventType.UserCancelled: {
      yield {
        type: JsonStreamEventType.ERROR,
        timestamp: ts,
        severity: 'error' as const,
        message: 'Request cancelled',
      };
      break;
    }
    case GeminiEventType.LoopDetected:
    case GeminiEventType.MaxSessionTurns:
    case GeminiEventType.ContextWindowWillOverflow:
    case GeminiEventType.InvalidStream: {
      yield {
        type: JsonStreamEventType.ERROR,
        timestamp: ts,
        severity: 'error' as const,
        message: event.type === GeminiEventType.LoopDetected
          ? 'Loop detected'
          : event.type === GeminiEventType.MaxSessionTurns
            ? 'Max session turns reached'
            : event.type === GeminiEventType.ContextWindowWillOverflow
              ? 'Context window overflow'
              : 'Invalid stream',
      };
      break;
    }
    default:
      break;
  }
}

/**
 * Enhanced GeminiClient with local state tracking for model switching.
 */
class GeminiClient extends CoreClient {
  public currentModel: string;

  constructor(config: Config) {
    super(config);
    this.currentModel = config.getModel() || DEFAULT_GEMINI_MODEL;
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

  /**
   * Streaming execution using the core sendMessageStream API.
   * Converts ServerGeminiStreamEvent to JsonStreamEvent for alignment with the public stream-json format.
   */
  public async *prompt(parts: any[], options: { signal: AbortSignal; promptId?: string; sessionId?: string }) {
    const promptId = options.promptId || `prompt-${Date.now()}`;
    const sessionId = options.sessionId ?? promptId;
    const stream = this.sendMessageStream(parts, options.signal, promptId);

    for await (const event of stream) {
      for (const jsonEvent of serverEventToJsonStreamEvents(event, sessionId)) {
        yield jsonEvent;
      }
    }
  }
}

interface ProjectSession {
  client: GeminiClient;
  config: Config;
  initialized: boolean;
  /** Authorized folder path for this session (gatekeeper checks). */
  folderPath: string;
  /** Explicit conversation history; source of truth to avoid core internal state mutation. */
  history: HistoryEntry[];
}

class ClientRegistry {
  private sessions = new Map<string, ProjectSession>();
  private pendingInits = new Map<string, Promise<void>>();

  private generateStableId(path: string): string {
    return scryptSync(path, 'salt', 32).toString('hex').substring(0, 8);
  }

  public async getSession(folderPath: string, customSessionId?: string, model?: string): Promise<ProjectSession> {
    const normalizedPath = resolve(folderPath);

    // Secondary gatekeeper: do not return a session for untrusted paths
    if (!(await isFolderTrusted(normalizedPath))) {
      log.warn('Rejected session: folder not trusted', { folder: normalizedPath });
      throw new Error('Folder not trusted');
    }

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
        model: model || DEFAULT_GEMINI_MODEL,
        targetDir: normalizedPath,
        cwd: normalizedPath,
        debugMode: false,
        interactive: false, // Essential: prevents the CLI from trying to hijack the terminal
        output: {
          format: OutputFormat.STREAM_JSON,
        },
      });

      const client = new GeminiClient(config);

      session = { client, config, initialized: false, folderPath: normalizedPath, history: [] };
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
          log.warn('GEMINI.md not found — session will lack project memory', { folder: folderPath, sessionId: sid });
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
    log.info('Ephemeral reset: clearing explicit history and CLI chat', { folder: folderPath });
    session.history.length = 0;
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

  /**
   * Waits for the session to become initialized (e.g. another request is initializing).
   * Polls for a limited time; throws if not ready so the caller can return 503.
   */
  public async ensureSessionReady(
    folderPath: string,
    customSessionId?: string,
    options?: { timeoutMs?: number; pollIntervalMs?: number },
  ): Promise<void> {
    const normalizedPath = resolve(folderPath);
    const sessionId = customSessionId || this.generateStableId(normalizedPath);
    const registryKey = `${normalizedPath}:${sessionId}`;
    const timeoutMs = options?.timeoutMs ?? 12_000;
    const pollIntervalMs = options?.pollIntervalMs ?? 300;

    const session = this.sessions.get(registryKey);
    if (!session) {
      throw new Error('Session not found');
    }
    if (session.initialized) return;

    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, pollIntervalMs));
      const current = this.sessions.get(registryKey);
      if (current?.initialized) return;
    }
    throw new Error('Service Warming Up');
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
      return { isReady: false, currentModel: DEFAULT_GEMINI_MODEL, sessionExists: false };
    }
    return {
      isReady: session.initialized,
      sessionId,
      currentModel: session.client.currentModel || session.config.getModel() || DEFAULT_GEMINI_MODEL,
      sessionExists: true
    };
  }

  public async setModel(folderPath: string, model: string, sessionId?: string): Promise<void> {
    const session = await this.getSession(folderPath, sessionId);
    const sid = session.config.getSessionId();
    log.info('Switching model with state handover', { folder: folderPath, model, sessionId: sid });

    session.config.setModel(model);
    session.client.currentModel = model;
    try {
      await session.client.rebind(session.history as any);
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
export { DEFAULT_GEMINI_MODEL };
if (process.env.NODE_ENV !== "production") globalThis.registry = registry;