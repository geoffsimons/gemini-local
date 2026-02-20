import { NextRequest, NextResponse } from "next/server";
import { registry, DEFAULT_GEMINI_MODEL } from "@/lib/registry";
import { createLogger } from "@/lib/logger";
import path from "path";

const logger = createLogger('Hub/API/Chat');

// ---------------------------------------------------------------------------
// GET /api/chat/status?folderPath=...&sessionId=...
// ---------------------------------------------------------------------------

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const folderPath = searchParams.get('folderPath');

    if (!folderPath) {
      return NextResponse.json({ error: 'folderPath query param is required' }, { status: 400 });
    }

    const resolvedPath = path.resolve(folderPath);
    const status = registry.getStatus(resolvedPath);

    logger.debug('Status check', { folder: resolvedPath, ...status });
    return NextResponse.json({
      folderPath: resolvedPath,
      ready: status.isReady,
      isWarm: status.isReady,
      currentModel: status.currentModel ?? DEFAULT_GEMINI_MODEL,
      sessionId: status.sessionId
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('Status check failed', { error: message });
    return NextResponse.json(
      { error: 'Failed to check status', details: message },
      { status: 500 },
    );
  }
}
