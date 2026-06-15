import { toAppError } from "@infra/errors";
import { asyncRoute, fail, ok } from "@infra/http";
import { requireDashboardToken } from "@server/api/dashboard-auth";
import { runWithRequestContext } from "@infra/request-context";
import * as jobsRepo from "@server/repositories/jobs";
import { DEFAULT_TENANT_ID } from "@server/tenancy/constants";
import type { JobStatus } from "@shared/types";
import { type Request, type Response, Router } from "express";

export const dashboardRouter = Router();

const DASHBOARD_STATUSES: JobStatus[] = ["discovered", "ready"];
const DEFAULT_NEW_WINDOW_HOURS = 48;

dashboardRouter.get(
  "/summary",
  asyncRoute(async (req: Request, res: Response) => {
    const auth = requireDashboardToken(req, res);
    if (!auth.ok) return;

    const tenantId =
      process.env.JOBOPS_DASHBOARD_TENANT_ID?.trim() || DEFAULT_TENANT_ID;

    return runWithRequestContext(
      { tenantId, username: "dashboard" },
      async () => {
        try {
          const [counts, jobs] = await Promise.all([
            jobsRepo.getJobStats(),
            jobsRepo.getJobListItems(DASHBOARD_STATUSES),
          ]);
          const offers = jobs
            .slice()
            .sort(compareDashboardOffer)
            .slice(0, 5)
            .map((job) => ({
              id: job.id,
              title: job.title,
              employer: job.employer,
              source: job.source,
              status: job.status,
              score: job.suitabilityScore,
              discovered_at: job.discoveredAt,
              updated_at: job.updatedAt,
              path: `/jobs/${job.status}/${job.id}`,
            }));
          const newWindowHours = getNewWindowHours();
          const newSince = Date.now() - newWindowHours * 60 * 60 * 1000;
          const newOffers = jobs.filter(
            (job) =>
              job.status === "discovered" &&
              Date.parse(job.discoveredAt) >= newSince,
          ).length;

          ok(res, {
            new_offers: newOffers,
            action_required: counts.discovered + counts.ready,
            new_window_hours: newWindowHours,
            latest_discovered_at: offers[0]?.discovered_at ?? null,
            counts,
            offers,
          });
        } catch (error) {
          fail(res, toAppError(error));
        }
      },
    );
  }),
);

function compareDashboardOffer(
  left: { status: JobStatus; discoveredAt: string },
  right: { status: JobStatus; discoveredAt: string },
): number {
  return right.discoveredAt.localeCompare(left.discoveredAt);
}

function getNewWindowHours(): number {
  const parsed = Number.parseInt(
    process.env.JOBOPS_DASHBOARD_NEW_WINDOW_HOURS ?? "",
    10,
  );
  return Number.isFinite(parsed) && parsed > 0
    ? parsed
    : DEFAULT_NEW_WINDOW_HOURS;
}
