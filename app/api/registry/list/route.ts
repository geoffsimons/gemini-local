import { NextResponse } from "next/server";
import { registry } from "@/lib/registry";
import { getTrustedFolders } from "@/lib/folders";
import { createLogger } from "@/lib/logger";

const logger = createLogger('Hub/API/Registry');

// ---------------------------------------------------------------------------
// GET /api/registry/list
// ---------------------------------------------------------------------------

export async function GET() {
  try {
    const folders = await getTrustedFolders();

    const entries = folders.map((folderPath) => {
      const status = registry.getStatus(folderPath);
      return {
        path: folderPath,
        isReady: status.isReady,
      };
    });

    logger.info('Registry list requested', { count: entries.length });
    return NextResponse.json({ folders: entries });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('Failed to list registry entries', { error: message });
    return NextResponse.json(
      { error: 'Failed to list registry entries', details: message },
      { status: 500 },
    );
  }
}
