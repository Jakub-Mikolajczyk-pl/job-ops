import { randomUUID } from "node:crypto";
import type {
  ActiveEmployment,
  CreateActiveEmploymentInput,
  UpdateActiveEmploymentInput,
} from "@shared/types";
import { and, eq, isNull, sum } from "drizzle-orm";
import { db, schema } from "../db";
import { getActiveTenantId } from "../tenancy/context";

const { activeEmployments } = schema;

function computeMonthlyGross(
  input: Pick<
    CreateActiveEmploymentInput | UpdateActiveEmploymentInput,
    "hourlyRatePLN" | "monthlyHours" | "monthlyGrossPLN"
  >,
): number | null {
  if (input.hourlyRatePLN != null && input.monthlyHours != null) {
    return input.hourlyRatePLN * input.monthlyHours;
  }
  return input.monthlyGrossPLN ?? null;
}

function mapRow(row: typeof activeEmployments.$inferSelect): ActiveEmployment {
  return {
    id: row.id,
    tenantId: row.tenantId,
    jobId: row.jobId ?? null,
    label: row.label,
    employer: row.employer,
    startedAt: row.startedAt,
    endedAt: row.endedAt ?? null,
    timezone: row.timezone ?? null,
    coreHoursStart: row.coreHoursStart ?? null,
    coreHoursEnd: row.coreHoursEnd ?? null,
    monthlyGrossPLN: row.monthlyGrossPLN ?? null,
    hourlyRatePLN: row.hourlyRatePLN ?? null,
    monthlyHours: row.monthlyHours ?? null,
    weeklyHoursBudget: row.weeklyHoursBudget ?? null,
    industry: row.industry ?? null,
    notes: row.notes ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function listActiveEmployments(): Promise<ActiveEmployment[]> {
  const tenantId = getActiveTenantId();
  const rows = await db
    .select()
    .from(activeEmployments)
    .where(eq(activeEmployments.tenantId, tenantId))
    .orderBy(activeEmployments.startedAt);
  return rows.map(mapRow);
}

export async function getActiveEmploymentById(
  id: string,
): Promise<ActiveEmployment | null> {
  const tenantId = getActiveTenantId();
  const [row] = await db
    .select()
    .from(activeEmployments)
    .where(
      and(
        eq(activeEmployments.tenantId, tenantId),
        eq(activeEmployments.id, id),
      ),
    )
    .limit(1);
  return row ? mapRow(row) : null;
}

export async function createActiveEmployment(
  input: CreateActiveEmploymentInput,
): Promise<ActiveEmployment> {
  const tenantId = getActiveTenantId();
  const now = new Date().toISOString();
  const id = randomUUID();

  await db.insert(activeEmployments).values({
    id,
    tenantId,
    jobId: input.jobId ?? null,
    label: input.label,
    employer: input.employer,
    startedAt: input.startedAt,
    endedAt: input.endedAt ?? null,
    timezone: input.timezone ?? null,
    coreHoursStart: input.coreHoursStart ?? null,
    coreHoursEnd: input.coreHoursEnd ?? null,
    hourlyRatePLN: input.hourlyRatePLN ?? null,
    monthlyHours: input.monthlyHours ?? null,
    monthlyGrossPLN: computeMonthlyGross(input),
    weeklyHoursBudget: input.weeklyHoursBudget ?? null,
    industry: input.industry ?? null,
    notes: input.notes ?? null,
    createdAt: now,
    updatedAt: now,
  });

  const created = await getActiveEmploymentById(id);
  if (!created) throw new Error("Failed to create active employment");
  return created;
}

export async function updateActiveEmployment(
  id: string,
  input: UpdateActiveEmploymentInput,
): Promise<ActiveEmployment | null> {
  const tenantId = getActiveTenantId();
  const now = new Date().toISOString();

  const updateData: Partial<typeof activeEmployments.$inferInsert> = {
    updatedAt: now,
  };
  if (input.label !== undefined) updateData.label = input.label;
  if (input.employer !== undefined) updateData.employer = input.employer;
  if (input.startedAt !== undefined) updateData.startedAt = input.startedAt;
  if ("endedAt" in input) updateData.endedAt = input.endedAt ?? null;
  if ("timezone" in input) updateData.timezone = input.timezone ?? null;
  if ("coreHoursStart" in input)
    updateData.coreHoursStart = input.coreHoursStart ?? null;
  if ("coreHoursEnd" in input)
    updateData.coreHoursEnd = input.coreHoursEnd ?? null;
  if ("hourlyRatePLN" in input)
    updateData.hourlyRatePLN = input.hourlyRatePLN ?? null;
  if ("monthlyHours" in input)
    updateData.monthlyHours = input.monthlyHours ?? null;
  if ("hourlyRatePLN" in input || "monthlyHours" in input || "monthlyGrossPLN" in input)
    updateData.monthlyGrossPLN = computeMonthlyGross(input);
  if ("weeklyHoursBudget" in input)
    updateData.weeklyHoursBudget = input.weeklyHoursBudget ?? null;
  if ("industry" in input) updateData.industry = input.industry ?? null;
  if ("notes" in input) updateData.notes = input.notes ?? null;

  await db
    .update(activeEmployments)
    .set(updateData)
    .where(
      and(
        eq(activeEmployments.tenantId, tenantId),
        eq(activeEmployments.id, id),
      ),
    );

  return getActiveEmploymentById(id);
}

export async function deleteActiveEmployment(id: string): Promise<boolean> {
  const tenantId = getActiveTenantId();
  const result = await db
    .delete(activeEmployments)
    .where(
      and(
        eq(activeEmployments.tenantId, tenantId),
        eq(activeEmployments.id, id),
      ),
    )
    .run();
  return result.changes > 0;
}

export async function getSalaryStack(): Promise<{
  monthlyPLN: number;
  annualPLN: number;
  currentCount: number;
}> {
  const tenantId = getActiveTenantId();
  const rows = await db
    .select({ monthlyGrossPLN: activeEmployments.monthlyGrossPLN })
    .from(activeEmployments)
    .where(
      and(
        eq(activeEmployments.tenantId, tenantId),
        isNull(activeEmployments.endedAt),
      ),
    );

  const monthlyPLN = rows.reduce(
    (acc, r) => acc + (r.monthlyGrossPLN ?? 0),
    0,
  );
  return {
    monthlyPLN,
    annualPLN: monthlyPLN * 12,
    currentCount: rows.length,
  };
}

export async function getActiveEmploymentByJobId(
  jobId: string,
): Promise<ActiveEmployment | null> {
  const tenantId = getActiveTenantId();
  const [row] = await db
    .select()
    .from(activeEmployments)
    .where(
      and(
        eq(activeEmployments.tenantId, tenantId),
        eq(activeEmployments.jobId, jobId),
      ),
    )
    .limit(1);
  return row ? mapRow(row) : null;
}
