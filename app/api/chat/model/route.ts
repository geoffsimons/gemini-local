import { NextRequest, NextResponse } from "next/server";
import { registry } from "@/lib/registry";
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
    await registry.setModel(resolvedPath, model, sessionId);

    logger.info('Model switched', { folder: resolvedPath, model });
    return NextResponse.json({ success: true, model });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('Failed to switch model', { error: message });
    return NextResponse.json(
      { error: 'Failed to switch model', details: message },
      { status: 500 },
    );
  }
}
