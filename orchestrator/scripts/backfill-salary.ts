import "../src/server/config/env";
import { closeDb, db, schema } from "../src/server/db/index";
import { isNotNull, isNull, and, eq } from "drizzle-orm";
import { parseSalary } from "../src/server/services/salary-parser";
import { canonicalizeLocation } from "../src/server/services/location-canonicalizer";

async function backfill() {
  const { jobs } = schema;

  const rows = await db
    .select({
      id: jobs.id,
      salary: jobs.salary,
      location: jobs.location,
    })
    .from(jobs)
    .where(
      and(
        isNotNull(jobs.salary),
        isNull(jobs.monthlyMinPLN),
      ),
    );

  console.log(`[backfill] Found ${rows.length} jobs to backfill`);

  let updated = 0;
  for (const row of rows) {
    const parsed = row.salary ? parseSalary(row.salary) : null;
    const loc = row.location ? canonicalizeLocation(row.location) : null;

    await db
      .update(jobs)
      .set({
        monthlyMinPLN: parsed?.monthlyMinPLN ?? null,
        monthlyMaxPLN: parsed?.monthlyMaxPLN ?? null,
        locationCity: loc?.city ?? null,
        locationCountry: loc?.country ?? null,
      })
      .where(eq(jobs.id, row.id));

    updated++;
  }

  console.log(`[backfill] Updated ${updated} jobs`);
  closeDb();
}

backfill().catch((err) => {
  console.error(err);
  process.exit(1);
});
