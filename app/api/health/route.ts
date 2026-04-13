export const dynamic = 'force-dynamic';
export const maxDuration = 300;

import { NextResponse } from "next/server";

// ---------------------------------------------------------------------------
// GET /api/health
// ---------------------------------------------------------------------------

export async function GET() {
  return NextResponse.json({ status: 'ok', uptime: process.uptime() });
}
