import { NextRequest, NextResponse } from "next/server";
import { addTrustedFolder } from "@/lib/folders";
import { createLogger } from "@/lib/logger";
import path from "path";
import fs from "node:fs";

const logger = createLogger('Hub/API/Registry');

// ---------------------------------------------------------------------------
// POST /api/registry/add
// ---------------------------------------------------------------------------

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { folderPath } = body as { folderPath: string };

    if (!folderPath) {
      return NextResponse.json({ error: 'folderPath is required' }, { status: 400 });
    }

    const resolvedPath = path.resolve(folderPath);

    // Existence check — refuse to trust a directory that doesn't exist on disk
    if (!fs.existsSync(resolvedPath)) {
      logger.warn('Rejected trust request for nonexistent directory', { folder: resolvedPath });
      return NextResponse.json(
        { error: `Cannot trust a nonexistent directory: ${resolvedPath}` },
        { status: 400 },
      );
    }

    await addTrustedFolder(resolvedPath);

    logger.info('Folder added to trusted list', { folder: resolvedPath });
    return NextResponse.json({ success: true, folderPath: resolvedPath });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('Failed to add trusted folder', { error: message });
    return NextResponse.json(
      { error: 'Failed to add trusted folder', details: message },
      { status: 500 },
    );
  }
}
