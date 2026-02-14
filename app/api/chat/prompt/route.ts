import { NextRequest, NextResponse } from "next/server";
import { registry } from "@/lib/registry";
import { createLogger } from "@/lib/logger";
import { cleanBase64, stitchImages } from "@/lib/images";
import { GeminiEventType } from "@google/gemini-cli-core";
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

  return parts;
}

// ---------------------------------------------------------------------------
// POST /api/chat/prompt
// ---------------------------------------------------------------------------

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { folderPath, sessionId, message, images } = body as {
      folderPath: string;
      sessionId?: string;
      message?: string;
      images?: ImagePayload[];
    };

    if (!folderPath) {
      return NextResponse.json({ error: 'folderPath is required' }, { status: 400 });
    }
    if (!message && !(Array.isArray(images) && images.length > 0)) {
      return NextResponse.json({ error: 'message or images required' }, { status: 400 });
    }

    // Resolve to an absolute path
    const resolvedPath = path.resolve(folderPath);
    logger.info('Prompt received', { folder: resolvedPath, sessionId });

    // Ensure the session exists in the registry
    const session = await registry.getSession(resolvedPath);

    // Initialise on first use (Golden Copy sequence)
    if (!session.initialized) {
      logger.info('Session not ready — initializing', { folder: resolvedPath });
      await registry.initializeSession(resolvedPath);
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

    // --- Send message & aggregate (ported aggregation logic) ---
    const promptId = `prompt-${Date.now()}`;
    const abortController = new AbortController();

    const stream = session.client.sendMessageStream(
      parts,
      abortController.signal,
      promptId,
    );

    let responseText = '';
    for await (const event of stream) {
      if (event.type === GeminiEventType.Content) {
        responseText += event.value;
      } else if (event.type === GeminiEventType.Error) {
        const errMsg = event.value.error.message;
        logger.error('Stream error from model', { error: errMsg });
        return NextResponse.json(
          { error: 'Model returned an error', details: errMsg },
          { status: 500 },
        );
      }
    }

    logger.info('Prompt completed', { chars: responseText.length });
    return NextResponse.json({ response: responseText });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('Unhandled error in /api/chat/prompt', { error: message });
    return NextResponse.json(
      { error: 'Failed to process prompt', details: message },
      { status: 500 },
    );
  }
}
