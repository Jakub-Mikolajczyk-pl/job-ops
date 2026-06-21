/**
 * Repository for the recruitment intake pipeline (raw_intake).
 * See RECRUITMENT_TASKS.md R1/R2. Single source of truth for inbound
 * recruiter material before it is extracted into jobs/tasks/interviews.
 */

import { randomUUID } from "node:crypto";
import type {
  RecruitmentIntakeDashboardCounts,
  RecruitmentIntakeDashboardItem,
  RecruitmentIntakeKind,
  RecruitmentIntakeSource,
  RecruitmentIntakeStatus,
} from "@shared/types";
import { and, count, desc, eq } from "drizzle-orm";
import { db, schema } from "../db/index";
import { getActiveTenantId } from "../tenancy/context";

const { rawIntake } = schema;

export type RawIntakeRow = typeof rawIntake.$inferSelect;

export interface InsertIntakeInput {
  source: RecruitmentIntakeSource;
  kind: RecruitmentIntakeKind;
  rawText: string;
  contentHash: string;
  meta?: Record<string, unknown> | null;
}

export async function getById(id: string): Promise<RawIntakeRow | undefined> {
  const tenantId = getActiveTenantId();
  const rows = await db
    .select()
    .from(rawIntake)
    .where(and(eq(rawIntake.id, id), eq(rawIntake.tenantId, tenantId)))
    .limit(1);
  return rows[0];
}

export async function findByHash(
  contentHash: string,
): Promise<RawIntakeRow | undefined> {
  const tenantId = getActiveTenantId();
  const rows = await db
    .select()
    .from(rawIntake)
    .where(
      and(
        eq(rawIntake.tenantId, tenantId),
        eq(rawIntake.contentHash, contentHash),
      ),
    )
    .limit(1);
  return rows[0];
}

export async function insertIntake(
  input: InsertIntakeInput,
): Promise<RawIntakeRow> {
  const tenantId = getActiveTenantId();
  const [row] = await db
    .insert(rawIntake)
    .values({
      id: randomUUID(),
      tenantId,
      source: input.source,
      kind: input.kind,
      rawText: input.rawText,
      contentHash: input.contentHash,
      meta: input.meta ?? null,
      status: "pending",
    })
    .returning();
  return row;
}

export async function listPending(limit = 50): Promise<RawIntakeRow[]> {
  const tenantId = getActiveTenantId();
  return db
    .select()
    .from(rawIntake)
    .where(
      and(eq(rawIntake.tenantId, tenantId), eq(rawIntake.status, "pending")),
    )
    .limit(limit);
}

export async function listNeedsReview(limit = 50): Promise<RawIntakeRow[]> {
  const tenantId = getActiveTenantId();
  return db
    .select()
    .from(rawIntake)
    .where(
      and(
        eq(rawIntake.tenantId, tenantId),
        eq(rawIntake.status, "needs_review"),
      ),
    )
    .orderBy(desc(rawIntake.createdAt))
    .limit(limit);
}

export async function listRecentForDashboard(
  limit = 50,
): Promise<RecruitmentIntakeDashboardItem[]> {
  const tenantId = getActiveTenantId();
  const rows = await db
    .select()
    .from(rawIntake)
    .where(eq(rawIntake.tenantId, tenantId))
    .orderBy(desc(rawIntake.createdAt))
    .limit(limit);

  return rows.map((row) => ({
    id: row.id,
    source: row.source as RecruitmentIntakeSource,
    kind: row.kind as RecruitmentIntakeKind,
    status: row.status as RecruitmentIntakeStatus,
    hash: row.contentHash,
    createdAt: row.createdAt,
    processedAt: row.processedAt ?? null,
    error: row.errorMessage ?? null,
    rawTextPreview: row.rawText.slice(0, 500),
    meta: (row.meta as Record<string, unknown> | null) ?? null,
    jobId: row.jobId ?? null,
  }));
}

export async function getDashboardCounts(): Promise<RecruitmentIntakeDashboardCounts> {
  const tenantId = getActiveTenantId();
  const rows = await db
    .select({ status: rawIntake.status, total: count() })
    .from(rawIntake)
    .where(eq(rawIntake.tenantId, tenantId))
    .groupBy(rawIntake.status);

  const counts: RecruitmentIntakeDashboardCounts = {
    pending: 0,
    needsReview: 0,
    processed: 0,
    error: 0,
  };

  for (const row of rows) {
    if (row.status === "pending") counts.pending = row.total;
    if (row.status === "needs_review") counts.needsReview = row.total;
    if (row.status === "processed") counts.processed = row.total;
    if (row.status === "error") counts.error = row.total;
  }

  return counts;
}

export async function markStatus(
  id: string,
  status: RecruitmentIntakeStatus,
  patch: { jobId?: string | null; errorMessage?: string | null } = {},
): Promise<void> {
  const tenantId = getActiveTenantId();
  await db
    .update(rawIntake)
    .set({
      status,
      processedAt:
        status === "processed" || status === "error"
          ? new Date().toISOString()
          : null,
      ...(patch.jobId !== undefined ? { jobId: patch.jobId } : {}),
      ...(patch.errorMessage !== undefined
        ? { errorMessage: patch.errorMessage }
        : {}),
    })
    .where(and(eq(rawIntake.id, id), eq(rawIntake.tenantId, tenantId)));
}

/** Delete a single intake row (e.g. junk like a bot `/start` command). */
export async function deleteIntake(id: string): Promise<void> {
  const tenantId = getActiveTenantId();
  await db
    .delete(rawIntake)
    .where(and(eq(rawIntake.id, id), eq(rawIntake.tenantId, tenantId)));
}

/**
 * Replace a row's raw text (after a manual fix), recompute its dedup hash, and
 * reset it to `pending` so the worker re-extracts it cleanly.
 */
export async function updateRawText(
  id: string,
  rawText: string,
  contentHash: string,
): Promise<void> {
  const tenantId = getActiveTenantId();
  await db
    .update(rawIntake)
    .set({
      rawText,
      contentHash,
      status: "pending",
      errorMessage: null,
      processedAt: null,
    })
    .where(and(eq(rawIntake.id, id), eq(rawIntake.tenantId, tenantId)));
}

/**
 * Re-arm a stuck row (`error` / `needs_review`, or a `processed` row being
 * force-rerun) for another extraction pass without touching its text.
 */
export async function resetForReprocess(id: string): Promise<void> {
  const tenantId = getActiveTenantId();
  await db
    .update(rawIntake)
    .set({ status: "pending", errorMessage: null, processedAt: null })
    .where(and(eq(rawIntake.id, id), eq(rawIntake.tenantId, tenantId)));
}
