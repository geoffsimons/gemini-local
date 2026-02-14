import sharp from "sharp";

/** Strip data-URI prefix and whitespace that would corrupt the buffer. */
export function cleanBase64(data: string): string {
  return data
    .replace(/^data:image\/[a-z]+;base64,/, '')
    .replace(/\s/g, '');
}

interface ImagePayload {
  data: string;
  mimeType: string;
}

/** Stitch multiple images into a single horizontal composite (PNG). */
export async function stitchImages(images: ImagePayload[]): Promise<string> {
  // 1. Normalization — re-encode each buffer to strip corrupt metadata and
  //    normalize orientation.
  const assets = await Promise.all(
    images.map(async (img) => {
      const rawBuffer = Buffer.from(cleanBase64(img.data), 'base64');
      const instance = sharp(rawBuffer, { failOn: 'none' });
      const metadata = await instance.metadata();
      const cleanBuffer = await instance.toBuffer();
      return { buffer: cleanBuffer, metadata };
    }),
  );

  // 2. Canvas dimensions
  let totalWidth = 0;
  let maxHeight = 0;
  for (const img of assets) {
    totalWidth += img.metadata.width!;
    maxHeight = Math.max(maxHeight, img.metadata.height!);
  }

  // 3. Composite operations — place images left-to-right
  let currentX = 0;
  const compositeOps = assets.map((img) => {
    const op = { input: img.buffer, top: 0, left: currentX };
    currentX += img.metadata.width!;
    return op;
  });

  // 4. Render onto a transparent canvas
  const stitchedBuffer = await sharp({
    create: {
      width: totalWidth,
      height: maxHeight,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
    failOn: 'none',
  })
    .composite(compositeOps)
    .png()
    .toBuffer();

  return stitchedBuffer.toString('base64');
}
