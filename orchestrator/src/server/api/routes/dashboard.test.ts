import type { Server } from "node:http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startServer, stopServer } from "./test-utils";

describe.sequential("Dashboard API route", () => {
  let server: Server;
  let baseUrl: string;
  let closeDb: () => void;
  let tempDir: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    ({ server, baseUrl, closeDb, tempDir } = await startServer({
      env: {
        JOBOPS_TEST_AUTH_BYPASS: "0",
        JOBOPS_DASHBOARD_TOKEN: "dashboard-token",
      },
    }));
  });

  afterEach(async () => {
    await stopServer({ server, closeDb, tempDir });
  });

  it("returns a token-protected read-only job summary for Homepage", async () => {
    const { createJob, updateJob } = await import("@server/repositories/jobs");

    const discovered = await createJob({
      source: "manual",
      title: "Fresh Backend Role",
      employer: "Acme",
      jobUrl: "https://example.com/jobs/fresh-backend",
      jobDescription: "Private full job description should not leave JobOps.",
    });
    const ready = await createJob({
      source: "manual",
      title: "Ready Platform Role",
      employer: "Globex",
      jobUrl: "https://example.com/jobs/ready-platform",
      jobDescription: "Another private description.",
    });
    await updateJob(discovered.id, { suitabilityScore: 88 });
    await updateJob(ready.id, { status: "ready", suitabilityScore: 74 });

    const unauthorized = await fetch(`${baseUrl}/api/dashboard/summary`);
    expect(unauthorized.status).toBe(401);

    const response = await fetch(`${baseUrl}/api/dashboard/summary`, {
      headers: { authorization: "Bearer dashboard-token" },
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      data: {
        new_offers: 1,
        action_required: 2,
        counts: {
          discovered: 1,
          ready: 1,
          skipped: 0,
        },
        offers: [
          {
            id: discovered.id,
            title: "Fresh Backend Role",
            employer: "Acme",
            source: "manual",
            status: "discovered",
            score: 88,
            path: `/jobs/discovered/${discovered.id}`,
          },
          {
            id: ready.id,
            title: "Ready Platform Role",
            employer: "Globex",
            source: "manual",
            status: "ready",
            score: 74,
            path: `/jobs/ready/${ready.id}`,
          },
        ],
      },
    });
    expect(body.data.offers[0]).not.toHaveProperty("jobDescription");
    expect(typeof body.meta.requestId).toBe("string");
  });
});
