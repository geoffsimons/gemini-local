#!/usr/bin/env node
/**
 * Validates the Human-in-the-Loop tool execution flow:
 * Phase A: POST /api/chat/prompt with stream: true, assert TOOL_USE then stream closes.
 * Phase B: POST /api/chat/tool with the captured toolCall and stream: true, assert MESSAGE contains BLUE_MONKEY.
 */

const folderPath = process.argv[2];
if (!folderPath) {
  console.error('Usage: npx tsx scripts/test-tools.ts <folderPath>');
  process.exit(1);
}

const PROMPT_URL = 'http://localhost:3000/api/chat/prompt';
const TOOL_URL = 'http://localhost:3000/api/chat/tool';
const TIMEOUT_MS = 30_000;

interface ToolUseEvent {
  type: string;
  tool_id?: string;
  tool_name?: string;
  parameters?: Record<string, unknown>;
}

interface StreamEvent {
  type?: string;
  content?: string;
}

async function run(): Promise<void> {
  const ac = new AbortController();
  const timeoutId = setTimeout(() => ac.abort(), TIMEOUT_MS);

  let tool_id: string | undefined;
  let tool_name: string | undefined;
  let parameters: Record<string, unknown> = {};

  try {
    // --- Phase A: The Interception ---
    const promptRes = await fetch(PROMPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        folderPath,
        message: 'Read GEMINI.md and tell me the secret code.',
        stream: true,
        model: 'gemini-3-pro-preview',
      }),
      signal: ac.signal,
    });

    if (!promptRes.ok) {
      console.error(`Phase A failed: HTTP ${promptRes.status}`);
      process.exit(1);
    }

    const promptReader = promptRes.body?.getReader();
    if (!promptReader) {
      console.error('Phase A failed: no response body');
      process.exit(1);
    }

    const decoder = new TextDecoder();
    let buffer = '';
    let sawToolUse = false;

    while (true) {
      const { done, value } = await promptReader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const event = JSON.parse(trimmed) as ToolUseEvent;
          if (event.type === 'TOOL_USE') {
            sawToolUse = true;
            tool_id = event.tool_id;
            tool_name = event.tool_name;
            parameters = event.parameters ?? {};
          }
        } catch {
          // ignore non-JSON
        }
      }
    }

    if (!sawToolUse || !tool_name) {
      console.error('Phase A failed: stream did not yield TOOL_USE with tool_name');
      process.exit(1);
    }

    // --- Phase B: The Fulfillment ---
    const toolRes = await fetch(TOOL_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        folderPath,
        approved: true,
        toolCall: {
          id: tool_id ?? `call-${Date.now()}`,
          name: tool_name,
          args: parameters,
        },
        stream: true,
      }),
      signal: ac.signal,
    });

    if (!toolRes.ok) {
      console.error(`Phase B failed: HTTP ${toolRes.status}`);
      process.exit(1);
    }

    const toolReader = toolRes.body?.getReader();
    if (!toolReader) {
      console.error('Phase B failed: no response body');
      process.exit(1);
    }

    buffer = '';
    let messageContent = '';

    while (true) {
      const { done, value } = await toolReader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const event = JSON.parse(trimmed) as StreamEvent;
          if (event.type === 'MESSAGE' && event.content != null) {
            messageContent += event.content;
          }
        } catch {
          // ignore
        }
      }
    }

    if (!messageContent.includes('BLUE_MONKEY')) {
      console.error('Phase B failed: MESSAGE content did not include BLUE_MONKEY');
      console.error('Accumulated content (first 500 chars):', messageContent.slice(0, 500));
      process.exit(1);
    }
  } finally {
    clearTimeout(timeoutId);
  }

  process.exit(0);
}

run().catch((err) => {
  if (err?.name === 'AbortError') {
    console.error('Tool execution test failed: 30s timeout');
  } else {
    console.error('Tool execution test failed:', err?.message ?? err);
  }
  process.exit(1);
});
