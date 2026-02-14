import { NextRequest, NextResponse } from "next/server";
import { registry } from "@/lib/registry";
import { addTrustedFolder } from "@/lib/folders";
import { createLogger } from "@/lib/logger";
import path from "path";

const logger = createLogger('Hub/API/Chat');

// ---------------------------------------------------------------------------
// POST /api/chat/start — Explicit warm-up
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
    logger.info('Start (warm-up) requested', { folder: resolvedPath, sessionId });

    // Auto-Trust Policy: ensure the folder is in the trusted list before initialising.
    await addTrustedFolder(resolvedPath);

    // Ensure the session entry exists before initialising
    await registry.getSession(resolvedPath);
    await registry.initializeSession(resolvedPath);

    logger.info('Session warmed up', { folder: resolvedPath });
    return NextResponse.json({ status: 'ready', folderPath: resolvedPath });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('Failed to start session', { error: message });
    return NextResponse.json(
      { error: 'Failed to start session', details: message },
      { status: 500 },
    );
  }
}
