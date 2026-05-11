import "../src/server/config/env";
import { closeDb } from "../src/server/db/index";
import { snapshotSkills } from "../src/server/repositories/skill-snapshots";

async function run() {
  await snapshotSkills();
  closeDb();
}

run().catch((err) => { console.error(err); process.exit(1); });
