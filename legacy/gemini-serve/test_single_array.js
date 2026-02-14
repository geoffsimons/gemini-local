// test_single_array.js
const BLUE_PIXEL = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPj/HwADBwIAMQw/QAAAAABJRU5ErkJggg==";

const RED_PIXEL = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

async function runTest() {
  console.log("Sending ONE image (Blue) via the new 'images' array...");

  try {
    const response = await fetch('http://localhost:3000/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: "What color is this?",
        images: [
          // { mimeType: "image/png", data: BLUE_PIXEL },
          { mimeType: "image/png", data: RED_PIXEL }
        ]
      })
    });

    const data = await response.json();
    console.log("\nResponse:");
    console.log(JSON.stringify(data, null, 2));

  } catch (err) {
    console.error("Test Failed:", err);
  }
}

runTest();