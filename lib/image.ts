import sharp from "sharp";

interface ImageInput {
  data: string;
  mimeType: string;
}

interface DecodedImage {
  buffer: Buffer;
  width: number;
  height: number;
}

/**
 * Strips the `data:...;base64,` prefix from a base64 string if present.
 */
function cleanBase64(data: string): string {
  const idx = data.indexOf(",");
  if (idx !== -1 && data.startsWith("data:")) {
    return data.slice(idx + 1);
  }
  return data;
}

/**
 * Stitches multiple images into a single horizontal composite PNG.
 * Preserves original resolution for text readability.
 *
 * - 0 images → empty string
 * - 1 image  → cleaned base64 of the original
 * - N images → side-by-side PNG composite (left to right)
 */
export async function stitchImages(images: ImageInput[]): Promise<string> {
  if (images.length === 0) {
    return "";
  }

  if (images.length === 1) {
    return cleanBase64(images[0].data);
  }

  // Decode and normalize all inputs through sharp to fix libspng errors
  const decoded: DecodedImage[] = await Promise.all(
    images.map(async (img) => {
      const raw = Buffer.from(cleanBase64(img.data), "base64");
      // Re-encode through sharp to normalize pixel format
      const normalized = await sharp(raw).toBuffer();
      const metadata = await sharp(normalized).metadata();
      return {
        buffer: normalized,
        width: metadata.width ?? 0,
        height: metadata.height ?? 0,
      };
    }),
  );

  const totalWidth = decoded.reduce((sum, img) => sum + img.width, 0);
  const maxHeight = Math.max(...decoded.map((img) => img.height));

  // Build the composite overlay array with left offsets
  let leftOffset = 0;
  const composites: sharp.OverlayOptions[] = decoded.map((img) => {
    const overlay: sharp.OverlayOptions = {
      input: img.buffer,
      left: leftOffset,
      top: 0,
    };
    leftOffset += img.width;
    return overlay;
  });

  // Create transparent canvas and composite images side-by-side
  const result = await sharp({
    create: {
      width: totalWidth,
      height: maxHeight,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite(composites)
    .png() // CRITICAL: PNG prevents color bleeding artifacts
    .toBuffer();

  return result.toString("base64");
}
