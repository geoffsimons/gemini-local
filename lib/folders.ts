import { readFile, writeFile, access } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { createLogger } from "./logger";

const log = createLogger('Hub/Folders');

// ---------------------------------------------------------------------------
// Trusted Folders — persisted at ~/.gemini/trustedFolders.json
// ---------------------------------------------------------------------------

interface TrustedFoldersFile {
  folders: string[];
}

function getTrustedFoldersPath(): string {
  return join(homedir(), ".gemini", "trustedFolders.json");
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Returns the list of trusted folder paths from disk.
 * If the file does not exist or is malformed, returns an empty array.
 */
export async function getTrustedFolders(): Promise<string[]> {
  const filePath = getTrustedFoldersPath();

  if (!(await fileExists(filePath))) {
    log.debug('trustedFolders.json not found — returning empty list', { path: filePath });
    return [];
  }

  try {
    const raw = await readFile(filePath, "utf-8");
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
 * Adds a single folder path to the trusted list and writes back to disk.
 * No-op if the path is already present.
 */
export async function addTrustedFolder(folderPath: string): Promise<void> {
  const filePath = getTrustedFoldersPath();
  const existing = await getTrustedFolders();

  if (existing.includes(folderPath)) {
    log.debug('Folder already in trusted list — no changes', { folderPath });
    return;
  }

  existing.push(folderPath);
  await writeFile(filePath, JSON.stringify({ folders: existing }, null, 2) + "\n", "utf-8");
  log.info(`Added to trusted list: ${folderPath}`);
}

/**
 * Removes a single folder path from the trusted list and writes back to disk.
 * No-op if the path is not present or the file does not exist.
 */
export async function removeTrustedFolder(folderPath: string): Promise<void> {
  const filePath = getTrustedFoldersPath();

  if (!(await fileExists(filePath))) {
    log.debug('trustedFolders.json not found — nothing to remove', { path: filePath });
    return;
  }

  try {
    const raw = await readFile(filePath, "utf-8");
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

    await writeFile(filePath, JSON.stringify({ folders: filtered }, null, 2) + "\n", "utf-8");
    log.info('Removed folder from trustedFolders.json', { folderPath });
  } catch (err) {
    log.error('Failed to update trustedFolders.json', { path: filePath, error: err });
    throw err;
  }
}
