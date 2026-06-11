import type { Server } from "node:http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startServer, stopServer } from "./test-utils";

describe.sequential("Job expiry", () => {
  let server: Server;
  let baseUrl: string;
  let closeDb: () => void;
  let tempDir: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    ({ server, baseUrl, closeDb, tempDir } = await startServer());
  });

  afterEach(async () => {
    await stopServer({ server, closeDb, tempDir });
  });

  it("marks a job as expired via POST /api/jobs/:id/expire", async () => {
    const { createJob } = await import("@server/repositories/jobs");
    const job = await createJob({
      source: "manual",
      title: "Expiring Role",
      employer: "Acme",
      jobUrl: "https://example.com/job/expire-1",
      deadline: "2099-12-31",
    });

    const res = await fetch(`${baseUrl}/api/jobs/${job.id}/expire`, {
      method: "POST",
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.data.status).toBe("expired");
  });

  it("rejects marking an applied job as expired", async () => {
    const { createJob, updateJob } = await import("@server/repositories/jobs");
    const job = await createJob({
      source: "manual",
      title: "Applied Role",
      employer: "Acme",
      jobUrl: "https://example.com/job/expire-applied",
    });
    await updateJob(job.id, { status: "applied" });

    const res = await fetch(`${baseUrl}/api/jobs/${job.id}/expire`, {
      method: "POST",
    });
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("INVALID_REQUEST");
  });

  it("supports bulk mark_expired through POST /api/jobs/actions", async () => {
    const { createJob, updateJob } = await import("@server/repositories/jobs");
    const expirable = await createJob({
      source: "manual",
      title: "Bulk Expire Role",
      employer: "Acme",
      jobUrl: "https://example.com/job/bulk-expire-1",
    });
    const applied = await createJob({
      source: "manual",
      title: "Bulk Applied Role",
      employer: "Acme",
      jobUrl: "https://example.com/job/bulk-expire-2",
    });
    await updateJob(applied.id, { status: "applied" });

    const res = await fetch(`${baseUrl}/api/jobs/actions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "mark_expired",
        jobIds: [expirable.id, applied.id],
      }),
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.data.succeeded).toBe(1);
    expect(body.data.failed).toBe(1);

    const { getJobById } = await import("@server/repositories/jobs");
    expect((await getJobById(expirable.id))?.status).toBe("expired");
    expect((await getJobById(applied.id))?.status).toBe("applied");
  });

  it("expires only overdue active jobs via POST /api/jobs/expire-overdue", async () => {
    const { createJob, updateJob, getJobById } = await import(
      "@server/repositories/jobs"
    );

    const overdue = await createJob({
      source: "manual",
      title: "Overdue Role",
      employer: "Acme",
      jobUrl: "https://example.com/job/sweep-overdue",
      deadline: "2020-01-01",
    });
    const overdueTextual = await createJob({
      source: "manual",
      title: "Overdue Textual Role",
      employer: "Acme",
      jobUrl: "https://example.com/job/sweep-overdue-textual",
      deadline: "3rd January, 2020",
    });
    const future = await createJob({
      source: "manual",
      title: "Future Role",
      employer: "Acme",
      jobUrl: "https://example.com/job/sweep-future",
      deadline: "2099-12-31",
    });
    const ongoing = await createJob({
      source: "manual",
      title: "Ongoing Role",
      employer: "Acme",
      jobUrl: "https://example.com/job/sweep-ongoing",
      deadline: "Ongoing",
    });
    const noDeadline = await createJob({
      source: "manual",
      title: "No Deadline Role",
      employer: "Acme",
      jobUrl: "https://example.com/job/sweep-no-deadline",
    });
    const appliedOverdue = await createJob({
      source: "manual",
      title: "Applied Overdue Role",
      employer: "Acme",
      jobUrl: "https://example.com/job/sweep-applied",
      deadline: "2020-01-01",
    });
    await updateJob(appliedOverdue.id, { status: "applied" });

    const res = await fetch(`${baseUrl}/api/jobs/expire-overdue`, {
      method: "POST",
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.data.expired).toBe(2);
    expect(body.data.jobs.map((job: { id: string }) => job.id).sort()).toEqual(
      [overdue.id, overdueTextual.id].sort(),
    );

    expect((await getJobById(overdue.id))?.status).toBe("expired");
    expect((await getJobById(overdueTextual.id))?.status).toBe("expired");
    expect((await getJobById(future.id))?.status).toBe("discovered");
    expect((await getJobById(ongoing.id))?.status).toBe("discovered");
    expect((await getJobById(noDeadline.id))?.status).toBe("discovered");
    expect((await getJobById(appliedOverdue.id))?.status).toBe("applied");
  });

  it("sweeps every tenant in expireOverdueJobsAllTenants", async () => {
    const { runWithRequestContext } = await import("@infra/request-context");
    const { db, schema } = await import("@server/db/index");
    const { createJob, getJobById } = await import("@server/repositories/jobs");
    const { expireOverdueJobsAllTenants } = await import(
      "@server/services/job-expiry"
    );

    await db.insert(schema.tenants).values({
      id: "tenant_secondary",
      name: "Secondary",
      slug: "secondary",
    });

    const defaultTenantJob = await createJob({
      source: "manual",
      title: "Default Tenant Overdue",
      employer: "Acme",
      jobUrl: "https://example.com/job/tenant-default-overdue",
      deadline: "2020-01-01",
    });
    const secondaryTenantJob = await runWithRequestContext(
      { requestId: "test", tenantId: "tenant_secondary" },
      () =>
        createJob({
          source: "manual",
          title: "Secondary Tenant Overdue",
          employer: "Acme",
          jobUrl: "https://example.com/job/tenant-secondary-overdue",
          deadline: "2020-01-01",
        }),
    );

    const result = await expireOverdueJobsAllTenants();

    expect(result.expired).toBe(2);
    expect((await getJobById(defaultTenantJob.id))?.status).toBe("expired");
    const secondaryAfter = await runWithRequestContext(
      { requestId: "test", tenantId: "tenant_secondary" },
      () => getJobById(secondaryTenantJob.id),
    );
    expect(secondaryAfter?.status).toBe("expired");
  });
});
