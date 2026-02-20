import { NextRequest, NextResponse } from "next/server";
import { registry } from "@/lib/registry";
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
    const { folderPath, sessionId, message, images, ephemeral } = body as {
      folderPath: string;
      sessionId?: string;
      message?: string;
      images?: ImagePayload[];
      ephemeral?: boolean;
    };

    if (!folderPath) {
      return NextResponse.json({ error: 'folderPath is required' }, { status: 400 });
    }
    if (!message && !(Array.isArray(images) && images.length > 0)) {
      return NextResponse.json({ error: 'message or images required' }, { status: 400 });
    }

    // Resolve to an absolute path
    const resolvedPath = path.resolve(folderPath);
    logger.info('Prompt received', { folder: resolvedPath, sessionId, ephemeral });

    // Ensure the session exists in the registry
    const session = await registry.getSession(resolvedPath, sessionId);

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

    // --- Mode Detection ---
    const acceptHeader = req.headers.get('accept');
    const streamParam = req.nextUrl.searchParams.get('stream');
    const shouldStream = acceptHeader === 'text/event-stream' || streamParam === 'true';

    const promptId = `prompt-${Date.now()}`;
    const abortController = new AbortController();

    if (shouldStream) {
      const encoder = new TextEncoder();
      const readableStream = new ReadableStream({
        async start(controller) {
          const sendEvent = (event: any) => {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
          };

          try {
            const stream = session.client.sendMessageStream(
              parts,
              abortController.signal,
              promptId,
            );

            for await (const event of (stream as any)) {
              logger.debug('Stream event', { type: event.type });

              switch (event.type) {
                case JsonStreamEventType.MESSAGE:
                  if (event.content) {
                    sendEvent({ type: 'MESSAGE', content: event.content, delta: event.delta });
                  }
                  break;

                case JsonStreamEventType.TOOL_USE:
                  logger.info('Tool use detected', { tool: event.tool_name });
                  sendEvent({
                    type: 'THOUGHT',
                    content: `[Tool Use: ${event.tool_name}] executing with parameters...`,
                  });
                  break;

                case JsonStreamEventType.ERROR:
                  logger.error('Stream error from model', { error: event.message });
                  sendEvent({ type: 'ERROR', message: event.message });
                  break;

                case JsonStreamEventType.RESULT:
                  logger.info('Prompt completed', { status: event.status });
                  sendEvent({ type: 'RESULT', stats: event.stats });
                  break;
              }
            }
          } catch (err: any) {
            logger.error('Stream execution failed', { error: err.message });
            sendEvent({ type: 'ERROR', message: err.message });
          } finally {
            controller.close();
          }
        },
      });

      return new NextResponse(readableStream, {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
        },
      });
    } else {
      // --- Buffered Response (Backwards Compatibility) ---
      let responseText = '';
      try {
        const stream = session.client.sendMessageStream(
          parts,
          abortController.signal,
          promptId,
        );

        for await (const event of (stream as any)) {
          if (event.type === JsonStreamEventType.MESSAGE) {
            responseText += event.content;
          } else if (event.type === JsonStreamEventType.ERROR) {
            throw new Error(event.message);
          }
        }

        if (responseText.trim() === '') {
          throw new Error('Hub Error: CLI process returned no data.');
        }

        return NextResponse.json({
          response: responseText,
          model: session.client.currentModel
        });
      } catch (err: any) {
        logger.error('Buffered execution failed', { error: err.message });
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
