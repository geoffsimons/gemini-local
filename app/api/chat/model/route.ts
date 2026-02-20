import { NextRequest, NextResponse } from "next/server";
import { setModelForSession } from "@/lib/registry";
import { createLogger } from "@/lib/logger";
import path from "path";

const logger = createLogger('Hub/API/Chat/Model');

/**
 * POST /api/chat/model
 * Switches the model for a specific project session.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { folderPath, sessionId, model } = body as {
      folderPath: string;
      sessionId?: string;
      model: string;
    };

    if (!folderPath) {
      return NextResponse.json({ error: 'folderPath is required' }, { status: 400 });
    }
    if (!model) {
      return NextResponse.json({ error: 'model is required' }, { status: 400 });
    }

    const resolvedPath = path.resolve(folderPath);

    try {
      await setModelForSession(resolvedPath, model, sessionId);
      logger.info('Model switched with history handover', { folder: resolvedPath, model });
      return NextResponse.json({ success: true, model });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes('does not exist')) {
        return NextResponse.json({ error: 'Session not found for folder' }, { status: 404 });
      }
      logger.error('Failed to switch model (CLI/Google SDK failure)', { error: message, folder: resolvedPath, model });
      return NextResponse.json(
        { error: 'Failed to switch model', details: message },
        { status: 502 },
      );
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('Internal Server Error during model switch', { error: message });
    return NextResponse.json(
      { error: 'Internal Server Error', details: message },
      { status: 500 },
    );
  }
}
