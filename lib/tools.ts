import type { Config } from "@google/gemini-cli-core";
import type { PartListUnion } from "@google/genai";
import { createLogger } from "@/lib/logger";

const logger = createLogger("Hub/Tools");

/** Session-like object that provides the SDK config (and thus ToolRegistry). */
export interface SessionWithRegistry {
  config: Config;
}

/**
 * Execute a single tool via the SDK's ToolRegistry; returns content for FunctionResponse.
 * Shared by /api/chat/prompt (YOLO) and /api/chat/tool (approval).
 */
export async function executeTool(
  session: SessionWithRegistry,
  toolName: string,
  args: Record<string, unknown>,
  approved: boolean,
): Promise<string | PartListUnion> {
  if (!approved) {
    return "User rejected the tool call.";
  }

  try {
    const toolRegistry = session.config.getToolRegistry();
    const tool = toolRegistry.getTool(toolName);
    if (!tool) {
      logger.warn("Tool not found in registry", { toolName, available: toolRegistry.getAllToolNames() });
      return `Tool "${toolName}" is not implemented for approval flow.`;
    }

    let invocation;
    try {
      invocation = tool.build(args);
    } catch (buildErr) {
      const msg = buildErr instanceof Error ? buildErr.message : String(buildErr);
      logger.warn("Tool build failed (invalid params)", { toolName, error: msg });
      return `Error: ${msg}`;
    }

    const signal = new AbortController().signal;
    const result = await invocation.execute(signal);
    if (result.error) {
      logger.warn("Tool execution returned error", { toolName, error: result.error.message });
      return `Error: ${result.error.message}`;
    }
    return result.llmContent;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error("SDK tool execution failed", { toolName, error: msg });
    return `Error: ${msg}`;
  }
}
