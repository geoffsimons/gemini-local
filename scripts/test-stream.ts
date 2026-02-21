#!/usr/bin/env node
/**
 * Validates the Gemini 3.1 Pro agentic streaming pipeline by POSTing to
 * /api/chat/prompt with stream: true and asserting INIT + MESSAGE (content) events.
 */

const folderPath = process.argv[2];
if (!folderPath) {
  console.error('Usage: npx tsx scripts/test-stream.ts <folderPath>');
  process.exit(1);
}

const PROMPT_URL = 'http://localhost:3000/api/chat/prompt';
const TIMEOUT_MS: number = 30_000;

const payload = {
  folderPath,
  message: 'What is the secret code?',
  stream: true,
  model: 'gemini-3-pro-preview',
  // model: 'gemini-3.1-pro-preview',
};

async function run(): Promise<void> {
  const ac = new AbortController();
  const timeoutId = setTimeout(() => {
    ac.abort();
  }, TIMEOUT_MS);

  let gotInit = false;
  let gotMessageWithContent = false;

  try {
    const response = await fetch(PROMPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: ac.signal,
    });

    if (!response.ok) {
      console.error(`Stream test failed: HTTP ${response.status}`);
      process.exit(1);
    }

    const reader = response.body?.getReader();
    if (!reader) {
      console.error('Stream test failed: no response body');
      process.exit(1);
    }

    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        const json = trimmed.startsWith('data: ') ? trimmed.slice(6).trim() : trimmed;
        if (json === '[DONE]' || json === '') continue;
        try {
          const event = JSON.parse(json) as { type?: string; content?: unknown };
          const t = event.type?.toUpperCase();
          if (t === 'INIT') gotInit = true;
          if (t === 'MESSAGE' && event.content != null) gotMessageWithContent = true;
        } catch {
          // ignore non-JSON lines
        }
      }
    }

    // drain remainder
    const remainder = buffer.trim();
    if (remainder) {
      const json = remainder.startsWith('data: ') ? remainder.slice(6).trim() : remainder;
      if (json !== '[DONE]' && json !== '') {
        try {
          const event = JSON.parse(json) as { type?: string; content?: unknown };
          const t = event.type?.toUpperCase();
          if (t === 'INIT') gotInit = true;
          if (t === 'MESSAGE' && event.content != null) gotMessageWithContent = true;
        } catch {
          // ignore
        }
      }
    }

  } finally {
    clearTimeout(timeoutId);
  }

  if (gotInit && gotMessageWithContent) {
    process.exit(0);
  }
  console.error(
    `Stream validation failed: INIT=${gotInit} MESSAGE(content)=${gotMessageWithContent}`,
  );
  process.exit(1);
}

run().catch((err) => {
  if (err?.name === 'AbortError') {
    console.error('Stream test failed: 30s timeout');
  } else {
    console.error('Stream test failed:', err?.message ?? err);
  }
  process.exit(1);
});

export {};
