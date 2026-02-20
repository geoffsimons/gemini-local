import { NextResponse } from "next/server";
import { VALID_GEMINI_MODELS } from "@google/gemini-cli-core";

/**
 * GET /api/models
 * Retrieves the available Gemini models.
 */
export async function GET() {
  return NextResponse.json(Array.from(VALID_GEMINI_MODELS));
}
