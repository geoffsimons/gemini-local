#!/bin/bash
curl -X POST http://localhost:3000/chat \
     -H "Content-Type: application/json" \
     -d '{"message": "Generate a git commit message for adding a new Node.js API service"}'
