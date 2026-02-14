// test_rgb.js
const BLUE  = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPj/HwADBwIAMQw/QAAAAABJRU5ErkJggg=="; // #0000FF
const GREEN = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAEGgHg7OA1IQAAAABJRU5ErkJggg=="; // #00FF00
const RED   = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="; // #FF0000

async function runTest() {
  console.log("Sending Blue + Green + Red (Stitched) to Gemini...");

  try {
    const response = await fetch('http://localhost:3000/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        // Updated prompt asking for specific data formats
        message: "I have attached a composite image containing 3 solid color blocks stitched side-by-side. Identify the colors from left to right. Return the result as a JSON list of hex codes (e.g., ['#RRGGBB']).",
        images: [
          { mimeType: "image/png", data: BLUE },
          { mimeType: "image/png", data: GREEN },
          { mimeType: "image/png", data: RED }
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