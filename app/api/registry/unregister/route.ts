import { NextRequest, NextResponse } from "next/server";
import { registry } from "@/lib/registry";
import { removeTrustedFolder } from "@/lib/folders";
import { createLogger } from "@/lib/logger";
import path from "path";

const logger = createLogger('Hub/API/Registry');

// ---------------------------------------------------------------------------
// POST /api/registry/unregister
// ---------------------------------------------------------------------------

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { folderPath } = body as { folderPath: string };

    if (!folderPath) {
      return NextResponse.json({ error: 'folderPath is required' }, { status: 400 });
    }

    const resolvedPath = path.resolve(folderPath);

    // Step 1: Remove from disk first — this must persist even if the memory
    // purge below fails (atomic constraint).
    await removeTrustedFolder(resolvedPath);

    // Step 2: Purge from in-memory registry (best-effort after disk write).
    try {
      await registry.clearSession(resolvedPath);
    } catch (purgeErr: unknown) {
      const detail = purgeErr instanceof Error ? purgeErr.message : String(purgeErr);
      logger.warn('Memory purge failed after disk removal', { folder: resolvedPath, error: detail });
    }

    logger.info(`Unregistered and purged: ${resolvedPath}`);
    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('Failed to unregister folder', { error: message });
    return NextResponse.json(
      { error: 'Failed to unregister folder', details: message },
      { status: 500 },
    );
  }
}
