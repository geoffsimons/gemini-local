import { NextResponse } from "next/server";
import { VALID_GEMINI_MODELS } from "@google/gemini-cli-core";
import { createLogger } from "@/lib/logger";

const log = createLogger('Hub/API/Models');

/**
 * GET /api/models
 * Retrieves the available Gemini models.
 */
export async function GET() {
  log.debug('Models requested', { models: Array.from(VALID_GEMINI_MODELS) });
  return NextResponse.json(Array.from(VALID_GEMINI_MODELS));
}
