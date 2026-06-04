import type { Server } from "node:http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startServer, stopServer } from "./test-utils";

const callJsonMock = vi.fn();

vi.mock("@server/services/modelSelection", () => ({
  resolveLlmModel: vi.fn().mockResolvedValue("packet-model"),
  createConfiguredLlmService: vi.fn().mockResolvedValue({
    callJson: callJsonMock,
  }),
}));

vi.mock("@server/services/writing-style", () => ({
  getWritingStyle: vi.fn().mockResolvedValue({
    tone: "direct",
    formality: "medium",
    constraints: "",
    doNotUse: "",
    languageMode: "manual",
    manualLanguage: "english",
    summaryMaxWords: null,
    maxKeywordsPerSkill: null,
  }),
}));

describe.sequential("Jobs application packet route", () => {
  let server: Server;
  let baseUrl: string;
  let closeDb: () => void;
  let tempDir: string;

  beforeEach(async () => {
    callJsonMock.mockReset();
    ({ server, baseUrl, closeDb, tempDir } = await startServer());
  });

  afterEach(async () => {
    await stopServer({ server, closeDb, tempDir });
  });

  it("generates a packet and stores first-class job artifacts", async () => {
    callJsonMock
      .mockResolvedValueOnce({
        success: true,
        data: {
          fitSummaryMarkdown: "## Fit Summary\nStrong platform match.",
          coverLetterMarkdown: "Dear ExampleCo,\n\nI can help.",
          interviewPrepMarkdown: "## Interview Prep\n- Discuss TypeScript.",
        },
      })
      .mockResolvedValueOnce({
        success: true,
        data: {
          revisedCoverLetterMarkdown:
            "Dear ExampleCo,\n\nI can help with platform workflows.",
          reviewMarkdown: "## Application Review\n- Grounded and specific.",
          checklistMarkdown: "## Checklist\n- [x] No unsupported claims",
        },
      });

    const { createJob, updateJob } = await import("@server/repositories/jobs");
    const job = await createJob({
      source: "manual",
      title: "Platform Engineer",
      employer: "ExampleCo",
      jobUrl: "https://example.com/platform",
      jobDescription: "TypeScript platform workflows and observability.",
    });
    await updateJob(job.id, {
      tailoredSummary: "Backend engineer focused on reliable automation.",
      tailoredHeadline: "Platform Engineer",
      tailoredSkills: JSON.stringify([
        { name: "Backend", keywords: ["TypeScript", "APIs"] },
      ]),
    });

    const res = await fetch(
      `${baseUrl}/api/jobs/${job.id}/application-packet`,
      {
        method: "POST",
      },
    );
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.ok).toBe(true);
    expect(body.data.note.title).toBe("Application Packet");
    expect(body.data.documents.coverLetter.fileName).toMatch(/cover-letter/i);
    expect(body.data.documents.review.fileName).toMatch(/review/i);
    expect(body.data.documents.interviewPrep.fileName).toMatch(/interview/i);

    const documentsRes = await fetch(`${baseUrl}/api/jobs/${job.id}/documents`);
    const documentsBody = await documentsRes.json();
    expect(
      documentsBody.data.map((doc: { fileName: string }) => doc.fileName),
    ).toEqual(
      expect.arrayContaining([
        "application-cover-letter.md",
        "application-review.md",
        "application-interview-prep.md",
      ]),
    );
  });
});
