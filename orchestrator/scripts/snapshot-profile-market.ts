import "../src/server/config/env";
import { closeDb } from "../src/server/db/index";
import { snapshotMarket } from "../src/server/repositories/profile-market-snapshots";

async function run() {
	await snapshotMarket();
	closeDb();
}

run().catch((err) => {
	console.error(err);
	process.exit(1);
});
