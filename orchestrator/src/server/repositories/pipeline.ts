/**
 * Pipeline run repository.
 */

import { randomUUID } from "node:crypto";
import type {
  PipelineRun,
  PipelineRunConfigSnapshot,
  PipelineRunInsights,
  PipelineRunResultSummary,
  PipelineRunSavedDetails,
} from "@shared/types";
import { and, desc, eq, gte, lte, sql } from "drizzle-orm";
import { db, schema } from "../db/index";
import { getActiveTenantId } from "../tenancy/context";

const { jobs, pipelineRuns } = schema;

function mapRowToPipelineRun(
  row: typeof schema.pipelineRuns.$inferSelect,
): PipelineRun {
  return {
    id: row.id,
    startedAt: row.startedAt,
    completedAt: row.completedAt,
    status: row.status as PipelineRun["status"],
    jobsDiscovered: row.jobsDiscovered,
    jobsProcessed: row.jobsProcessed,
    errorMessage: row.errorMessage,
    configSnapshot: parseConfigSnapshot(row.configSnapshot),
  };
}

function mapRowToSavedDetails(
  row: typeof schema.pipelineRuns.$inferSelect,
): PipelineRunSavedDetails | null {
  if (!row.requestedConfig || !row.effectiveConfig || !row.resultSummary) {
    return null;
  }

  return {
    requestedConfig:
      row.requestedConfig as PipelineRunSavedDetails["requestedConfig"],
    effectiveConfig:
      row.effectiveConfig as PipelineRunSavedDetails["effectiveConfig"],
    resultSummary:
      row.resultSummary as PipelineRunSavedDetails["resultSummary"],
  };
}

function serializeConfigSnapshot(
  value: PipelineRunConfigSnapshot | null | undefined,
): string | null {
  if (!value) return null;
  return JSON.stringify(value);
}

function parseConfigSnapshot(
  value: string | null | undefined,
): PipelineRunConfigSnapshot | null {
  if (!value) return null;
  try {
    return JSON.parse(value) as PipelineRunConfigSnapshot;
  } catch {
    return null;
  }
}

/**
 * Create a new pipeline run.
 */
export async function createPipelineRun(args?: {
  configSnapshot?: PipelineRunConfigSnapshot | null;
  savedDetails?: PipelineRunSavedDetails | null;
}): Promise<PipelineRun> {
  const id = randomUUID();
  const now = new Date().toISOString();
  const tenantId = getActiveTenantId();

  await db.insert(pipelineRuns).values({
    id,
    tenantId,
    startedAt: now,
    status: "running",
    configSnapshot: serializeConfigSnapshot(args?.configSnapshot ?? null),
    requestedConfig: args?.savedDetails?.requestedConfig ?? null,
    effectiveConfig: args?.savedDetails?.effectiveConfig ?? null,
    resultSummary: args?.savedDetails?.resultSummary ?? null,
  });

  return {
    id,
    startedAt: now,
    completedAt: null,
    status: "running",
    jobsDiscovered: 0,
    jobsProcessed: 0,
    errorMessage: null,
    configSnapshot: args?.configSnapshot ?? null,
  };
}

/**
 * Update a pipeline run.
 */
export async function updatePipelineRun(
  id: string,
  update: Partial<{
    completedAt: string;
    status: "running" | "completed" | "failed" | "cancelled";
    jobsDiscovered: number;
    jobsProcessed: number;
    errorMessage: string;
    configSnapshot: PipelineRunConfigSnapshot | null;
    resultSummary: PipelineRunResultSummary | null;
  }>,
): Promise<void> {
  const { configSnapshot, resultSummary, ...rest } = update;
  const tenantId = getActiveTenantId();
  await db
    .update(pipelineRuns)
    .set({
      ...rest,
      ...(Object.hasOwn(update, "configSnapshot")
        ? {
            configSnapshot: serializeConfigSnapshot(configSnapshot ?? null),
          }
        : {}),
      ...(Object.hasOwn(update, "resultSummary")
        ? { resultSummary: resultSummary ?? null }
        : {}),
    })
    .where(and(eq(pipelineRuns.tenantId, tenantId), eq(pipelineRuns.id, id)));
}

/**
 * Get the latest pipeline run.
 */
export async function getLatestPipelineRun(): Promise<PipelineRun | null> {
  const tenantId = getActiveTenantId();
  const [row] = await db
    .select()
    .from(pipelineRuns)
    .where(eq(pipelineRuns.tenantId, tenantId))
    .orderBy(desc(pipelineRuns.startedAt))
    .limit(1);

  if (!row) return null;

  return mapRowToPipelineRun(row);
}

/**
 * Get recent pipeline runs.
 */
export async function getRecentPipelineRuns(
  limit: number = 10,
): Promise<PipelineRun[]> {
  const tenantId = getActiveTenantId();
  const rows = await db
    .select()
    .from(pipelineRuns)
    .where(eq(pipelineRuns.tenantId, tenantId))
    .orderBy(desc(pipelineRuns.startedAt))
    .limit(limit);

  return rows.map(mapRowToPipelineRun);
}

export async function getPipelineRunById(
  id: string,
): Promise<PipelineRun | null> {
  const tenantId = getActiveTenantId();
  const [row] = await db
    .select()
    .from(pipelineRuns)
    .where(and(eq(pipelineRuns.tenantId, tenantId), eq(pipelineRuns.id, id)))
    .limit(1);

  return row ? mapRowToPipelineRun(row) : null;
}

