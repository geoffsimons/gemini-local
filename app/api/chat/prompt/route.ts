import { NextRequest, NextResponse } from "next/server";
import { registry } from "@/lib/registry";
import { isFolderTrusted } from "@/lib/folders";
import { createLogger } from "@/lib/logger";
import { cleanBase64, stitchImages } from "@/lib/images";
import { JsonStreamEventType } from "@google/gemini-cli-core";
import path from "path";

const logger = createLogger('Hub/API/Chat');

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ImagePayload {
  data: string;
  mimeType: string;
}

// ---------------------------------------------------------------------------
// Build the multimodal parts array (ported from legacy /chat handler)
// ---------------------------------------------------------------------------

function buildPromptParts(
  message: string | undefined,
  images: ImagePayload[] | undefined,
  compositeBase64: string | null,
) {
  const hasImages = Array.isArray(images) && images.length > 0;
  const parts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> = [];
  let finalMessage = message || 'Analyze this image.';

  if (hasImages && images.length > 1 && compositeBase64) {
    // Multiple images – stitched composite
    finalMessage += `\n\n[System: User has attached a base64 encoded image that is a composite of ${images.length} images stitched horizontally. Treat them as separate visual contexts ordered left-to-right.]`;
    parts.push({ text: finalMessage });
    parts.push({ inlineData: { mimeType: 'image/png', data: compositeBase64 } });
  } else if (hasImages && images.length === 1) {
    // Single image – pass-through
    finalMessage += '\n\n[System: User has attached a base64 encoded image for analysis.]';
    parts.push({ text: finalMessage });
    parts.push({
      inlineData: {
        mimeType: images[0].mimeType,
        data: cleanBase64(images[0].data),
      },
    });
  } else {
    // Text only
    parts.push({ text: finalMessage });
  }

  logger.debug('Final message', { finalMessage });

  return parts;
}

