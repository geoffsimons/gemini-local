#!/usr/bin/env node
/**
 * Validates autonomous YOLO tool use: one POST to /api/chat/prompt with stream: true.
 * The server runs tools inside a single NDJSON stream (no /api/chat/tool round-trip).
 * Pass: MESSAGE content includes the secret code and at least one TOOL_USE or THOUGHT
 * event was observed on the stream.
 */

import * as fs from "fs";
import * as path from "path";
import { env } from "node:process";

const folderPath = process.argv[2];
if (!folderPath) {
  console.error("Usage: npx tsx scripts/test-tools.ts <folderPath>");
  process.exit(1);
}

const HUB_PORT = Number(env.GEMINI_HUB_PORT) || 2999;
const PROMPT_URL = `http://localhost:${HUB_PORT}/api/chat/prompt`;
const TIMEOUT_MS = 60_000;

const randomSuffix = Math.random().toString(36).substring(7);
const testFilename = `tmp_${randomSuffix}.md`;
const secretCode = `SECRET_CODE_${Date.now()}`;
const testFilePath = path.join(folderPath, testFilename);

interface StreamEvent {
  type?: string;
  content?: string;
  delta?: boolean;
}

function parseStreamLine(trimmed: string): StreamEvent | null {
  const json = trimmed.startsWith("data: ")
    ? trimmed.slice(6).trim()
    : trimmed;
  if (json === "[DONE]" || json === "") return null;
  try {
    return JSON.parse(json) as StreamEvent;
  } catch {
    return null;
  }
}

function processStreamEvent(
  event: StreamEvent,
  state: {
    accumulatedMessageContent: string;
    sawToolUse: boolean;
    sawThought: boolean;
  },
): void {
  const t = event.type?.toUpperCase();
  if (t === "TOOL_USE") {
    state.sawToolUse = true;
    return;
  }
  if (t === "THOUGHT") {
    state.sawThought = true;
    return;
  }
  if (t === "MESSAGE" && event.content != null) {
    const chunk = String(event.content);
    if (event.delta) {
      state.accumulatedMessageContent += chunk;
    } else {
      state.accumulatedMessageContent = chunk;
    }
  }
}

async function run(): Promise<number> {
  const ac = new AbortController();
  const timeoutId = setTimeout(() => ac.abort(), TIMEOUT_MS);

  try {
    fs.writeFileSync(testFilePath, secretCode, "utf8");
  } catch (err) {
    clearTimeout(timeoutId);
    console.error("Failed to write test file:", (err as Error).message);
    return 1;
  }

  const payload = {
    folderPath,
    message:
      "Hey, I just dropped a temporary markdown file somewhere in this folder. It has a weird, random alphanumeric name. Could you search the directory, find that file, read it, and tell me the secret code hidden inside?",
    stream: true,
    model: "gemini-2.5-flash",
  };

  const state = {
    accumulatedMessageContent: "",
    sawToolUse: false,
    sawThought: false,
  };

  try {
    const res = await fetch(PROMPT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: ac.signal,
    });

    if (!res.ok) {
      console.error("Tool execution test failed: HTTP", res.status);
      return 1;
    }

    const reader = res.body?.getReader();
    if (!reader) {
      console.error("Tool execution test failed: no response body");
      return 1;
    }

    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        const event = parseStreamLine(trimmed);
        if (event) processStreamEvent(event, state);
      }
    }

    const remainder = buffer.trim();
    if (remainder) {
      const event = parseStreamLine(remainder);
      if (event) processStreamEvent(event, state);
    }

    const hasSecret = state.accumulatedMessageContent.includes(secretCode);
    const sawAgentic = state.sawToolUse || state.sawThought;

    if (hasSecret && sawAgentic) {
      console.log(
        "Tool execution test passed: secret code in message and tool/thought activity observed.",
      );
      return 0;
    }

    console.error(
      "Tool execution test failed:",
      `secretInMessage=${hasSecret}`,
      `sawToolUse=${state.sawToolUse}`,
      `sawThought=${state.sawThought}`,
      `contentPreview=${JSON.stringify(state.accumulatedMessageContent.slice(0, 400))}`,
    );
    return 1;
  } catch (err: unknown) {
    const e = err as { name?: string; message?: string };
    if (e?.name === "AbortError") {
      console.error("Tool execution test failed: timeout");
    } else {
      console.error("Tool execution test failed:", e?.message ?? err);
    }
    return 1;
  } finally {
    clearTimeout(timeoutId);
    try {
      fs.unlinkSync(testFilePath);
    } catch {
      // ignore cleanup errors
    }
  }
}

run()
  .then((code) => process.exit(code))
  .catch((err) => {
    try {
      fs.unlinkSync(testFilePath);
    } catch {
      // ignore
    }
    console.error("Tool execution test failed:", err?.message ?? err);
    process.exit(1);
  });

export {};
