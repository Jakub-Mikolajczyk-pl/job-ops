/**
 * Automatic job expiry: marks discovered/ready jobs as expired once their
 * application deadline has passed. Runs per tenant; deadline parsing is
 * conservative (see @shared/job-deadline) so jobs with missing or ambiguous
 * deadlines are never touched.
 */

import { logger } from "@infra/logger";
import { runWithRequestContext } from "@infra/request-context";
import { sanitizeUnknown } from "@infra/sanitize";
import { db, schema } from "@server/db/index";
import * as jobsRepo from "@server/repositories/jobs";
import { isJobDeadlinePassed } from "@shared/job-deadline.js";
import { EXPIRABLE_JOB_STATUSES } from "@shared/types";

const JOB_EXPIRY_SWEEP_INTERVAL_MS = 6 * 60 * 60 * 1000;

export interface ExpiredJobSummary {
  id: string;
  title: string;
  employer: string;
  deadline: string | null;
}

export interface JobExpirySweepResult {
  scanned: number;
  expired: number;
  jobs: ExpiredJobSummary[];
}

/**
 * Expire overdue jobs for the tenant in the active request context.
 */
export async function expireOverdueJobs(
  now: Date = new Date(),
): Promise<JobExpirySweepResult> {
  const candidates = await jobsRepo.getAllJobs([...EXPIRABLE_JOB_STATUSES]);
  const overdue = candidates.filter((job) =>
    isJobDeadlinePassed(job.deadline, now),
  );

  const expired: ExpiredJobSummary[] = [];
  for (const job of overdue) {
    const updated = await jobsRepo.updateJob(job.id, { status: "expired" });
    if (updated) {
      expired.push({
        id: job.id,
        title: job.title,
        employer: job.employer,
        deadline: job.deadline,
      });
    }
  }

  if (expired.length > 0) {
    logger.info("Marked overdue jobs as expired", {
      scanned: candidates.length,
      expired: expired.length,
      jobIds: expired.map((job) => job.id),
    });
  }

  return { scanned: candidates.length, expired: expired.length, jobs: expired };
}

/**
 * Run the expiry sweep for every tenant. Used by the background scheduler,
 * which has no request context to derive a tenant from.
 */
export async function expireOverdueJobsAllTenants(
  now: Date = new Date(),
): Promise<JobExpirySweepResult> {
  const tenantRows = await db
    .select({ id: schema.tenants.id })
    .from(schema.tenants);

  const total: JobExpirySweepResult = { scanned: 0, expired: 0, jobs: [] };
  for (const tenant of tenantRows) {
    const result = await runWithRequestContext(
      { requestId: "job-expiry-sweep", tenantId: tenant.id },
      () => expireOverdueJobs(now),
    );
    total.scanned += result.scanned;
    total.expired += result.expired;
    total.jobs.push(...result.jobs);
  }
  return total;
}

async function runScheduledSweep(trigger: "startup" | "interval") {
  try {
    const result = await expireOverdueJobsAllTenants();
    logger.debug("Job expiry sweep completed", {
      trigger,
      scanned: result.scanned,
      expired: result.expired,
    });
  } catch (error) {
    logger.warn("Job expiry sweep failed", {
      trigger,
      error: sanitizeUnknown(error),
    });
  }
}

/**
 * Start the periodic expiry sweep (runs immediately, then every 6 hours).
 */
export function startJobExpiryScheduler(): void {
  void runScheduledSweep("startup");
  const timer = setInterval(() => {
    void runScheduledSweep("interval");
  }, JOB_EXPIRY_SWEEP_INTERVAL_MS);
  timer.unref();
}