// ---------------------------------------------------------------------------
// POST /api/chat/prompt
// ---------------------------------------------------------------------------

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { folderPath, sessionId, message, images, ephemeral, stream: streamRequest } = body as {
      folderPath: string;
      sessionId?: string;
      message?: string;
      images?: ImagePayload[];
      ephemeral?: boolean;
      stream?: boolean;
    };

    if (!folderPath) {
      return NextResponse.json({ error: 'folderPath is required' }, { status: 400 });
    }
    if (!message && !(Array.isArray(images) && images.length > 0)) {
      return NextResponse.json({ error: 'message or images required' }, { status: 400 });
    }

    const resolvedPath = path.resolve(folderPath);

    if (!(await isFolderTrusted(resolvedPath))) {
      logger.warn('Prompt rejected: folder not trusted', { folder: resolvedPath });
      return NextResponse.json({ error: 'Folder not trusted' }, { status: 403 });
    }

    logger.info('Prompt received', { folder: resolvedPath, sessionId, ephemeral });

    const session = await registry.getSession(resolvedPath, sessionId);

    // Streaming guard: request path must match the session's authorized path (when set)
    const sessionPath = session.folderPath ?? resolvedPath;
    if (resolvedPath !== sessionPath) {
      logger.warn('Prompt rejected: folderPath does not match session', {
        requestPath: resolvedPath,
        sessionPath: session.folderPath,
      });
      return NextResponse.json({ error: 'Folder not trusted' }, { status: 403 });
    }

    // Initialise on first use (Golden Copy sequence)
    if (!session.initialized) {
      logger.info('Session not ready — initializing', { folder: resolvedPath });
      await registry.initializeSession(resolvedPath, sessionId);
    }

    await registry.ensureSessionReady(resolvedPath, sessionId);
    // Ephemeral Mode: clear history before processing if requested
    if (ephemeral) {
      await registry.resetSessionHistory(resolvedPath, sessionId);
    }

    // --- Image pre-processing (stitching) ---
    let compositeBase64: string | null = null;
    const hasMultipleImages = Array.isArray(images) && images.length > 1;
    if (hasMultipleImages) {
      logger.info(`Stitching ${images.length} images...`);
      compositeBase64 = await stitchImages(images);
    }

    // --- Build prompt parts ---
    const parts = buildPromptParts(message, images, compositeBase64);
    logger.debug(`Sending prompt: ${parts.length} part(s)`);

    // --- Explicit history: sync core with Hub-owned history; append user turn so next prompt(parts) is the only new message ---
    session.client.setHistory(session.history as any);
    const userTurn = { role: 'user' as const, parts: [...parts] };
    session.history.push(userTurn);

    // --- Mode Detection ---
    const acceptHeader = req.headers.get('accept');
    const shouldStream = streamRequest === true || acceptHeader === 'text/event-stream';

    const promptId = `prompt-${Date.now()}`;
    const abortController = new AbortController();

    const appendModelTurn = (responseText: string) => {
      session.history.push({ role: 'model', parts: [{ text: responseText }] });
    };
    const rollbackUserTurn = () => {
      if (session.history[session.history.length - 1]?.role === 'user') {
        session.history.pop();
      }
    };

    if (shouldStream) {
      const encoder = new TextEncoder();
      let bufferedResponseText = '';
      const readableStream = new ReadableStream({
        async start(controller) {
          const sendEvent = (event: object) => {
            controller.enqueue(encoder.encode(JSON.stringify(event) + '\n'));
          };

          try {
            const stream = session.client.prompt(parts, {
              signal: abortController.signal,
              promptId,
              sessionId: session.config.getSessionId(),
            });

            for await (const event of stream) {
              logger.debug('Stream event', { type: event.type });

              switch (event.type) {
                case JsonStreamEventType.INIT:
                  logger.info('Stream initialized', { model: (event as any).model });
                  sendEvent({ type: 'INIT', model: (event as any).model });
                  break;

                case JsonStreamEventType.MESSAGE:
                  if ((event as any).role === 'assistant') {
                    logger.debug('Assistant message chunk', { delta: (event as any).delta });
                  }
                  if ((event as any).content) {
                    bufferedResponseText += (event as any).content ?? '';
                    sendEvent({ type: 'MESSAGE', content: (event as any).content, delta: (event as any).delta });
                  }
                  break;

                case JsonStreamEventType.TOOL_USE:
                  logger.info('Tool use detected', { tool: (event as any).tool_name });
                  sendEvent({
                    type: 'TOOL_USE',
                    tool_name: (event as any).tool_name,
                    parameters: (event as any).parameters ?? {},
                  });
                  break;

                case JsonStreamEventType.ERROR:
                  logger.error('Stream error from model', { error: (event as any).message });
                  rollbackUserTurn();
                  sendEvent({ type: 'ERROR', message: (event as any).message });
                  break;

                case JsonStreamEventType.RESULT:
                  logger.info('Prompt completed', { status: (event as any).status });
                  appendModelTurn(bufferedResponseText);
                  sendEvent({ type: 'RESULT', stats: (event as any).stats });
                  break;
              }
            }
          } catch (err: unknown) {
            const errMsg = err instanceof Error ? err.message : String(err);
            logger.error('Stream execution failed', { error: errMsg });
            rollbackUserTurn();
            sendEvent({ type: 'ERROR', message: errMsg });
          } finally {
            controller.close();
          }
        },
      });

      return new NextResponse(readableStream, {
        headers: {
          'Content-Type': 'application/x-ndjson',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
        },
      });
    } else {
      // --- Buffered Response (Backwards Compatibility) ---
      try {
        let responseText = '';
        const stream = session.client.prompt(parts, {
          signal: abortController.signal,
          promptId,
          sessionId: session.config.getSessionId(),
        });

        for await (const event of stream) {
          if (event.type === JsonStreamEventType.MESSAGE) {
            responseText += (event as any).content || '';
          } else if (event.type === JsonStreamEventType.ERROR) {
            rollbackUserTurn();
            throw new Error((event as any).message || 'Unknown stream error');
          }
        }

        if (responseText.trim() === '') {
          rollbackUserTurn();
          throw new Error('Hub Error: CLI process returned no data.');
        }

        appendModelTurn(responseText);
        return NextResponse.json({
          response: responseText,
          model: session.client.currentModel
        });
      } catch (err: any) {
        logger.error('Buffered execution failed', { error: err.message });
        rollbackUserTurn();
        return NextResponse.json(
          { error: 'Failed to process prompt', details: err.message },
          { status: 500 }
        );
      }
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    if (message === 'Service Warming Up') {
      return NextResponse.json(
        { error: 'Service Warming Up' },
        { status: 503 },
      );
    }
    logger.error('Unhandled error in /api/chat/prompt', { error: message });
    return NextResponse.json(
      { error: 'Failed to process prompt', details: message },
      { status: 500 },
    );
  }
}
