#!/bin/bash

# A 1x1 Red Pixel (PNG format) in Base64
# We use this so we don't need an external image file for the test.
IMAGE_DATA="iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="

echo "Sending 1x1 Red Pixel to Gemini Serve..."

# Send the request
curl -s -X POST http://localhost:3000/chat \
  -H "Content-Type: application/json" \
  -d "{
    \"message\": \"What color is this image? Be concise.\",
    \"image\": {
      \"mimeType\": \"image/png\",
      \"data\": \"$IMAGE_DATA\"
    }
  }" | jq .

echo -e "\nTest Complete."