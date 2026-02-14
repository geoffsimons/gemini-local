// test_multi.js
const BLUE_PIXEL = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPj/HwADBwIAMQw/QAAAAABJRU5ErkJggg==";
const GREEN_PIXEL = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAEGgHg7OA1IQAAAABJRU5ErkJggg==";

async function runTest() {
  console.log("Sending Blue (Left) + Green (Right) to Gemini...");

  try {
    const response = await fetch('http://localhost:3000/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        // UDPATED PROMPT: Explicitly references spatial order
        message: "I have provided two color samples side-by-side. Identify the colors from left to right.",
        images: [
          { mimeType: "image/png", data: BLUE_PIXEL },
          { mimeType: "image/png", data: GREEN_PIXEL }
        ]
      })
    });

    const data = await response.json();
    console.log("\nResponse from Server:");
    console.log(data.response); // Print just the text for cleaner output

  } catch (err) {
    console.error("Test Failed:", err);
  }
}

runTest();