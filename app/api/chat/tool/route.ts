import { NextRequest, NextResponse } from "next/server";
import { registry } from "@/lib/registry";
import { isFolderTrusted } from "@/lib/folders";
import { createLogger } from "@/lib/logger";
import { executeTool } from "@/lib/tools";
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
      toolCalls: toolCallsBody,
      approved,
      stream: streamRequest,
    } = body as {
      folderPath: string;
      sessionId?: string;
      toolCall?: ToolCallBody;
      toolCalls?: ToolCallBody[];
      approved: boolean;
      stream?: boolean;
    };

    if (!folderPath) {
      return NextResponse.json({ error: "folderPath is required" }, { status: 400 });
    }
    const toolCalls: ToolCallBody[] = Array.isArray(toolCallsBody) && toolCallsBody.length > 0
      ? toolCallsBody
      : toolCall && typeof toolCall === "object" && toolCall.id && toolCall.name
        ? [toolCall]
        : [];
    if (toolCalls.length === 0) {
      return NextResponse.json(
        { error: "toolCall (or toolCalls array) with id and name is required" },
        { status: 400 },
      );
    }

    logger.info("Tool fulfillment received", {
      count: toolCalls.length,
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

    const responseParts: any[] = [];
    for (const tc of toolCalls) {
      const args = (tc.args && typeof tc.args === "object")
        ? (tc.args as Record<string, unknown>)
        : {};
      const output = executeTool(tc.name, args, resolvedPath, Boolean(approved));
      const parts = convertToFunctionResponse(
        tc.name,
        tc.id,
        output,
        session.client.currentModel,
      );
      responseParts.push(...parts);
    }

    const lastTurn = session.history[session.history.length - 1];
    const lastIsModelWithAllCalls =
      lastTurn?.role === "model" &&
      toolCalls.every((tc) =>
        (lastTurn as any).parts?.some?.((p: any) => p?.functionCall?.id === tc.id),
      );
    if (!lastIsModelWithAllCalls) {
      session.history.push({
        role: "model",
        parts: toolCalls.map((tc) => ({
          functionCall: {
            id: tc.id,
            name: tc.name,
            args: (tc.args && typeof tc.args === "object") ? tc.args : {},
          },
        })),
      } as any);
      logger.info("Injected missing model turn before functionResponse", { count: toolCalls.length });
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
            logger.debug("Calling client.prompt with functionResponse", { count: toolCalls.length });
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
