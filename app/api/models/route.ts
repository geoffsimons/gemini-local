import { NextResponse } from "next/server";
// TODO: We need to find the correct way to query available models for the authenticated user's account.
//       For now, we are hardcoding the list of models that are available.
// import { VALID_GEMINI_MODELS } from "@google/gemini-cli-core";
import { createLogger } from "@/lib/logger";

const log = createLogger('Hub/API/Models');

const VALID_GEMINI_MODELS: string[] = [
  "gemini-3-pro-preview",
  "gemini-3-flash-preview",
  "gemini-2.5-pro",
  "gemini-2.5-flash",
  "gemini-2.5-flash-lite",
];

/**
 * GET /api/models
 * Retrieves the available Gemini models.
 */
export async function GET() {
  // log.debug('Models requested', { models: VALID_GEMINI_MODELS });
  return NextResponse.json(VALID_GEMINI_MODELS);
}
