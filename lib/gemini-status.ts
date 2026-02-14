import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GeminiStatus {
  isLoggedIn: boolean;
  isCurrentFolderTrusted: boolean;
  trustedFolders: string[];
  currentPath: string;
}

/**
 * Shape of individual entries persisted in `~/.gemini/trustedFolders.json`.
 * The Gemini CLI stores entries as `{ path: string, trustLevel: string }`.
 */
interface TrustedFolderEntry {
  path: string;
  trustLevel: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const GEMINI_DIR = join(homedir(), ".gemini");
const OAUTH_CREDS_FILE = join(GEMINI_DIR, "oauth_creds.json");
const TRUSTED_FOLDERS_FILE = join(GEMINI_DIR, "trustedFolders.json");

/**
 * Reads the trusted-folders file and returns the parsed array of entries.
 * Handles both the key-value map format used by the Gemini CLI
 * (`{ "/path": "TRUST_FOLDER" }`) and a legacy array format.
 * Returns an empty array when the file does not exist or cannot be parsed.
 */
export function readTrustedFolders(): TrustedFolderEntry[] {
  try {
    if (!existsSync(TRUSTED_FOLDERS_FILE)) return [];
    const raw = readFileSync(TRUSTED_FOLDERS_FILE, "utf-8");
    const parsed: unknown = JSON.parse(raw);

    // Legacy array format: [{ path, trustLevel }]
    if (Array.isArray(parsed)) {
      return parsed as TrustedFolderEntry[];
    }

    // Key-value map format expected by the CLI: { "/path": "TRUST_FOLDER" }
    if (parsed && typeof parsed === "object") {
      return Object.entries(parsed as Record<string, string>).map(
        ([path, trustLevel]) => ({ path, trustLevel }),
      );
    }

    return [];
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

/**
 * Inspects the local `~/.gemini` directory and returns a status snapshot:
 *
 * - `isLoggedIn`              – whether `oauth_creds.json` exists.
 * - `isCurrentFolderTrusted`  – whether the current working directory has
 *                               a `TRUST_FOLDER` entry in `trustedFolders.json`.
 * - `trustedFolders`          – the list of trusted folder paths.
 * - `currentPath`             – `process.cwd()`.
 */
export function getGeminiStatus(): GeminiStatus {
  const isLoggedIn = existsSync(OAUTH_CREDS_FILE);

  const entries = readTrustedFolders();
  const trustedFolders = entries
    .filter((e) => e.trustLevel === "TRUST_FOLDER")
    .map((e) => e.path);

  const currentPath = process.cwd();
  const isCurrentFolderTrusted = trustedFolders.includes(currentPath);

  return {
    isLoggedIn,
    isCurrentFolderTrusted,
    trustedFolders,
    currentPath,
  };
}

/** Re-export the path constant so the API route can reuse it. */
export { GEMINI_DIR, TRUSTED_FOLDERS_FILE };
