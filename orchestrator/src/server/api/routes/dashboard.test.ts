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
    const oldDiscovered = await createJob({
      source: "manual",
      title: "Old Backlog Role",
      employer: "Initech",
      jobUrl: "https://example.com/jobs/old-backlog",
      jobDescription: "Old backlog item.",
    });
    await updateJob(discovered.id, { suitabilityScore: 88 });
    await updateJob(ready.id, { status: "ready", suitabilityScore: 74 });
    const { db, schema } = await import("@server/db");
    const { eq } = await import("drizzle-orm");
    await db
      .update(schema.jobs)
      .set({ discoveredAt: "2026-01-01T00:00:00.000Z" })
      .where(eq(schema.jobs.id, oldDiscovered.id));

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
        action_required: 3,
        counts: {
          discovered: 2,
          ready: 1,
          skipped: 0,
        },
      },
    });
    expect(body.data.offers.slice(0, 2)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: discovered.id,
          title: "Fresh Backend Role",
          employer: "Acme",
          source: "manual",
          status: "discovered",
          score: 88,
          path: `/jobs/discovered/${discovered.id}`,
        }),
        expect.objectContaining({
          id: ready.id,
          title: "Ready Platform Role",
          employer: "Globex",
          source: "manual",
          status: "ready",
          score: 74,
          path: `/jobs/ready/${ready.id}`,
        }),
      ]),
    );
    expect(body.data.offers[2]).toMatchObject({
      id: oldDiscovered.id,
      title: "Old Backlog Role",
      status: "discovered",
    });
    expect(body.data.offers[0]).not.toHaveProperty("jobDescription");
    expect(typeof body.meta.requestId).toBe("string");
  });
});
