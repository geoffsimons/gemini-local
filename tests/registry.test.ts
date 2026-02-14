import { registry } from "../lib/registry";
import path from "path";

async function runRegistryTest() {
  const projectA = path.resolve("./tests/mocks/project-a");
  const projectB = path.resolve("./tests/mocks/project-b");

  console.log("🚀 Starting Registry Validation...");

  // --- Test 1: Lazy Creation ---
  console.log("\n[TEST 1] Lazy Creation");
  const sessionA1 = await registry.getSession(projectA);
  const sessionB = await registry.getSession(projectB);

  console.log(`✅ Created session for Project A: ${projectA}`);
  console.log(`✅ Created session for Project B: ${projectB}`);
  console.log(`Session A Ready: ${registry.isReady(projectA)} (Expected: false)`);

  // --- Test 2: Singleton Identity ---
  console.log("\n[TEST 2] Identity Persistence");
  const sessionA2 = await registry.getSession(projectA);
  if (sessionA1 === sessionA2) {
    console.log("✅ Registry correctly returned the same instance for Project A.");
  } else {
    console.error("❌ FAILURE: Registry created a duplicate instance for the same path.");
  }

  // --- Test 3: Path Isolation ---
  console.log("\n[TEST 3] Path Isolation");
  if (sessionA1 !== sessionB) {
    console.log("✅ Project A and Project B are isolated instances.");
  } else {
    console.error("❌ FAILURE: Registry cross-contaminated project instances.");
  }

  // --- Test 4: Warm-up Handshake (Simulation) ---
  console.log("\n[TEST 4] Initialization Logic");
  // We can check if initializeSession is a function and if it updates status
  console.log("Method exists:", typeof registry.initializeSession === "function");
}

runRegistryTest().catch((err) => {
  console.error("Test Suite Crashed:", err);
  process.exit(1);
});