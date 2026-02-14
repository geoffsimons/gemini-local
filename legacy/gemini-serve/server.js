import express from 'express';
import cors from 'cors';
import { GeminiClient, Config } from '@google/gemini-cli-core';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import sharp from 'sharp';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const port = 3000;

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

const sessions = new Map();
const defaultSessionId = 'default';

// AuthType enum values from core/contentGenerator.js
const AuthType = {
  LOGIN_WITH_GOOGLE: 'oauth-personal',
  USE_GEMINI: 'gemini-api-key',
  USE_VERTEX_AI: 'vertex-ai',
};

async function createSession(sessionId) {
  const geminiMdPath = path.resolve(__dirname, '../GEMINI.md');
  const systemMemory = await fs.readFile(geminiMdPath, 'utf-8');

  // Ensure we are using the correct model in Config
  const config = new Config({
    sessionId: sessionId,
    targetDir: path.resolve(__dirname, '..'),
    cwd: path.resolve(__dirname, '..'),
    model: 'gemini-2.5-flash',
    debugMode: false,
  });

  await config.initialize();
  await config.refreshAuth(AuthType.LOGIN_WITH_GOOGLE);

  config.setUserMemory(systemMemory);

  const client = new GeminiClient(config);
  await client.initialize();
  client.updateSystemInstruction();

  // Explicitly start the chat.
  await client.startChat();

  sessions.set(sessionId, client);
  return client;
}

// Warm up default session
createSession(defaultSessionId).catch(err => {
  console.error('Failed to initialize default session:', err);
});

// Helper: Clean Base64 string aggressively
function cleanBase64(data) {
  let clean = data;
  if (clean.includes('base64,')) {
    clean = clean.split('base64,')[1];
  }
  // CRITICAL FIX: Remove all newlines and whitespace that might break the buffer
  return clean.replace(/\s/g, '');
}

// Helper: Stitch multiple images horizontally
async function stitchImages(images) {
  try {
    // 1. Convert all base64 strings to Buffers and Normalize
    const imageAssets = await Promise.all(images.map(async (img) => {
      const rawBuffer = Buffer.from(cleanBase64(img.data), 'base64');

      // CRITICAL FIX: "Normalize" the image.
      // We decode it and re-export it as a fresh Buffer.
      // This fixes 'libspng read error' caused by weird compression or metadata in the source.
      const instance = sharp(rawBuffer, { failOn: 'none' });
      const metadata = await instance.metadata();
      const cleanBuffer = await instance.toBuffer(); // Re-encodes; failOn on constructor above ignores input warnings

      return { buffer: cleanBuffer, metadata };
    }));

    // 2. Calculate dimensions for the composite canvas
    let totalWidth = 0;
    let maxHeight = 0;

    imageAssets.forEach(img => {
      totalWidth += img.metadata.width;
      maxHeight = Math.max(maxHeight, img.metadata.height);
    });

    // 3. Create the composite operations array
    let currentX = 0;
    const compositeOps = imageAssets.map(img => {
      const op = { input: img.buffer, top: 0, left: currentX };
      currentX += img.metadata.width;
      return op;
    });

    // 4. Create blank canvas and composite
    const stitchedBuffer = await sharp({
      create: {
        width: totalWidth,
        height: maxHeight,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 }
      },
      failOn: 'none'
    })
    .composite(compositeOps)
    .png()
    .toBuffer();

    // 5. Return as base64 string
    return stitchedBuffer.toString('base64');

  } catch (error) {
    console.error("Stitching failed:", error);
    throw new Error("Failed to stitch images.");
  }
}

app.post('/chat', async (req, res) => {
  const { message, images, sessionId = defaultSessionId } = req.body;

  // Validation
  const hasImages = images && Array.isArray(images) && images.length > 0;
  if (!message && !hasImages) {
    return res.status(400).json({ error: 'Message or Image is required' });
  }

  try {
    let client = sessions.get(sessionId);
    if (!client) {
      client = await createSession(sessionId);
    }

    const promptParts = [];
    let finalMessage = message || "Analyze this image.";

    // --- MULTI-IMAGE LOGIC ---
    if (hasImages) {
      if (images.length > 1) {
        // CASE A: Multiple Images -> Stitch them
        console.log(`Stitching ${images.length} images...`);

        // 1. Perform Stitching
        const compositeBase64 = await stitchImages(images);

        // 2. Update System Hint
        finalMessage += `\n\n[System: User has attached a base64 encoded image that is a composite of ${images.length} images stitched horizontally. Treat them as separate visual contexts ordered left-to-right.]`;

        // 3. Push Message (Text First)
        promptParts.push({ text: finalMessage });

        // 4. Push Composite Image (Single Attachment)
        promptParts.push({
          inlineData: {
            mimeType: 'image/jpeg',
            data: compositeBase64
          }
        });

      } else {
        // CASE B: Single Image -> Standard Pass-through
        console.log(`Processing single image...`);

        finalMessage += `\n\n[System: User has attached a base64 encoded image for analysis.]`;

        // 1. Push Message (Text First)
        promptParts.push({ text: finalMessage });

        // 2. Push Single Image
        const img = images[0];
        promptParts.push({
          inlineData: {
            mimeType: img.mimeType,
            data: cleanBase64(img.data)
          }
        });
      }
    } else {
      // CASE C: Text Only
      promptParts.push({ text: finalMessage });
    }

    console.log(`Sending Prompt: ${promptParts.length} parts.`);

    // Execute Request
    const chat = client.getChat();
    const modelName = client.getCurrentSequenceModel() || 'gemini-2.5-flash';
    const promptId = `prompt-${Date.now()}`;
    const modelConfigKey = { model: modelName };

    const stream = await chat.sendMessageStream(
      modelConfigKey,
      promptParts,
      promptId,
      new AbortController().signal
    );

    let fullText = '';
    for await (const event of stream) {
      if (event.type === 'chunk') {
        const response = event.value;
        if (response.candidates && response.candidates[0] && response.candidates[0].content) {
          const parts = response.candidates[0].content.parts;
          for (const part of parts) {
            if (part.text) {
              fullText += part.text;
            }
          }
        }
      }
    }
    res.json({ response: fullText });

  } catch (error) {
    console.error('Chat error:', error);
    res.status(500).json({ error: 'Failed to send message', details: error.toString() });
  }
});

app.post('/reset', async (req, res) => {
  const { sessionId = defaultSessionId } = req.body;
  try {
    await createSession(sessionId);
    res.json({ status: 'Session reset' });
  } catch (error) {
    console.error('Reset error:', error);
    res.status(500).json({ error: 'Failed to reset session' });
  }
});

app.listen(port, () => {
  console.log(`Gemini serve listening at http://localhost:${port}`);
});