import {
  EXPIRABLE_JOB_STATUSES,
  type JobActionResponse,
  type JobListItem,
} from "@shared/types";

const SKIPPABLE_STATUSES = new Set(["discovered", "ready"]);
const EXPIRABLE_STATUSES = new Set<string>(EXPIRABLE_JOB_STATUSES);

export function canSkip(jobs: JobListItem[]): boolean {
  return (
    jobs.length > 0 && jobs.every((job) => SKIPPABLE_STATUSES.has(job.status))
  );
}

export function canMarkExpired(jobs: JobListItem[]): boolean {
  return (
    jobs.length > 0 && jobs.every((job) => EXPIRABLE_STATUSES.has(job.status))
  );
}

export function canMoveToReady(jobs: JobListItem[]): boolean {
  return jobs.length > 0 && jobs.every((job) => job.status === "discovered");
}

export function canRescore(jobs: JobListItem[]): boolean {
  return jobs.length > 0 && jobs.every((job) => job.status !== "processing");
}

export function getFailedJobIds(response: JobActionResponse): Set<string> {
  const failedIds = response.results
    .filter((result) => !result.ok)
    .map((result) => result.jobId);
  return new Set(failedIds);
}