export async function getPipelineRunInsights(
  id: string,
): Promise<PipelineRunInsights | null> {
  const tenantId = getActiveTenantId();
  const [row] = await db
    .select()
    .from(pipelineRuns)
    .where(and(eq(pipelineRuns.tenantId, tenantId), eq(pipelineRuns.id, id)))
    .limit(1);
  if (!row) return null;

  const run = mapRowToPipelineRun(row);
  const savedDetails = mapRowToSavedDetails(row);

  const durationMs =
    run.completedAt == null
      ? null
      : Math.max(
          0,
          new Date(run.completedAt).getTime() -
            new Date(run.startedAt).getTime(),
        );

  if (!run.completedAt) {
    return {
      run,
      exactMetrics: { durationMs },
      savedDetails,
      inferredMetrics: {
        jobsCreated: { value: null, quality: "unavailable" },
        jobsUpdated: { value: null, quality: "unavailable" },
        jobsProcessed: { value: null, quality: "unavailable" },
      },
    };
  }

  const countSelection = { count: sql<number>`count(*)` };
  const [[createdRow], [updatedRow], [processedRow]] = await Promise.all([
    db
      .select(countSelection)
      .from(jobs)
      .where(
        and(
          gte(jobs.createdAt, run.startedAt),
          lte(jobs.createdAt, run.completedAt),
          eq(jobs.tenantId, tenantId),
        ),
      ),
    db
      .select(countSelection)
      .from(jobs)
      .where(
        and(
          gte(jobs.updatedAt, run.startedAt),
          lte(jobs.updatedAt, run.completedAt),
          eq(jobs.tenantId, tenantId),
        ),
      ),
    db
      .select(countSelection)
      .from(jobs)
      .where(
        and(
          gte(jobs.processedAt, run.startedAt),
          lte(jobs.processedAt, run.completedAt),
          eq(jobs.tenantId, tenantId),
        ),
      ),
  ]);

  return {
    run,
    exactMetrics: { durationMs },
    savedDetails,
    inferredMetrics: {
      jobsCreated: {
        value: createdRow?.count ?? 0,
        quality: "inferred_from_timestamps",
      },
      jobsUpdated: {
        value: updatedRow?.count ?? 0,
        quality: "inferred_from_timestamps",
      },
      jobsProcessed: {
        value: processedRow?.count ?? 0,
        quality: "inferred_from_timestamps",
      },
    },
  };
}

export interface SourceHealthRow {
  source: string;
  lastSuccessfulRun: string | null;
  runsLast30d: number;
  avgJobsPerRun: number;
  errorRateLast30d: number;
  lastError: string | null;
  status: "ok" | "warn" | "error";
}

export async function getPipelineHealth(): Promise<SourceHealthRow[]> {
  const tenantId = getActiveTenantId();
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const warnCutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const { pipelineRuns } = schema;

  const runs = await db
    .select({
      startedAt: pipelineRuns.startedAt,
      completedAt: pipelineRuns.completedAt,
      status: pipelineRuns.status,
      jobsDiscovered: pipelineRuns.jobsDiscovered,
      errorMessage: pipelineRuns.errorMessage,
      resultSummary: pipelineRuns.resultSummary,
    })
    .from(pipelineRuns)
    .where(and(eq(pipelineRuns.tenantId, tenantId), gte(pipelineRuns.startedAt, cutoff)))
    .orderBy(desc(pipelineRuns.startedAt));

  // Group per source from resultSummary JSON
  type SourceStats = {
    runs: number; success: number; totalJobs: number; lastSuccess: string | null; lastError: string | null;
  };
  const bySource = new Map<string, SourceStats>();

  for (const run of runs) {
    const summary = run.resultSummary as Record<string, unknown> | null;
    const sources: string[] = [];

    type PerSourceData = { jobsDiscovered: number; errors: number };
    let perSourceMap: Record<string, PerSourceData> | null = null;
    if (summary && typeof summary === 'object') {
      const ps = (summary as Record<string, unknown>).perSource;
      if (ps && typeof ps === 'object') {
        perSourceMap = ps as Record<string, PerSourceData>;
        for (const src of Object.keys(perSourceMap)) {
          sources.push(src);
        }
      }
    }
    // Fallback: treat whole run as one entry with key 'pipeline'
    if (sources.length === 0) sources.push('pipeline');

    for (const src of sources) {
      const s = bySource.get(src) ?? { runs: 0, success: 0, totalJobs: 0, lastSuccess: null, lastError: null };
      s.runs++;
      if (run.status === 'completed') {
        s.success++;
        const srcJobs = perSourceMap?.[src]?.jobsDiscovered ?? (sources.length === 1 ? (run.jobsDiscovered ?? 0) : 0);
        s.totalJobs += srcJobs;
        if (!s.lastSuccess || run.startedAt > s.lastSuccess) s.lastSuccess = run.startedAt;
      } else if (run.status === 'failed' && !s.lastError) {
        s.lastError = run.errorMessage ?? 'unknown error';
      }
      bySource.set(src, s);
    }
  }

  return [...bySource.entries()].map(([source, s]) => {
    const errorRate = s.runs > 0 ? (s.runs - s.success) / s.runs : 0;
    let status: "ok" | "warn" | "error" = "ok";
    if (!s.lastSuccess) status = "error";
    else if (s.lastSuccess < warnCutoff) status = "warn";
    return {
      source,
      lastSuccessfulRun: s.lastSuccess,
      runsLast30d: s.runs,
      avgJobsPerRun: s.success > 0 ? Math.round(s.totalJobs / s.success) : 0,
      errorRateLast30d: Math.round(errorRate * 100),
      lastError: s.lastError,
      status,
    };
  }).sort((a, b) => (b.runsLast30d - a.runsLast30d));
}
