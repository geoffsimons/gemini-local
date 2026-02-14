import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  getGeminiStatus,
  GEMINI_DIR,
  TRUSTED_FOLDERS_FILE,
} from "@/lib/gemini-status";
import { getGeminiClient } from "@/lib/gemini";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// GET  /api/gemini/status
// ---------------------------------------------------------------------------

/**
 * Returns the current Gemini environment status including login state,
 * folder trust, and the list of trusted folder paths.
 */
export async function GET(): Promise<NextResponse> {
  try {
    const status = getGeminiStatus();
    return NextResponse.json(status);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to read Gemini status";
    console.error("[/api/gemini/status] GET error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// POST /api/gemini/status
// ---------------------------------------------------------------------------

interface TrustRequestBody {
  path?: string;
}

/**
 * Adds a folder path to `~/.gemini/trustedFolders.json` with value
 * `"TRUST_FOLDER"`.  The file is stored as a key-value map
 * (`{ "/path": "TRUST_FOLDER" }`) which is the format the Gemini CLI
 * expects.  Creates the directory and file if they don't already exist.
 *
 * After writing, the Gemini singleton is force-reloaded so the CLI
 * process picks up the new trust status immediately.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body = (await request.json()) as TrustRequestBody;
    const folderPath = body.path;

    if (!folderPath || typeof folderPath !== "string") {
      return NextResponse.json(
        { error: "A valid `path` string is required." },
        { status: 400 },
      );
    }

    // Ensure ~/.gemini directory exists
    if (!existsSync(GEMINI_DIR)) {
      mkdirSync(GEMINI_DIR, { recursive: true });
    }

    // ----- Read-Modify-Write with backup -----

    // Read the existing file as a key-value map (or start fresh)
    let trustedFolders: Record<string, string> = {};
    if (existsSync(TRUSTED_FOLDERS_FILE)) {
      try {
        const raw = readFileSync(TRUSTED_FOLDERS_FILE, "utf-8");
        const parsed: unknown = JSON.parse(raw);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          trustedFolders = parsed as Record<string, string>;
        }
      } catch {
        // File is corrupt or unreadable — start fresh
      }

      // Backup the original file before writing
      copyFileSync(TRUSTED_FOLDERS_FILE, `${TRUSTED_FOLDERS_FILE}.bak`);
    }

    // Only update the key for the requested folder
    trustedFolders[folderPath] = "TRUST_FOLDER";

    writeFileSync(
      TRUSTED_FOLDERS_FILE,
      JSON.stringify(trustedFolders, null, 2),
      "utf-8",
    );

    // ----- .geminiignore Provisioning (Safe & Simple) -----
    const ignoreFilePath = join(folderPath, ".geminiignore");
    if (!existsSync(ignoreFilePath)) {
      // Only ignore things that are universally irrelevant or sensitive
      const universalIgnore = [
        ".git",
        ".log",
        ".env*",
        "node_modules", // Standard for JS
        "__pycache__",  // Standard for Python
        "venv",         // Standard for Python
        ".DS_Store"     // Standard for macOS
      ].join("\n");

      writeFileSync(ignoreFilePath, universalIgnore + "\n", "utf-8");
    }

    // ----- Active Refresh -----
    // Force the singleton to reinitialize so the CLI picks up the new trust
    await getGeminiClient(true);

    // Return the refreshed status
    const status = getGeminiStatus();
    return NextResponse.json(status);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to update trusted folders";
    console.error("[/api/gemini/status] POST error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
