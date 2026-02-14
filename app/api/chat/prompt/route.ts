import { NextRequest, NextResponse } from "next/server";
import { registry } from "@/lib/registry";
import { createLogger } from "@/lib/logger";
import { GeminiEventType } from "@google/gemini-cli-core";
import path from "path";
import sharp from "sharp";

const logger = createLogger('Hub/API/Chat');

// ---------------------------------------------------------------------------
// Helpers ported from /legacy/gemini-serve/server.js
// ---------------------------------------------------------------------------

interface ImagePayload {
  data: string;
  mimeType: string;
}

/** Strip data-URI prefix and whitespace that would corrupt the buffer. */
function cleanBase64(data: string): string {
  let clean = data;
  if (clean.includes('base64,')) {
    clean = clean.split('base64,')[1];
  }
  return clean.replace(/\s/g, '');
}

/** Stitch multiple images into a single horizontal composite. */
async function stitchImages(images: ImagePayload[]): Promise<string> {
  // 1. Decode + normalise every image
  const assets = await Promise.all(
    images.map(async (img) => {
      const rawBuffer = Buffer.from(cleanBase64(img.data), 'base64');
      const instance = sharp(rawBuffer, { failOn: 'none' });
      const metadata = await instance.metadata();
      const cleanBuffer = await instance.toBuffer();
      return { buffer: cleanBuffer, metadata };
    }),
  );

  // 2. Canvas dimensions
  let totalWidth = 0;
  let maxHeight = 0;
  for (const img of assets) {
    totalWidth += img.metadata.width!;
    maxHeight = Math.max(maxHeight, img.metadata.height!);
  }

  // 3. Composite operations
  let currentX = 0;
  const compositeOps = assets.map((img) => {
    const op = { input: img.buffer, top: 0, left: currentX };
    currentX += img.metadata.width!;
    return op;
  });

  // 4. Render
  const stitchedBuffer = await sharp({
    create: {
      width: totalWidth,
      height: maxHeight,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
    failOn: 'none',
  })
    .composite(compositeOps)
    .png()
    .toBuffer();

  return stitchedBuffer.toString('base64');
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
      logger.info(`Stitching ${images.length} images`);
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
