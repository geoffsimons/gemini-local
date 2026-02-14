import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getGeminiClient } from "@/lib/gemini";
import { stitchImages } from "@/lib/image";
import { GeminiEventType } from "@google/gemini-cli-core";
import type { Part } from "@google/genai";

interface ImagePayload {
  data: string;
  mimeType: string;
}

interface ChatRequestBody {
  message?: string;
  images?: ImagePayload[];
}

/**
 * POST /api/chat
 *
 * Accepts a message and optional images, sends them to the persistent
 * Gemini CLI session, and returns the full text response.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body = (await request.json()) as ChatRequestBody;
    const { message = "", images = [] } = body;

    if (!message && images.length === 0) {
      return NextResponse.json(
        { error: "Either message or images must be provided." },
        { status: 400 },
      );
    }

    const client = await getGeminiClient();

    // Build the parts array for the request
    const parts: Part[] = [];

    // Handle image attachment(s)
    if (images.length > 1) {
      // Stitch multiple images into a single composite
      const stitchedBase64 = await stitchImages(images);
      const systemHint = `[System: User has attached a composite image containing ${images.length} images stitched horizontally. Treat them as left-to-right visual contexts.]`;

      parts.push({ text: systemHint });
      if (message) {
        parts.push({ text: message });
      }
      parts.push({
        inlineData: {
          mimeType: "image/png",
          data: stitchedBase64,
        },
      });
    } else if (images.length === 1) {
      // Single image attachment
      const systemHint =
        "[System: User has attached a base64 encoded image for analysis.]";
      const cleanedData = images[0].data.includes(",")
        ? images[0].data.split(",")[1]
        : images[0].data;

      parts.push({ text: systemHint });
      if (message) {
        parts.push({ text: message });
      }
      parts.push({
        inlineData: {
          mimeType: images[0].mimeType || "image/png",
          data: cleanedData,
        },
      });
    } else {
      // Text-only message
      parts.push({ text: message });
    }

    // Send to Gemini and collect the full response
    const abortController = new AbortController();
    const promptId = `chat-${Date.now()}`;
    let responseText = "";

    const stream = client.sendMessageStream(
      parts,
      abortController.signal,
      promptId,
    );

    for await (const event of stream) {
      if (event.type === GeminiEventType.Content) {
        responseText += event.value;
      }
      if (event.type === GeminiEventType.Error) {
        const errorMsg =
          event.value?.error?.message ?? "Unknown Gemini error";
        return NextResponse.json({ error: errorMsg }, { status: 500 });
      }
    }

    return NextResponse.json({ response: responseText });
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Internal server error";
    console.error("[/api/chat] Error:", errorMessage);
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}
