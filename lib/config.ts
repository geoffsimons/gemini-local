import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { createLogger } from "./logger";

const log = createLogger('Hub/Config');

// ---------------------------------------------------------------------------
// Trusted Folders — persisted at ~/.gemini/trustedFolders.json
// ---------------------------------------------------------------------------

interface TrustedFoldersFile {
  folders: string[];
}

function getTrustedFoldersPath(): string {
  return join(homedir(), ".gemini", "trustedFolders.json");
}

/**
 * Returns the list of trusted folder paths from disk.
 * If the file does not exist or is malformed, returns an empty array.
 */
export function getTrustedFolders(): string[] {
  const filePath = getTrustedFoldersPath();

  if (!existsSync(filePath)) {
    log.debug('trustedFolders.json not found — returning empty list', { path: filePath });
    return [];
  }

  try {
    const raw = readFileSync(filePath, "utf-8");
    const parsed: TrustedFoldersFile = JSON.parse(raw);

    if (!Array.isArray(parsed.folders)) {
      log.warn('trustedFolders.json is malformed — expected { folders: string[] }', { path: filePath });
      return [];
    }

    return parsed.folders;
  } catch (err) {
    log.error('Failed to read trustedFolders.json', { path: filePath, error: err });
    return [];
  }
}

/**
 * Removes a single folder path from the trusted list and writes back to disk.
 * No-op if the path is not present or the file does not exist.
 */
export function removeTrustedFolder(folderPath: string): void {
  const filePath = getTrustedFoldersPath();

  if (!existsSync(filePath)) {
    log.debug('trustedFolders.json not found — nothing to remove', { path: filePath });
    return;
  }

  try {
    const raw = readFileSync(filePath, "utf-8");
    const parsed: TrustedFoldersFile = JSON.parse(raw);

    if (!Array.isArray(parsed.folders)) {
      log.warn('trustedFolders.json is malformed — skipping removal', { path: filePath });
      return;
    }

    const filtered = parsed.folders.filter((f) => f !== folderPath);

    if (filtered.length === parsed.folders.length) {
      log.debug('Folder not found in trustedFolders.json — no changes', { folderPath });
      return;
    }

    writeFileSync(filePath, JSON.stringify({ folders: filtered }, null, 2) + "\n", "utf-8");
    log.info('Removed folder from trustedFolders.json', { folderPath });
  } catch (err) {
    log.error('Failed to update trustedFolders.json', { path: filePath, error: err });
    throw err;
  }
}
