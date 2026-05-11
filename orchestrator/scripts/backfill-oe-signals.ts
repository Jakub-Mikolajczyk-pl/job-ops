/**
 * Backfill OE-toolkit signals (oeFitnessScore, redFlags, asyncScore) for jobs
 * that were processed before the OE feature shipped.
 *
 * Safe to re-run — only processes jobs where oeFitnessScore IS NULL.
 */
import "../src/server/config/env";
import { and, eq, isNull, notInArray } from "drizzle-orm";
import { closeDb, db, schema } from "../src/server/db/index";
import { computeAsyncScore } from "../src/server/services/oe-async-score";
import { computeOeFitness } from "../src/server/services/oe-fitness";
import { scan as scanRedFlags } from "../src/server/services/oe-redflags";

async function backfill() {
  const { jobs } = schema;

  const rows = await db
    .select({
      id: jobs.id,
      isRemote: jobs.isRemote,
      workFromHomeType: jobs.workFromHomeType,
      companyNumEmployees: jobs.companyNumEmployees,
      jobLevel: jobs.jobLevel,
      jobFunction: jobs.jobFunction,
      jobDescription: jobs.jobDescription,
    })
    .from(jobs)
    .where(
      and(
        isNull(jobs.oeFitnessScore),
        notInArray(jobs.status, ["expired", "skipped"]),
      ),
    );

  console.log(`[backfill-oe] Found ${rows.length} jobs to backfill`);

  let updated = 0;
  for (const row of rows) {
    const desc = row.jobDescription ?? "";
    const flags = scanRedFlags(desc);
    const asyncResult = computeAsyncScore(desc);
    const fitnessResult = computeOeFitness(row);

    await db
      .update(jobs)
      .set({
        oeFitnessScore: fitnessResult.score,
        oeFitnessReasons: JSON.stringify(fitnessResult.reasons),
        redFlags: JSON.stringify(flags),
        asyncScore: asyncResult.score,
        asyncSignals: JSON.stringify(asyncResult.signals),
      })
      .where(eq(jobs.id, row.id));

    updated++;
    if (updated % 100 === 0) {
      console.log(`[backfill-oe] Updated ${updated}/${rows.length}`);
    }
  }

  console.log(`[backfill-oe] Done — updated ${updated} jobs`);
  closeDb();
}

backfill().catch((err) => {
  console.error("[backfill-oe] Error:", err);
  process.exit(1);
});
