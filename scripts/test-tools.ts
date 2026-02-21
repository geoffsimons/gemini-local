#!/usr/bin/env node
/**
 * Validates multi-step tool execution: dynamic test file, human-like prompt,
 * and sequential approval loop (prompt stream -> TOOL_USE -> POST /api/chat/tool -> resume stream).
 * Success: MESSAGE content includes the generated secret code.
 */

import * as fs from "fs";
import * as path from "path";

const folderPath = process.argv[2];
if (!folderPath) {
  console.error("Usage: npx tsx scripts/test-tools.ts <folderPath>");
  process.exit(1);
}

const PROMPT_URL = "http://localhost:3000/api/chat/prompt";
const TOOL_URL = "http://localhost:3000/api/chat/tool";
const TIMEOUT_MS = 60_000;
const MAX_TOOL_ROUNDS = 10;

const randomSuffix = Math.random().toString(36).substring(7);
const testFilename = `tmp_${randomSuffix}.md`;
const secretCode = `SECRET_CODE_${Date.now()}`;
const testFilePath = path.join(folderPath, testFilename);

interface ToolCallCollected {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

interface StreamEvent {
  type?: string;
  content?: string;
  tool_id?: string;
  tool_name?: string;
  parameters?: Record<string, unknown>;
}

function drainNdjsonBuffer(
  buffer: string,
  decoder: (line: string) => void,
): string {
  const lines = buffer.split("\n");
  const remainder = lines.pop() ?? "";
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      decoder(trimmed);
    } catch {
      // ignore
    }
  }
  return remainder;
}

async function run(): Promise<void> {
  const ac = new AbortController();
  const timeoutId = setTimeout(() => ac.abort(), TIMEOUT_MS);

  try {
    fs.writeFileSync(testFilePath, secretCode, "utf8");
  } catch (err) {
    console.error("Failed to write test file:", (err as Error).message);
    process.exit(1);
  }

  try {
    const decoder = new TextDecoder();
    let accumulatedMessageContent = "";
    let streamSource: "prompt" | "tool" = "prompt";
    let pendingTools: ToolCallCollected[] = [];
    let rounds = 0;
    let success = false;
    let failReason: string | null = null;

    while (true) {
      let res: Response;
      if (streamSource === "prompt") {
        res = await fetch(PROMPT_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            folderPath,
            message:
              "Hey, I just dropped a temporary markdown file somewhere in this folder. It has a weird, random alphanumeric name. Could you search the directory, find that file, read it, and tell me the secret code hidden inside?",
            stream: true,
            model: "gemini-3-pro-preview",
          }),
          signal: ac.signal,
        });
        streamSource = "tool";
      } else {
        if (pendingTools.length === 0) {
          failReason =
            "Stream ended without TOOL_USE and message did not contain secret. " +
            `Accumulated content (first 500 chars): ${accumulatedMessageContent.slice(0, 500)}`;
          break;
        }
        if (rounds >= MAX_TOOL_ROUNDS) {
          failReason = `Exceeded ${MAX_TOOL_ROUNDS} tool rounds`;
          break;
        }
        rounds += 1;
        res = await fetch(TOOL_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            folderPath,
            approved: true,
            toolCalls: pendingTools,
            stream: true,
          }),
          signal: ac.signal,
        });
        pendingTools = [];
      }

      if (!res.ok) {
        failReason = `Request failed: HTTP ${res.status}`;
        break;
      }

      const reader = res.body?.getReader();
      if (!reader) {
        failReason = "No response body";
        break;
      }

      let buffer = "";
      const collectedTools: ToolCallCollected[] = [];

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        buffer = drainNdjsonBuffer(buffer, (line) => {
          try {
            const event = JSON.parse(line) as StreamEvent;
            if (event.type === "TOOL_USE") {
              collectedTools.push({
                id: event.tool_id ?? `call-${Date.now()}`,
                name: event.tool_name ?? "",
                args: event.parameters ?? {},
              });
            }
            if (event.type === "MESSAGE" && event.content != null) {
              accumulatedMessageContent += event.content;
            }
          } catch {
            // ignore non-JSON lines
          }
        });
      }

      const remainder = buffer.trim();
      if (remainder) {
        try {
          const event = JSON.parse(remainder) as StreamEvent;
          if (event.type === "TOOL_USE") {
            collectedTools.push({
              id: event.tool_id ?? `call-${Date.now()}`,
              name: event.tool_name ?? "",
              args: event.parameters ?? {},
            });
          }
          if (event.type === "MESSAGE" && event.content != null) {
            accumulatedMessageContent += event.content;
          }
        } catch {
          // ignore
        }
      }

      if (accumulatedMessageContent.includes(secretCode)) {
        success = true;
        break;
      }

      pendingTools = collectedTools;
    }

    if (failReason != null) {
      console.error("Tool execution test failed:", failReason);
      process.exit(1);
    }
    if (success) {
      console.log("Tool execution test passed: secret code found in message.");
      process.exit(0);
    }
  } finally {
    clearTimeout(timeoutId);
    try {
      fs.unlinkSync(testFilePath);
    } catch {
      // ignore cleanup errors
    }
  }
}

run().catch((err) => {
  try {
    fs.unlinkSync(testFilePath);
  } catch {
    // ignore
  }
  if (err?.name === "AbortError") {
    console.error("Tool execution test failed: 60s timeout");
  } else {
    console.error("Tool execution test failed:", err?.message ?? err);
  }
  process.exit(1);
});

export {};
