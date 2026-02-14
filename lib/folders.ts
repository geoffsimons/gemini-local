import { readFile, writeFile, access } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { createLogger } from "./logger";

const log = createLogger('Hub/Folders');

// ---------------------------------------------------------------------------
// Trusted Folders — persisted at ~/.gemini/trustedFolders.json
//
// On-disk format:  { [absolutePath: string]: "TRUST_FOLDER" }
// ---------------------------------------------------------------------------

type TrustedFoldersMap = Record<string, "TRUST_FOLDER">;

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

/** Serialize and write the map back to disk with 2-space indent + trailing newline. */
async function writeTrustedMap(filePath: string, map: TrustedFoldersMap): Promise<void> {
  await writeFile(filePath, JSON.stringify(map, null, 2) + "\n", "utf-8");
}

/**
 * Reads the trusted-folders map from disk.
 *
 * If the file contains the legacy array format (`{ folders: string[] }`),
 * it is automatically converted to the object-map format and written back.
 */
async function readTrustedMap(filePath: string): Promise<TrustedFoldersMap> {
  const raw = await readFile(filePath, "utf-8");
  const parsed = JSON.parse(raw);

  // --- Self-healing: migrate legacy array format --------------------------
  if (parsed && Array.isArray(parsed.folders)) {
    log.warn('[Hub/Folders] Detected legacy array format in trustedFolders.json. Converting to object map.');
    const migrated: TrustedFoldersMap = {};
    for (const folder of parsed.folders as string[]) {
      migrated[folder] = "TRUST_FOLDER";
    }
    await writeTrustedMap(filePath, migrated);
    return migrated;
  }

  // Normal path — already an object map
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    return parsed as TrustedFoldersMap;
  }

  log.warn('trustedFolders.json is malformed — returning empty map', { path: filePath });
  return {};
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
    const map = await readTrustedMap(filePath);
    return Object.keys(map);
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
  let map: TrustedFoldersMap = {};

  if (await fileExists(filePath)) {
    try {
      map = await readTrustedMap(filePath);
    } catch (err) {
      log.error('Failed to read trustedFolders.json — starting fresh', { path: filePath, error: err });
    }
  }

  if (map[folderPath] === "TRUST_FOLDER") {
    log.debug('Folder already in trusted list — no changes', { folderPath });
    return;
  }

  map[folderPath] = "TRUST_FOLDER";
  await writeTrustedMap(filePath, map);
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
    const map = await readTrustedMap(filePath);

    if (!(folderPath in map)) {
      log.debug('Folder not found in trustedFolders.json — no changes', { folderPath });
      return;
    }

    delete map[folderPath];
    await writeTrustedMap(filePath, map);
    log.info('Removed folder from trustedFolders.json', { folderPath });
  } catch (err) {
    log.error('Failed to update trustedFolders.json', { path: filePath, error: err });
    throw err;
  }
}
