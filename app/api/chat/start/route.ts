import { NextRequest, NextResponse } from "next/server";
import { existsSync } from "node:fs";
import { registry, DEFAULT_GEMINI_MODEL } from "@/lib/registry";
import { isFolderTrusted, addTrustedFolder } from "@/lib/folders";
import { createLogger } from "@/lib/logger";
import path from "path";

const logger = createLogger('Hub/API/Chat');

// ---------------------------------------------------------------------------
// POST /api/chat/start — Explicit warm-up
// ---------------------------------------------------------------------------

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { folderPath, sessionId, model } = body as {
      folderPath: string;
      sessionId?: string;
      model?: string;
    };
    const effectiveModel = model ?? DEFAULT_GEMINI_MODEL;

    if (!folderPath) {
      return NextResponse.json({ error: 'folderPath is required' }, { status: 400 });
    }

    const resolvedPath = path.resolve(folderPath);

    // 1. Gatekeeper — trust check first; no client or session for untrusted paths
    if (!(await isFolderTrusted(resolvedPath))) {
      logger.warn('Rejected start: folder not trusted', { folder: resolvedPath });
      return NextResponse.json({ error: 'Folder not trusted' }, { status: 403 });
    }

    // Ensure path is persisted in trust list (idempotent) so subsequent requests see it
    await addTrustedFolder(resolvedPath);

    logger.info('Start (warm-up) requested', { folder: resolvedPath, sessionId });

    // 2. Existence check
    if (!existsSync(resolvedPath)) {
      logger.warn('Rejected ghost folder', { folder: resolvedPath });
      return NextResponse.json(
        { error: `Directory does not exist: ${resolvedPath}` },
        { status: 400 },
      );
    }

    // 3. Initialization — create session entry then initialise
    await registry.getSession(resolvedPath, sessionId, effectiveModel);
    await registry.initializeSession(resolvedPath, sessionId, effectiveModel);

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
