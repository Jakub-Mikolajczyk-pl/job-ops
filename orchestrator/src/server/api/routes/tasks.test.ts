import type { Server } from "node:http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startServer, stopServer } from "./test-utils";

// Mocked LLM extraction (same seam as recruitment-intake.test.ts) so we can
// seed real jobs + tasks through the worker, then assert "Your move".
const h = vi.hoisted(() => ({ extraction: null as unknown }));

vi.mock("@server/services/modelSelection", () => ({
  resolveLlmModel: async () => "mock-model",
  createConfiguredLlmService: async () => ({
    callJson: async () => ({ success: true, data: h.extraction }),
  }),
}));

describe.sequential("Tasks 'Your move' API (R3)", () => {
  let server: Server;
  let baseUrl: string;
  let closeDb: () => void;
  let tempDir: string;

  beforeEach(async () => {
    ({ server, baseUrl, closeDb, tempDir } = await startServer());
  });

  afterEach(async () => {
    await stopServer({ server, closeDb, tempDir });
  });

  async function ingestAndProcess(
    body: Record<string, unknown>,
  ): Promise<unknown> {
    const ingest = await fetch(`${baseUrl}/api/ingest`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const intakeId = (await ingest.json()).data.intakeId as string;
    const res = await fetch(`${baseUrl}/api/ingest/${intakeId}/process`, {
      method: "POST",
    });
    return (await res.json()).data;
  }

  function yourMove() {
    return fetch(`${baseUrl}/api/tasks/your-move`).then((r) => r.json());
  }

  it("surfaces an overdue task joined to its job", async () => {
    h.extraction = {
      isRecruitment: true,
      company: "Acme Corp",
      position: "Senior Java Developer",
      stage: "recruiter_screen",
      nextAction: "Reply to recruiter with CV",
      nextActionDue: "2020-01-01",
    };
    await ingestAndProcess({
      source: "telegram",
      kind: "linkedin_msg",
      text: "Acme reached out about a Senior Java role.",
    });

    const body = await yourMove();
    expect(body.ok).toBe(true);
    expect(body.data.overdue).toHaveLength(1);
    const task = body.data.overdue[0];
    expect(task.company).toBe("Acme Corp");
    expect(task.position).toBe("Senior Java Developer");
    expect(task.title).toBe("Reply to recruiter with CV");
  });

  it("completes a task so it drops off the board", async () => {
    h.extraction = {
      isRecruitment: true,
      company: "Beta Ltd",
      position: "Backend Engineer",
      stage: "applied",
      nextAction: "Send availability",
      nextActionDue: "2020-02-02",
    };
    await ingestAndProcess({
      source: "telegram",
      kind: "note",
      text: "Beta backend role.",
    });

    const before = await yourMove();
    const taskId = before.data.overdue[0].id as string;

    const completed = await fetch(`${baseUrl}/api/tasks/${taskId}/complete`, {
      method: "POST",
    });
    expect(completed.status).toBe(200);

    const after = await yourMove();
    expect(after.data.overdue).toHaveLength(0);
  });

  it("snoozes a task to a future due date", async () => {
    h.extraction = {
      isRecruitment: true,
      company: "Gamma Tech",
      position: "SRE",
      stage: "applied",
      nextAction: "Book the call",
      nextActionDue: "2020-03-03",
    };
    await ingestAndProcess({
      source: "telegram",
      kind: "note",
      text: "Gamma SRE role.",
    });
    const before = await yourMove();
    const taskId = before.data.overdue[0].id as string;

    const res = await fetch(`${baseUrl}/api/tasks/${taskId}/snooze`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ days: 3 }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.dueDate).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });

  it("lists needs-review intakes", async () => {
    h.extraction = {
      isRecruitment: true,
      company: "",
      position: "",
      stage: "applied",
    };
    await ingestAndProcess({
      source: "folder",
      kind: "note",
      text: "Vague note with no company name at all.",
    });
    const body = await yourMove();
    expect(body.data.needsReview.length).toBeGreaterThanOrEqual(1);
    expect(body.data.needsReview[0].preview).toContain("Vague note");
  });

  it("404s when completing a missing task", async () => {
    const res = await fetch(`${baseUrl}/api/tasks/does-not-exist/complete`, {
      method: "POST",
    });
    expect(res.status).toBe(404);
  });
});
