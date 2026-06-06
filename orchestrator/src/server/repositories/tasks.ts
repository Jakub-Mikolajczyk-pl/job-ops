/**
 * Tasks repository — the "Your move" action surface (RECRUITMENT_TASKS.md R3).
 *
 * Buckets open tasks (joined to their job) into overdue / today / soon, plus
 * the recruitment intakes the worker flagged needs_review. This is the ADHD
 * dashboard + daily Telegram nudge data source. Tenant-scoped throughout.
 *
 * Task dueDate is stored as epoch SECONDS (see services/recruitment-intake.ts
 * and applicationTracking) — all bucketing here works in seconds.
 */

import type {
  RecruitmentIntakeKind,
  RecruitmentIntakeSource,
  YourMove,
  YourMoveNeedsReview,
  YourMoveTask,
} from "@shared/types";
import { and, asc, eq } from "drizzle-orm";
import { db, schema } from "../db/index";
import { getActiveTenantId } from "../tenancy/context";
import * as intakeRepo from "./recruitmentIntake";

const { jobs, tasks } = schema;

const DAY_SECONDS = 24 * 60 * 60;

/** Start of the current day in the given timezone, as epoch seconds. */
function startOfTodaySeconds(now: Date): number {
  const local = new Date(now);
  local.setHours(0, 0, 0, 0);
  return Math.floor(local.getTime() / 1000);
}

/**
 * Assemble the "Your move" payload. `now` is injectable so tests can pin time.
 * Open tasks (isCompleted=false) are bucketed:
 *  - overdue: dueDate strictly before today
 *  - today:   dueDate within today
 *  - soon:    dueDate within the next 7 days, OR no dueDate (still actionable)
 */
export async function getYourMove(now: Date = new Date()): Promise<YourMove> {
  const tenantId = getActiveTenantId();
  const todayStart = startOfTodaySeconds(now);
  const tomorrowStart = todayStart + DAY_SECONDS;
  const soonEnd = todayStart + 7 * DAY_SECONDS;

  const rows = await db
    .select({
      id: tasks.id,
      applicationId: tasks.applicationId,
      type: tasks.type,
      title: tasks.title,
      dueDate: tasks.dueDate,
      notes: tasks.notes,
      company: jobs.employer,
      position: jobs.title,
      jobUrl: jobs.jobUrl,
    })
    .from(tasks)
    .innerJoin(jobs, eq(tasks.applicationId, jobs.id))
    .where(and(eq(tasks.tenantId, tenantId), eq(tasks.isCompleted, false)))
    .orderBy(asc(tasks.dueDate));

  const overdue: YourMoveTask[] = [];
  const today: YourMoveTask[] = [];
  const soon: YourMoveTask[] = [];

  for (const row of rows) {
    const item: YourMoveTask = {
      id: row.id,
      applicationId: row.applicationId,
      type: row.type,
      title: row.title,
      dueDate: row.dueDate ?? null,
      notes: row.notes ?? null,
      company: row.company,
      position: row.position,
      jobUrl: row.jobUrl,
    };
    const due = row.dueDate;
    if (due == null) {
      soon.push(item);
    } else if (due < todayStart) {
      overdue.push(item);
    } else if (due < tomorrowStart) {
      today.push(item);
    } else if (due < soonEnd) {
      soon.push(item);
    }
    // Tasks due >7 days out are intentionally omitted — not yet actionable.
  }

  const needsReviewRows = await intakeRepo.listNeedsReview();
  const needsReview: YourMoveNeedsReview[] = needsReviewRows.map((row) => ({
    intakeId: row.id,
    source: row.source as RecruitmentIntakeSource,
    kind: row.kind as RecruitmentIntakeKind,
    preview: row.rawText.slice(0, 200),
    reason: row.errorMessage ?? null,
    createdAt: row.createdAt,
  }));

  return { overdue, today, soon, needsReview };
}

/** Mark a task complete. Returns false if no such task for this tenant. */
export async function completeTask(taskId: string): Promise<boolean> {
  const tenantId = getActiveTenantId();
  const result = await db
    .update(tasks)
    .set({ isCompleted: true })
    .where(and(eq(tasks.id, taskId), eq(tasks.tenantId, tenantId)))
    .returning({ id: tasks.id });
  return result.length > 0;
}

/**
 * Push a task's due date out by `days`. Anchored to whichever is later — the
 * current due date or now — so snoozing an overdue task moves it into the
 * future rather than to a still-past date. Returns the new dueDate (epoch
 * seconds), or null if the task is missing.
 */
export async function snoozeTask(
  taskId: string,
  days: number,
  now: Date = new Date(),
): Promise<number | null> {
  const tenantId = getActiveTenantId();
  const existing = await db
    .select({ dueDate: tasks.dueDate })
    .from(tasks)
    .where(and(eq(tasks.id, taskId), eq(tasks.tenantId, tenantId)))
    .limit(1);
  if (existing.length === 0) return null;

  const nowSeconds = Math.floor(now.getTime() / 1000);
  const base = Math.max(existing[0].dueDate ?? nowSeconds, nowSeconds);
  const nextDue = base + days * DAY_SECONDS;
  await db
    .update(tasks)
    .set({ dueDate: nextDue })
    .where(and(eq(tasks.id, taskId), eq(tasks.tenantId, tenantId)));
  return nextDue;
}
