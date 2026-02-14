import { NextRequest, NextResponse } from "next/server";
import { registry } from "@/lib/registry";
import { createLogger } from "@/lib/logger";
import path from "path";

const logger = createLogger('Hub/API/Clear');

// ---------------------------------------------------------------------------
// POST /api/chat/clear
// ---------------------------------------------------------------------------

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { folderPath, sessionId } = body as {
      folderPath: string;
      sessionId?: string;
    };

    if (!folderPath) {
      return NextResponse.json({ error: 'folderPath is required' }, { status: 400 });
    }

    const resolvedPath = path.resolve(folderPath);
    logger.info('Clear requested', { folder: resolvedPath, sessionId });

    await registry.clearSession(resolvedPath, sessionId);

    logger.info('Session history cleared', { folder: resolvedPath });
    return NextResponse.json({ success: true, message: "Session history cleared" });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('Unhandled error in /api/chat/clear', { error: message });
    return NextResponse.json(
      { error: 'Failed to clear session', details: message },
      { status: 500 },
    );
  }
}
