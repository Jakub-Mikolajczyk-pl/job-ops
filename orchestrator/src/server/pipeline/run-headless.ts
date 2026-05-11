import "../config/env";
import { closeDb } from "../db/index";
import { runPipeline } from "./orchestrator";

process.env.PIPELINE_SKIP_INTERACTIVE = '1';

async function main() {
  console.log("=".repeat(60));
  console.log("Headless Pipeline Runner (skips interactive/captcha sources)");
  console.log("Started at: " + new Date().toISOString());
  console.log("=".repeat(60));

  const result = await runPipeline({
    topN: parseInt(process.env.PIPELINE_TOP_N || "10", 10),
    minSuitabilityScore: parseInt(process.env.PIPELINE_MIN_SCORE || "50", 10),
  });

  console.log("Pipeline result: success=" + result.success + " discovered=" + result.jobsDiscovered);
  closeDb();
  process.exit(result.success ? 0 : 1);
}

main().catch((error) => {
  console.error("Fatal error:", error);
  closeDb();
  process.exit(1);
});
