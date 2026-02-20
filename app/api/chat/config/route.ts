import { NextRequest, NextResponse } from "next/server";
import { registry } from "@/lib/registry";
import { createLogger } from "@/lib/logger";
import path from "path";

const logger = createLogger('Hub/API/ChatConfig');

// ---------------------------------------------------------------------------
// GET /api/chat/config?folderPath=...&sessionId=...
// ---------------------------------------------------------------------------

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const folderPath = searchParams.get('folderPath');
    const sessionId = searchParams.get('sessionId') ?? undefined;

    if (!folderPath) {
      return NextResponse.json({ error: 'folderPath is required' }, { status: 400 });
    }

    const resolvedPath = path.resolve(folderPath);
    const yoloMode = registry.getYoloMode(resolvedPath, sessionId);

    return NextResponse.json({ yoloMode });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('Config GET failed', { error: message });
    return NextResponse.json(
      { error: 'Failed to get config', details: message },
      { status: 500 },
    );
  }
}

// ---------------------------------------------------------------------------
// PATCH /api/chat/config — body: { folderPath, sessionId?, yoloMode }
// ---------------------------------------------------------------------------

export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json();
    const { folderPath, sessionId, yoloMode } = body as {
      folderPath: string;
      sessionId?: string;
      yoloMode: boolean;
    };

    if (!folderPath) {
      return NextResponse.json({ error: 'folderPath is required' }, { status: 400 });
    }
    if (typeof yoloMode !== 'boolean') {
      return NextResponse.json({ error: 'yoloMode must be a boolean' }, { status: 400 });
    }

    const resolvedPath = path.resolve(folderPath);
    await registry.setYoloMode(resolvedPath, yoloMode, sessionId);

    return NextResponse.json({ success: true, yoloMode });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('Config PATCH failed', { error: message });
    return NextResponse.json(
      { error: 'Failed to update config', details: message },
      { status: 500 },
    );
  }
}
