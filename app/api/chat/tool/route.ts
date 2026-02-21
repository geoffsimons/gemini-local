import { NextRequest, NextResponse } from "next/server";
import { readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { registry } from "@/lib/registry";
import { isFolderTrusted } from "@/lib/folders";
import { createLogger } from "@/lib/logger";
import { JsonStreamEventType, convertToFunctionResponse } from "@google/gemini-cli-core";
import path from "path";

const logger = createLogger('Hub/API/ChatTool');

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ToolCallBody {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

/** Execute a single tool server-side; returns string for FunctionResponse output. */
function executeTool(
  toolName: string,
  args: Record<string, unknown>,
  folderPath: string,
  approved: boolean,
): string {
  if (!approved) {
    return "User rejected the tool call.";
  }

  const root = resolve(folderPath);

  switch (toolName) {
    case "read_file": {
      const p = args.path ?? args.file;
      const relPath = typeof p === "string" ? p : String(p ?? "");
      if (!relPath) return "Error: missing path argument.";
      const fullPath = path.isAbsolute(relPath) ? relPath : join(root, relPath);
      const resolved = resolve(fullPath);
      if (!resolved.startsWith(root)) {
        return "Error: path is outside project directory.";
      }
      if (!existsSync(resolved)) {
        return `Error: file not found: ${relPath}`;
      }
      try {
        return readFileSync(resolved, "utf-8");
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return `Error reading file: ${msg}`;
      }
    }
    default:
      return `Tool "${toolName}" is not implemented for approval flow.`;
  }
}

// ---------------------------------------------------------------------------
// POST /api/chat/tool
// ---------------------------------------------------------------------------

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      folderPath,
      sessionId,
      toolCall,
      approved,
      stream: streamRequest,
    } = body as {
      folderPath: string;
      sessionId?: string;
      toolCall: ToolCallBody;
      approved: boolean;
      stream?: boolean;
    };

    if (!folderPath) {
      return NextResponse.json({ error: "folderPath is required" }, { status: 400 });
    }
    if (!toolCall || typeof toolCall !== "object" || !toolCall.id || !toolCall.name) {
      return NextResponse.json(
        { error: "toolCall with id and name is required" },
        { status: 400 },
      );
    }

    const callId = toolCall.id;
    logger.info("Tool fulfillment received", {
      callId,
      toolName: toolCall.name,
      approved: Boolean(approved),
    });

    const resolvedPath = path.resolve(folderPath);

    if (!(await isFolderTrusted(resolvedPath))) {
      logger.warn("Tool request rejected: folder not trusted", { folder: resolvedPath });
      return NextResponse.json({ error: "Folder not trusted" }, { status: 403 });
    }

    const session = await registry.getSession(resolvedPath, sessionId);

    if (resolvedPath !== session.folderPath) {
      return NextResponse.json({ error: "Folder not trusted" }, { status: 403 });
    }

    const args = (toolCall.args && typeof toolCall.args === "object")
      ? (toolCall.args as Record<string, unknown>)
      : {};
    const output = executeTool(toolCall.name, args, resolvedPath, Boolean(approved));

    const responseParts = convertToFunctionResponse(
      toolCall.name,
      callId,
      output,
      session.client.currentModel,
    );
    logger.debug("FunctionResponse built for Gemini API", { callId, toolName: toolCall.name });

    const lastTurn = session.history[session.history.length - 1];
    const lastIsModelWithMatchingCall =
      lastTurn?.role === "model" &&
      (lastTurn as any).parts?.some?.(
        (p: any) => p?.functionCall?.id === callId,
      );
    if (!lastIsModelWithMatchingCall) {
      session.history.push({
        role: "model",
        parts: [{
          functionCall: {
            id: callId,
            name: toolCall.name,
            args,
          },
        }],
      } as any);
      logger.info("Injected missing model turn before functionResponse", { callId });
    }

    session.client.setHistory(session.history as any);

    const acceptHeader = req.headers.get("accept");
    const shouldStream = streamRequest === true || acceptHeader === "text/event-stream";

    const promptId = `tool-${Date.now()}`;
    const abortController = new AbortController();

    const syncHistoryFromCore = () => {
      session.history.length = 0;
      session.history.push(...(session.client.getHistory() as typeof session.history));
    };

    if (shouldStream) {
      const encoder = new TextEncoder();

      const readableStream = new ReadableStream({
        async start(controller) {
          const sendEvent = (event: object) => {
            controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
          };

          try {
            logger.debug("Calling client.prompt with functionResponse", { callId });
            const stream = session.client.prompt(responseParts, {
              signal: abortController.signal,
              promptId,
              sessionId: session.config.getSessionId(),
            });

            for await (const event of stream) {
              switch (event.type) {
                case JsonStreamEventType.INIT:
                  sendEvent({ type: "INIT", model: (event as any).model });
                  break;
                case JsonStreamEventType.MESSAGE:
                  if ((event as any).content) {
                    sendEvent({
                      type: "MESSAGE",
                      content: (event as any).content,
                      delta: (event as any).delta,
                    });
                  }
                  break;
                case JsonStreamEventType.TOOL_USE: {
                  const toolEvent = event as {
                    tool_name: string;
                    parameters?: Record<string, unknown>;
                    tool_id?: string;
                  };
                  const nextCallId = toolEvent.tool_id ?? `call-${Date.now()}`;
                  if (!toolEvent.tool_id) {
                    logger.warn("TOOL_USE event missing tool_id; using fallback", {
                      tool_name: toolEvent.tool_name,
                      fallbackId: nextCallId,
                    });
                  }
                  if (!session.yoloMode) {
                    logger.info("Stream yielded TOOL_USE (pause for approval)", {
                      callId: nextCallId,
                      tool_name: toolEvent.tool_name,
                    });
                    session.history.push({
                      role: "model",
                      parts: [{
                        functionCall: {
                          id: nextCallId,
                          name: toolEvent.tool_name,
                          args: toolEvent.parameters ?? {},
                        },
                      }],
                    } as any);
                    sendEvent({
                      type: "TOOL_USE",
                      tool_name: toolEvent.tool_name,
                      parameters: toolEvent.parameters ?? {},
                      tool_id: nextCallId,
                    });
                    controller.close();
                    return;
                  }
                  logger.info("[Agent] Auto-executing tool: %s", toolEvent.tool_name);
                  break;
                }
                case JsonStreamEventType.ERROR:
                  sendEvent({ type: "ERROR", message: (event as any).message });
                  break;
                case JsonStreamEventType.RESULT:
                  syncHistoryFromCore();
                  sendEvent({ type: "RESULT", stats: (event as any).stats });
                  break;
                default:
                  break;
              }
            }
          } catch (err: unknown) {
            const errMsg = err instanceof Error ? err.message : String(err);
            logger.error("Tool stream failed", { error: errMsg });
            sendEvent({ type: "ERROR", message: errMsg });
          } finally {
            controller.close();
          }
        },
      });

      return new NextResponse(readableStream, {
        headers: {
          "Content-Type": "application/x-ndjson",
          "Cache-Control": "no-cache",
          "Connection": "keep-alive",
        },
      });
    }

    let responseText = "";
    const stream = session.client.prompt(responseParts, {
      signal: abortController.signal,
      promptId,
      sessionId: session.config.getSessionId(),
    });

    for await (const event of stream) {
      if (event.type === JsonStreamEventType.MESSAGE) {
        responseText += (event as any).content || "";
      } else if (event.type === JsonStreamEventType.ERROR) {
        return NextResponse.json(
          { error: (event as any).message ?? "Stream error" },
          { status: 500 },
        );
      }
    }

    session.history.length = 0;
    session.history.push(...(session.client.getHistory() as typeof session.history));

    return NextResponse.json({
      response: responseText,
      model: session.client.currentModel,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error("Tool route error", { error: message });
    return NextResponse.json(
      { error: "Tool execution failed", details: message },
      { status: 500 },
    );
  }
}
