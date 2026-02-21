#!/usr/bin/env node
/**
 * Validates the Human-in-the-Loop tool execution flow:
 * - Phase A: POST /api/chat/prompt with stream: true; assert stream yields TOOL_USE, capture it.
 * - Fulfillment loop: POST /api/chat/tool with the captured toolCall (stream: true). Consume stream;
 *   accumulate MESSAGE content; if stream yields another TOOL_USE, capture and fulfill again (max rounds).
 * - Assert accumulated MESSAGE content eventually includes BLUE_MONKEY.
 */

const folderPath = process.argv[2];
if (!folderPath) {
  console.error('Usage: npx tsx scripts/test-tools.ts <folderPath>');
  process.exit(1);
}

const PROMPT_URL = 'http://localhost:3000/api/chat/prompt';
const TOOL_URL = 'http://localhost:3000/api/chat/tool';
const TIMEOUT_MS = 30_000;
const MAX_TOOL_ROUNDS = 5;

interface ToolUseEvent {
  type: string;
  tool_id?: string;
  tool_name?: string;
  parameters?: Record<string, unknown>;
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
  const lines = buffer.split('\n');
  const remainder = lines.pop() ?? '';
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

  let pendingTool: {
    id: string;
    name: string;
    args: Record<string, unknown>;
  } | null = null;
  let messageContent = '';
  const decoder = new TextDecoder();

  try {
    // --- Phase A: Interception (prompt stream yields first TOOL_USE) ---
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

    let buffer = '';
    while (true) {
      const { done, value } = await promptReader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      buffer = drainNdjsonBuffer(buffer, (line) => {
        try {
          const event = JSON.parse(line) as ToolUseEvent;
          if (event.type === 'TOOL_USE') {
            pendingTool = {
              id: event.tool_id ?? `call-${Date.now()}`,
              name: event.tool_name ?? '',
              args: event.parameters ?? {},
            };
          }
        } catch {
          // ignore non-JSON lines
        }
      });
    }
    const phaseARemainder = buffer.trim();
    if (phaseARemainder) {
      try {
        const event = JSON.parse(phaseARemainder) as ToolUseEvent;
        if (event.type === 'TOOL_USE') {
          pendingTool = {
            id: event.tool_id ?? `call-${Date.now()}`,
            name: event.tool_name ?? '',
            args: event.parameters ?? {},
          };
        }
      } catch {
        // ignore
      }
    }

    if (!pendingTool?.name) {
      console.error('Phase A failed: stream did not yield TOOL_USE with tool_name');
      process.exit(1);
    }

    // --- Fulfillment loop: fulfill each TOOL_USE; if stream yields another TOOL_USE, fulfill again ---
    for (let round = 0; round < MAX_TOOL_ROUNDS && pendingTool; round++) {
      let args = pendingTool.args;
      if (pendingTool.name === 'read_file') {
        const hasPath = args.path != null || args.file != null;
        if (!hasPath) {
          args = { ...args, path: 'GEMINI.md' };
        }
      }

      const toolRes = await fetch(TOOL_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          folderPath,
          approved: true,
          toolCall: { id: pendingTool.id, name: pendingTool.name, args },
          stream: true,
        }),
        signal: ac.signal,
      });

      if (!toolRes.ok) {
        console.error(`Fulfillment failed: HTTP ${toolRes.status}`);
        process.exit(1);
      }

      const toolReader = toolRes.body?.getReader();
      if (!toolReader) {
        console.error('Fulfillment failed: no response body');
        process.exit(1);
      }

      pendingTool = null;
      buffer = '';

      while (true) {
        const { done, value } = await toolReader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        buffer = drainNdjsonBuffer(buffer, (line) => {
          try {
            const event = JSON.parse(line) as StreamEvent;
            if (event.type === 'MESSAGE' && event.content != null) {
              messageContent += event.content;
            }
            if (event.type === 'TOOL_USE') {
              pendingTool = {
                id: event.tool_id ?? `call-${Date.now()}`,
                name: event.tool_name ?? '',
                args: event.parameters ?? {},
              };
            }
          } catch {
            // ignore non-JSON lines
          }
        });
      }

      const rem = buffer.trim();
      if (rem) {
        try {
          const event = JSON.parse(rem) as StreamEvent;
          if (event.type === 'MESSAGE' && event.content != null) {
            messageContent += event.content;
          }
          if (event.type === 'TOOL_USE') {
            pendingTool = {
              id: event.tool_id ?? `call-${Date.now()}`,
              name: event.tool_name ?? '',
              args: event.parameters ?? {},
            };
          }
        } catch {
          // ignore
        }
      }
    }

    if (!messageContent.includes('BLUE_MONKEY')) {
      console.error('Tool execution test failed: MESSAGE content did not include BLUE_MONKEY');
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

export {};
