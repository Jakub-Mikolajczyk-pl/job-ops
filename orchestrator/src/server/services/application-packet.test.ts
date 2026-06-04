import type { Job } from "@shared/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

const callJsonMock = vi.fn();

vi.mock("./modelSelection", () => ({
  resolveLlmModel: vi.fn().mockResolvedValue("packet-model"),
  createConfiguredLlmService: vi.fn().mockResolvedValue({
    callJson: callJsonMock,
  }),
}));

vi.mock("./profile", () => ({
  getProfile: vi.fn().mockResolvedValue({
    basics: {
      name: "Jakub Mikolajczyk",
      label: "Backend engineer",
      summary: "Builds reliable TypeScript systems.",
    },
    sections: {
      skills: { items: [{ name: "Backend", keywords: ["TypeScript"] }] },
      experience: {
        items: [
          {
            company: "Acme",
            position: "Senior Engineer",
            summary: "Built job automation workflows.",
          },
        ],
      },
      projects: {
        items: [{ name: "JobOps", description: "Job application platform" }],
      },
    },
  }),
}));

vi.mock("./writing-style", () => ({
  getWritingStyle: vi.fn().mockResolvedValue({
    tone: "direct",
    formality: "medium",
    constraints: "No hype.",
    doNotUse: "synergy",
    languageMode: "manual",
    manualLanguage: "english",
    summaryMaxWords: null,
    maxKeywordsPerSkill: null,
  }),
}));

const job = {
  id: "job-1",
  title: "Platform Engineer",
  employer: "ExampleCo",
  location: "Remote",
  salary: "Not stated",
  jobDescription:
    "We need a Platform Engineer for TypeScript services, observability, and workflow automation.",
  suitabilityScore: 87,
  suitabilityReason:
    "Strong match on TypeScript services and workflow automation.",
  jobBrief: JSON.stringify({
    role_summary: "Own platform workflows.",
    they_want: ["TypeScript", "Observability"],
    specifics: ["Remote"],
  }),
  tailoredHeadline: "Platform Engineer",
  tailoredSummary: "Backend engineer focused on reliable automation.",
  tailoredSkills: JSON.stringify([
    { name: "Backend", keywords: ["TypeScript", "APIs"] },
  ]),
} as Job;

describe("application packet generation", () => {
  beforeEach(() => {
    callJsonMock.mockReset();
  });

  it("drafts, reviews, and returns a revised first-class packet", async () => {
    callJsonMock
      .mockResolvedValueOnce({
        success: true,
        data: {
          fitSummaryMarkdown: "## Fit\nStrong match.",
          coverLetterMarkdown: "Dear ExampleCo,\n\nI can help.",
          interviewPrepMarkdown:
            "## Interview Prep\n- Explain TypeScript work.",
        },
      })
      .mockResolvedValueOnce({
        success: true,
        data: {
          revisedCoverLetterMarkdown:
            "Dear ExampleCo,\n\nI can help with platform workflows.",
          reviewMarkdown:
            "## Application Review\n- Added platform workflow angle.",
          checklistMarkdown:
            "## Checklist\n- [x] Claims grounded in profile\n- [x] Role keywords covered",
        },
      });

    const { generateApplicationPacketContent } = await import(
      "./application-packet"
    );

    const packet = await generateApplicationPacketContent(job);

    expect(packet.success).toBe(true);
    if (!packet.success) throw new Error(packet.error);
    expect(packet.data.coverLetterMarkdown).toContain("platform workflows");
    expect(packet.data.reviewMarkdown).toContain("Application Review");
    expect(packet.data.checklistMarkdown).toContain("Claims grounded");
    expect(packet.data.interviewPrepMarkdown).toContain("Interview Prep");
    expect(callJsonMock).toHaveBeenCalledTimes(2);
    expect(callJsonMock.mock.calls[0][0].jsonSchema.name).toBe(
      "application_packet_draft",
    );
    expect(callJsonMock.mock.calls[1][0].jsonSchema.name).toBe(
      "application_packet_review",
    );
    expect(callJsonMock.mock.calls[1][0].messages[0].content).toContain(
      "Dear ExampleCo",
    );
  });

  it("returns an error when the reviewer pass fails", async () => {
    callJsonMock
      .mockResolvedValueOnce({
        success: true,
        data: {
          fitSummaryMarkdown: "## Fit\nStrong match.",
          coverLetterMarkdown: "Dear ExampleCo,\n\nI can help.",
          interviewPrepMarkdown:
            "## Interview Prep\n- Explain TypeScript work.",
        },
      })
      .mockResolvedValueOnce({
        success: false,
        error: "reviewer unavailable",
      });

    const { generateApplicationPacketContent } = await import(
      "./application-packet"
    );

    const packet = await generateApplicationPacketContent(job);

    expect(packet.success).toBe(false);
    if (packet.success) throw new Error("Expected packet generation to fail");
    expect(packet.error).toContain("reviewer unavailable");
  });
});
