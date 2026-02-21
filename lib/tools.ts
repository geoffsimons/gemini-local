import { readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import path from "path";

/**
 * Execute a single tool server-side; returns string for FunctionResponse output.
 * Shared by /api/chat/prompt (YOLO) and /api/chat/tool (approval).
 */
export function executeTool(
  toolName: string,
  args: Record<string, unknown>,
  folderPath: string,
  approved: boolean,
): string {
  if (!approved) {
    return "User rejected the tool call.";
  }

  const root = resolve(folderPath);

  switch (toolName) {
    case "read_file": {
      const p = args.path ?? args.file;
      const relPath = typeof p === "string" ? p : String(p ?? "");
      if (!relPath) return "Error: missing path argument.";
      const fullPath = path.isAbsolute(relPath) ? relPath : join(root, relPath);
      const resolved = resolve(fullPath);
      if (!resolved.startsWith(root)) {
        return "Error: path is outside project directory.";
      }
      if (!existsSync(resolved)) {
        return `Error: file not found: ${relPath}`;
      }
      try {
        return readFileSync(resolved, "utf-8");
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return `Error reading file: ${msg}`;
      }
    }
    default:
      return `Tool "${toolName}" is not implemented for approval flow.`;
  }
}
