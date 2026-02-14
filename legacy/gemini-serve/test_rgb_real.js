import sharp from 'sharp';

// Helper to generate a 100x100 solid color PNG
async function createColorBlock(r, g, b) {
  const buffer = await sharp({
    create: {
      width: 100,
      height: 100,
      channels: 4,
      background: { r, g, b, alpha: 1 }
    }
  }).png().toBuffer();
  return buffer.toString('base64');
}

async function runTest() {
  console.log("Generating 100x100 Color Blocks...");
  
  const blue = await createColorBlock(0, 0, 255);
  const green = await createColorBlock(0, 255, 0);
  const red = await createColorBlock(255, 0, 0);

  console.log("Sending Blue + Green + Red (Stitched) to Gemini...");

  try {
    const response = await fetch('http://localhost:3000/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: "I have attached a composite image containing 3 solid color blocks stitched side-by-side. Identify the colors from left to right. Return the result as a JSON list of hex codes (e.g., ['#RRGGBB']).",
        images: [
          { mimeType: "image/png", data: blue },
          { mimeType: "image/png", data: green },
          { mimeType: "image/png", data: red }
        ]
      })
    });

    const data = await response.json();
    console.log("\nResponse from Server:");
    console.log(data.response);

  } catch (err) {
    console.error("Test Failed:", err);
  }
}

runTest();