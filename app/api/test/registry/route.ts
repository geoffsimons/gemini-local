import { NextResponse } from "next/server";
import { registry } from "@/lib/registry";
import path from "path";

export async function GET() {
  const results: string[] = [];
  const log = (m: string) => results.push(m);

  try {
    const projectA = path.resolve("./"); // Use the hub root as a test path
    
    log("🚀 Starting Registry Internal Validation...");

    // Test 1: Lazy Creation
    const sessionA1 = await registry.getSession(projectA);
    log(`✅ Session A created. Ready: ${registry.isReady(projectA)}`);

    // Test 2: Singleton Identity
    const sessionA2 = await registry.getSession(projectA);
    if (sessionA1 === sessionA2) {
      log("✅ Identity Check Passed: Same instance returned.");
    } else {
      log("❌ Identity Check Failed: Duplicate instances found.");
    }

    return NextResponse.json({ success: true, logs: results });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message, logs: results });
  }
}