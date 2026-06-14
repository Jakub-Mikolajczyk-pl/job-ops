import { timingSafeEqual } from "node:crypto";
import { serviceUnavailable, toAppError, unauthorized } from "@infra/errors";
import { asyncRoute, fail, ok } from "@infra/http";
import { runWithRequestContext } from "@infra/request-context";
import * as jobsRepo from "@server/repositories/jobs";
import { DEFAULT_TENANT_ID } from "@server/tenancy/constants";
import type { JobStatus } from "@shared/types";
import { type Request, type Response, Router } from "express";

export const dashboardRouter = Router();

const DASHBOARD_STATUSES: JobStatus[] = ["discovered", "ready"];

dashboardRouter.get(
  "/summary",
  asyncRoute(async (req: Request, res: Response) => {
    const expectedToken = process.env.JOBOPS_DASHBOARD_TOKEN?.trim();
    if (!expectedToken) {
      return fail(res, serviceUnavailable("Dashboard token is not configured"));
    }

    if (!hasValidBearerToken(req, expectedToken)) {
      return fail(res, unauthorized());
    }

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

          ok(res, {
            new_offers: counts.discovered,
            action_required: counts.discovered + counts.ready,
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

function hasValidBearerToken(req: Request, expectedToken: string): boolean {
  const authHeader = req.headers.authorization ?? "";
  if (!authHeader.startsWith("Bearer ")) return false;
  const actualToken = authHeader.slice("Bearer ".length).trim();
  return constantTimeEquals(actualToken, expectedToken);
}

function constantTimeEquals(actual: string, expected: string): boolean {
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);
  return (
    actualBuffer.length === expectedBuffer.length &&
    timingSafeEqual(actualBuffer, expectedBuffer)
  );
}

function compareDashboardOffer(
  left: { status: JobStatus; discoveredAt: string },
  right: { status: JobStatus; discoveredAt: string },
): number {
  const statusDiff = statusRank(left.status) - statusRank(right.status);
  if (statusDiff !== 0) return statusDiff;
  return right.discoveredAt.localeCompare(left.discoveredAt);
}

function statusRank(status: JobStatus): number {
  if (status === "discovered") return 0;
  if (status === "ready") return 1;
  return 2;
}
